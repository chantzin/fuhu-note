/* =====================================================
 * FUHU-NOTE 筆記 — 同步引擎（Firebase Auth + Firestore）
 * 離線優先：本地 IndexedDB 為第一真相來源，
 * 雲端為同步中樞。衝突以「欄位層級 LWW（最後寫入勝出）」處理。
 * 未設定 FIREBASE_CONFIG 時自動進入本機模式。
 * ===================================================== */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
  getRedirectResult, onAuthStateChanged, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFirestore, collection, query, where, doc, setDoc, deleteDoc, onSnapshot
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';
import { FIREBASE_CONFIG, LOCAL_UID_PREFIX } from './config.js';
import {
  metaGet, metaSet, genUid,
  loadNotebooks, saveNotebookLocal,
  loadNotes, saveNoteLocal, deleteNoteLocal,
  enqueue, loadQueue, removeQueue
} from './db.js';

/* ---------- 狀態 ---------- */
const state = {
  config: FIREBASE_CONFIG,
  app: null, auth: null, db: null, storage: null,
  user: null,          // Firebase 使用者
  uid: null,           // 目前資料所有者（登入=user.uid；未登入=本機UID）
  listeners: [],       // Firestore 監聽器（登出時清除）
  pushing: false,
  status: FIREBASE_CONFIG ? 'logged-out' : 'local',
  onStatus: null,      // 狀態回呼（由 app.js 設定）
  onUser: null         // 使用者變更回呼
};

const NOTE_FIELDS = ['title', 'content', 'notebookId', 'tags', 'trash'];
const NB_FIELDS = ['name', 'sortOrder'];

function setStatus(s) { state.status = s; if (state.onStatus) state.onStatus(s); }

/* ---------- 初始化 ---------- */
export function initSync() {
  if (!state.config) {
    state.uid = LOCAL_UID_PREFIX + '-' + genUid('dev').slice(3);
    return metaGet('localUid').then((v) => {
      if (v) { state.uid = v; }
      else { const u = LOCAL_UID_PREFIX + '-' + genUid('dev').slice(3); return metaSet('localUid', u).then(() => { state.uid = u; }); }
    }).then(() => { setStatus('local'); });
  }
  try {
    state.app = initializeApp(state.config);
    state.auth = getAuth(state.app);
    state.db = getFirestore(state.app);
    state.storage = getStorage(state.app);
  } catch (e) {
    console.error('Firebase 初始化失敗，進入本機模式：', e);
    state.uid = LOCAL_UID_PREFIX + '-' + genUid('dev').slice(3);
    setStatus('local');
    return Promise.resolve();
  }
  return getRedirectResult(state.auth).catch(() => null).then(() => {
    onAuthStateChanged(state.auth, onAuthChanged);
  });
}

function onAuthChanged(user) {
  state.user = user;
  if (user) {
    state.uid = user.uid;
    startSync();
    setStatus(navigator.onLine ? 'syncing' : 'offline');
  } else {
    stopSync();
    state.uid = LOCAL_UID_PREFIX + '-' + genUid('dev').slice(3);
    setStatus('logged-out');
  }
  if (state.onUser) state.onUser(user);
}

/* ---------- 登入 / 登出 ---------- */
export async function login() {
  if (!state.auth) throw new Error('尚未設定 Firebase（請見 Firebase設定指南.md）');
  const provider = new GoogleAuthProvider();
  try {
    await signInWithPopup(state.auth, provider);
  } catch (e) {
    if (e.code === 'auth/popup-blocked' || e.code === 'auth/cancelled-popup-request' || e.code === 'auth/operation-not-supported-in-this-environment') {
      // 彈出視窗被擋或行動環境 → 改用重新導向
      await signInWithRedirect(state.auth, provider);
      return;
    }
    throw e;
  }
}
export async function logout() { if (state.auth) await signOut(state.auth); }
export function getUser() { return state.user; }
export function getUid() { return state.uid; }
export function isCloudMode() { return !!state.config; }

/* ---------- 同步引擎 ---------- */
function noteRef(id) { return doc(state.db, 'notes', id); }
function nbRef(id) { return doc(state.db, 'notebooks', id); }

function startSync() {
  if (!state.user) return;
  stopSync(); // 避免重複訂閱
  const uid = state.user.uid;

  const unsubNotes = onSnapshot(
    query(collection(state.db, 'notes'), where('ownerId', '==', uid)),
    (snap) => { snap.docChanges().forEach((ch) => handleRemoteNote(ch.doc.data(), ch.type)); reconcile(); },
    (err) => { console.error('notes 監聽失敗：', err); setStatus('error'); }
  );
  const unsubNbs = onSnapshot(
    query(collection(state.db, 'notebooks'), where('ownerId', '==', uid)),
    (snap) => { snap.docChanges().forEach((ch) => handleRemoteNb(ch.doc.data(), ch.type)); reconcile(); },
    (err) => { console.error('notebooks 監聽失敗：', err); setStatus('error'); }
  );
  state.listeners = [unsubNotes, unsubNbs];

  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  pushQueue();
}

