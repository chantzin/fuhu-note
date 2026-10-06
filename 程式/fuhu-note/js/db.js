/* =====================================================
 * FUHU-NOTE 筆記 — 本地資料庫層（IndexedDB）
 * 離線優先：所有讀寫先落本機，同步引擎再與雲端交換。
 * ===================================================== */

/* 資料庫名稱保留舊名「evernot-db」，以相容更名前已建立的本機資料 */
const DB_NAME = 'evernot-db';
const DB_VERSION = 1;

let _db = null;

function openDb() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('notebooks')) db.createObjectStore('notebooks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('queue')) db.createObjectStore('queue', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode) {
  return openDb().then((db) => db.transaction(store, mode).objectStore(store));
}

const dbGetAll = (store) => tx(store, 'readonly').then((s) => new Promise((res, rej) => { const r = s.getAll(); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
const dbGet = (store, key) => tx(store, 'readonly').then((s) => new Promise((res, rej) => { const r = s.get(key); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
const dbPut = (store, obj) => tx(store, 'readwrite').then((s) => new Promise((res, rej) => { const r = s.put(obj); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }));
const dbDel = (store, key) => tx(store, 'readwrite').then((s) => new Promise((res, rej) => { const r = s.delete(key); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }));
const dbClear = (store) => tx(store, 'readwrite').then((s) => new Promise((res, rej) => { const r = s.clear(); r.onsuccess = () => res(); r.onerror = () => rej(r.error); }));

/* ---------- 產生本機唯一識別碼 ---------- */
function genUid(prefix) {
  const rand = Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  return (prefix || 'uid') + '-' + rand;
}

/* ---------- Meta ---------- */
const metaGet = (key) => dbGet('meta', key).then((v) => (v ? v.value : undefined));
const metaSet = (key, value) => dbPut('meta', { key, value });

/* ---------- 筆記本 ---------- */
const loadNotebooks = () => dbGetAll('notebooks');
const saveNotebookLocal = (nb) => dbPut('notebooks', nb);
const deleteNotebookLocal = (id) => dbDel('notebooks', id);

/* ---------- 筆記 ---------- */
const loadNotes = () => dbGetAll('notes');
const saveNoteLocal = (note) => dbPut('notes', note);
const deleteNoteLocal = (id) => dbDel('notes', id);

/* ---------- 同步佇列 ----------
 * op = { coll:'notes'|'notebooks', action:'upsert'|'delete', data }
 * 離線期間的變更累積於此，恢復連線後依序上傳。
 */
async function enqueue(op) {
  await dbPut('queue', { coll: op.coll, action: op.action, data: op.data, ts: Date.now() });
}
const loadQueue = () => dbGetAll('queue');
async function removeQueue(id) { await dbDel('queue', id); }
const clearQueue = () => dbClear('queue');

/* ---------- 初次使用的歡迎筆記 ---------- */
async function ensureFirstRun(uid) {
  const done = await metaGet('firstRun');
  if (done) return;
  const now = Date.now();
  const nb = { id: genUid('nb'), ownerId: uid, name: '預設筆記本', sortOrder: 0, deleted: false, createdAt: now, updatedAt: now };
  await saveNotebookLocal(nb);
  const note = {
    id: genUid('nt'), ownerId: uid, notebookId: nb.id,
    title: '歡迎使用 FUHU-NOTE',
    content: '<h3>這是一則歡迎筆記</h3><p>FUHU-NOTE 是類似 Evernote 的筆記工具：</p><ul><li><b>離線優先</b>——斷網也能完整編輯，恢復連線自動同步</li><li><b>Google 帳號登入</b>——手機與電腦登入同一帳號即同步（需完成 Firebase 設定）</li><li><b>筆記本＋標籤＋搜尋＋垃圾桶</b>——完整的分類與管理</li></ul><p>刪掉這則筆記即可開始使用。</p>',
    contentText: '歡迎使用 FUHU-NOTE 這是一則歡迎筆記 FUHU-NOTE 是類似 Evernote 的筆記工具 離線優先 斷網也能完整編輯 恢復連線自動同步 Google 帳號登入 手機與電腦登入同一帳號即同步 需完成 Firebase 設定 筆記本 標籤 搜尋 垃圾桶 完整的分類與管理 刪掉這則筆記即可開始使用',
    tags: ['歡迎'], trash: false, deleted: false,
    createdAt: now, updatedAt: now,
    f: { title: now, content: now, notebookId: now, tags: now, trash: now }
  };
  await saveNoteLocal(note);
  await metaSet('firstRun', uid || 'local');
}

export {
  openDb, dbGetAll, dbGet, dbPut, dbDel, dbClear,
  metaGet, metaSet, genUid,
  loadNotebooks, saveNotebookLocal, deleteNotebookLocal,
  loadNotes, saveNoteLocal, deleteNoteLocal,
  enqueue, loadQueue, removeQueue, clearQueue,
  ensureFirstRun
};