function stopSync() {
  state.listeners.forEach((u) => u());
  state.listeners = [];
  window.removeEventListener('online', onOnline);
  window.removeEventListener('offline', onOffline);
}

function onOnline() { setStatus('syncing'); pushQueue(); }
function onOffline() { setStatus('offline'); }

/* ---------- 上傳佇列 ---------- */
async function pushQueue() {
  if (state.pushing) return;
  if (!state.user) return;
  state.pushing = true;
  try {
    const items = await loadQueue();
    for (const item of items) {
      try {
        if (item.coll === 'notes') {
          if (item.action === 'delete') await deleteDoc(noteRef(item.data.id));
          else await setDoc(noteRef(item.data.id), item.data);
        } else if (item.coll === 'notebooks') {
          if (item.action === 'delete') await deleteDoc(nbRef(item.data.id));
          else await setDoc(nbRef(item.data.id), item.data);
        }
        await removeQueue(item.id);
      } catch (e) {
        console.error('上傳佇列項目失敗：', e);
        break; // 網路或規則錯誤，留待下次
      }
    }
    setStatus(navigator.onLine ? 'synced' : 'offline');
  } finally {
    state.pushing = false;
  }
}

/* ---------- 遠端變更 → 本機合併（欄位層級 LWW） ---------- */
function mergeFields(local, incoming, fields) {
  let adopted = false;
  const lf = local.f || {};
  const inf = incoming.f || {};
  for (const field of fields) {
    const inTs = inf[field];
    if (inTs && inTs > (lf[field] || 0)) {
      local[field] = incoming[field];
      lf[field] = inTs;
      adopted = true;
    }
  }
  // 墓碑：雲端刪除旗標較新時，一律接受
  if (incoming.deleted && (incoming.updatedAt || 0) >= (local.updatedAt || 0)) {
    if (!local.deleted) { local.deleted = true; adopted = true; }
  }
  local.f = lf;
  local.updatedAt = Math.max(local.updatedAt || 0, incoming.updatedAt || 0);
  return adopted;
}

async function handleRemoteNote(data, type) {
  if (type === 'removed') {
    if (data && data.id) await deleteNoteLocal(data.id);
    return;
  }
  if (!data || data.deleted) return;
  const local = await loadNoteLocal(data.id);
  if (!local) { await saveNoteLocal(data); return; }
  if (mergeFields(local, data, NOTE_FIELDS)) {
    await saveNoteLocal(local);
    if (state.user && navigator.onLine) {
      // 回寫合併結果，讓雲端與本機一致（LWW 穩定後不會再觸發）
      try { await setDoc(noteRef(data.id), local); } catch (e) { /* 下次同步再處理 */ }
    }
  }
}

async function handleRemoteNb(data, type) {
  if (!data) return;
  if (type === 'removed' || data.deleted) { await deleteNotebookLocal(data.id); return; }
  const local = await loadNbLocal(data.id);
  if (!local) { await saveNotebookLocal(data); return; }
  if (mergeFields(local, data, NB_FIELDS)) {
    await saveNotebookLocal(local);
    if (state.user && navigator.onLine) {
      try { await setDoc(nbRef(data.id), local); } catch (e) { /* 下次再處理 */ }
    }
  }
}

/* 合併後通知 UI 重新渲染 */
function reconcile() { if (state.onUser) state.onUser(state.user); }

/* ---------- 本地讀取（避免與 db.js 命名衝突） ---------- */
async function loadNoteLocal(id) {
  const all = await loadNotes();
  return all.find((n) => n.id === id);
}
async function loadNbLocal(id) {
  const all = await loadNotebooks();
  return all.find((n) => n.id === id);
}

/* ---------- 圖片上傳（雲端模式） ---------- */
export async function uploadImage(file) {
  if (!state.storage || !state.user) throw new Error('cloud-unavailable');
  const path = `attachments/${state.user.uid}/${Date.now()}_${file.name.replace(/[^\w.\-]+/g, '_')}`;
  const snap = await uploadBytes(ref(state.storage, path), file);
  return getDownloadURL(snap.ref);
}

/* 供 app.js 在雲端模式寫入時，將新資料同時寫入佇列與雲端 */
export function cloudUpsert(coll, data) {
  if (!state.user) return;
  if (coll === 'notes') setDoc(noteRef(data.id), data).catch(() => {});
  else setDoc(nbRef(data.id), data).catch(() => {});
}
export function cloudDelete(coll, id) {
  if (!state.user) return;
  if (coll === 'notes') deleteDoc(noteRef(id)).catch(() => {});
  else deleteDoc(nbRef(id)).catch(() => {});
}

export { enqueue };

/* ---------- 回呼與狀態查詢（供 app.js 使用） ---------- */
export function setSyncStatusCallback(cb) { state.onStatus = cb; }
export function setUserCallback(cb) { state.onUser = cb; }
export function getStatus() { return state.status; }
