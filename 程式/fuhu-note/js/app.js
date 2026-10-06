/* =====================================================
 * FUHU-NOTE 筆記 — 主程式
 * 功能：筆記本／筆記／標籤／搜尋／垃圾桶／離線同步／Google 登入／備份
 * ===================================================== */
import {
  genUid, loadNotebooks, saveNotebookLocal, deleteNotebookLocal,
  loadNotes, saveNoteLocal, deleteNoteLocal,
  enqueue, ensureFirstRun, openDb, metaSet
} from './db.js';
import {
  initSync, login, logout, getUid, isCloudMode, uploadImage, cloudUpsert, cloudDelete,
  setSyncStatusCallback, setUserCallback, getStatus, getUser
} from './sync.js';
import {
  el, escapeHtml, htmlToText, fmtTime, toast,
  openModal, confirmDialog, inputModal, openSettings, closeSettings, setEmptyState
} from './ui.js';

/* ---------- 全域狀態 ---------- */
const state = {
  notebooks: [], notes: [],
  selectedNoteId: null,
  view: 'all',            // 'all' | 'trash'
  notebookId: null,       // null = 全部
  tag: null,
  q: '',
  syncStatus: isCloudMode() ? 'logged-out' : 'local',
  editorDirty: false,
  lastEditorUpdatedAt: 0,
  saveTimer: null
};

const DEBOUNCE_MS = 800;

/* =====================================================
 * 資料載入與渲染
 * ===================================================== */
async function loadData() {
  state.notebooks = await loadNotebooks();
  state.notes = await loadNotes();
  await ensureFirstRun(getUid());
  state.notebooks = await loadNotebooks();
  state.notes = await loadNotes();
}

function visibleNotes() {
  return state.notes.filter((n) => {
    if (n.deleted) return false;
    const inTrash = !!n.trash;
    if (state.view === 'trash') { if (!inTrash) return false; }
    else { if (inTrash) return false; }
    if (state.view !== 'trash' && state.notebookId && n.notebookId !== state.notebookId) return false;
    if (state.tag && !(n.tags || []).includes(state.tag)) return false;
    if (state.q) {
      const q = state.q.toLowerCase();
      const hit = (n.title || '').toLowerCase().includes(q) || (n.contentText || '').toLowerCase().includes(q);
      if (!hit) return false;
    }
    return true;
  }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function allTags() {
  const map = {};
  state.notes.forEach((n) => (n.tags || []).forEach((t) => { map[t] = (map[t] || 0) + 1; }));
  return Object.entries(map).sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }));
}

function nbName(id) {
  const nb = state.notebooks.find((n) => n.id === id);
  return nb ? nb.name : '未分類';
}

function renderAll() {
  renderSidebar();
  renderList();
  renderEditor();
  renderUserBox();
}

function renderSidebar() {
  const allCount = state.notes.filter((n) => !n.trash && !n.deleted).length;
  const trashCount = state.notes.filter((n) => n.trash && !n.deleted).length;
  el('count-all').textContent = allCount;
  el('count-trash').textContent = trashCount;
  el('nav-all').classList.toggle('active', state.view === 'all' && !state.notebookId && !state.tag);
  el('nav-trash').classList.toggle('active', state.view === 'trash');

  const nbs = [...state.notebooks].filter((n) => !n.deleted).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));
  el('notebook-list').innerHTML = nbs.map((nb) => {
    const c = state.notes.filter((n) => n.notebookId === nb.id && !n.trash && !n.deleted).length;
    const active = state.notebookId === nb.id;
    return `<div class="side-item ${active ? 'active' : ''}" data-nb="${escapeHtml(nb.id)}">
      <svg viewBox="0 0 24 24" width="15" height="15" style="flex:none"><path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H20v14H6.5A2.5 2.5 0 0 0 4 20.5v-14Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
      <span class="nb-name">${escapeHtml(nb.name)}</span><span class="count">${c}</span>
      <span class="nb-ops">
        <button class="icon-btn" data-op="rename" data-nb="${escapeHtml(nb.id)}" title="重新命名"><svg viewBox="0 0 24 24" width="13" height="13"><path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="icon-btn" data-op="delnb" data-nb="${escapeHtml(nb.id)}" title="刪除筆記本"><svg viewBox="0 0 24 24" width="13" height="13"><path d="M4 7h16M9 7V5h6v2M6 7l1 12h10l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </span>
    </div>`;
  }).join('') || '<div class="side-item" style="color:var(--ink-3)">尚無筆記本</div>';

  const tags = allTags();
  el('tag-list').innerHTML = tags.map((t) => {
    const active = state.tag === t.name;
    return `<button class="side-item ${active ? 'active' : ''}" data-tag="${escapeHtml(t.name)}">
      <svg viewBox="0 0 24 24" width="14" height="14" style="flex:none"><path d="M4 5h7l9 9-7 7-9-9V5Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>
      <span class="tag-chip">${escapeHtml(t.name)}</span><span class="count">${t.count}</span>
    </button>`;
  }).join('') || '<div class="side-item" style="color:var(--ink-3)">尚無標籤</div>';

  // 標題
  if (state.view === 'trash') el('view-title').textContent = '垃圾桶';
  else if (state.notebookId) el('view-title').textContent = nbName(state.notebookId);
  else if (state.tag) el('view-title').textContent = `標籤：${state.tag}`;
  else el('view-title').textContent = '全部筆記';
}

function renderList() {
  const notes = visibleNotes();
  el('note-list').innerHTML = notes.map((n) => {
    const active = n.id === state.selectedNoteId;
    const tags = (n.tags || []).slice(0, 3).map((t) => `<span class="tag-chip">${escapeHtml(t)}</span>`).join('');
    return `<div class="note-card ${active ? 'active' : ''}" data-id="${escapeHtml(n.id)}">
      <h3>${escapeHtml(n.title) || '（無標題）'}</h3>
      <p>${escapeHtml(htmlToText(n.content))}</p>
      <div class="card-foot">
        <span>${fmtTime(n.updatedAt)}</span>
        ${n.notebookId ? `<span>${escapeHtml(nbName(n.notebookId))}</span>` : ''}
        <span class="card-tags">${tags}</span>
        ${state.view === 'trash'
          ? `<span style="margin-left:auto">
              <button class="icon-btn" data-op="restore" data-id="${escapeHtml(n.id)}" title="還原"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
              <button class="icon-btn" data-op="purge" data-id="${escapeHtml(n.id)}" title="永久刪除"><svg viewBox="0 0 24 24" width="14" height="14"><path d="M4 7h16M9 7V5h6v2M6 7l1 12h10l1-12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
            </span>`
          : ''}
      </div>
    </div>`;
  }).join('');

  const showAction = state.view !== 'trash';
  if (notes.length === 0) {
    setEmptyState(true, state.view === 'trash' ? '垃圾桶是空的' : (state.q || state.tag ? '沒有符合條件的筆記' : '這裡還沒有筆記'), showAction);
  } else {
    setEmptyState(false);
  }
  el('view-count').textContent = `${notes.length} 則筆記`;
}

/* =====================================================
 * 編輯器
 * ===================================================== */
function currentNote() { return state.notes.find((n) => n.id === state.selectedNoteId) || null; }

function renderEditor() {
  const note = currentNote();
  const pane = el('editor-pane');
  if (!note) { pane.classList.add('hidden'); return; }
  pane.classList.remove('hidden');
  if (el('editor-title').value !== note.title) el('editor-title').value = note.title;
  if (!state.editorDirty) {
    const content = el('editor-content');
    if (content.innerHTML !== (note.content || '')) content.innerHTML = note.content || '';
  }
  renderTagBar(note);
  state.lastEditorUpdatedAt = note.updatedAt;
  setSaveState('已儲存');
}

function renderTagBar(note) {
  const bar = el('editor-tag-bar');
  const tags = (note.tags || []).map((t) =>
    `<span class="tag-ed">${escapeHtml(t)}<button data-op="rmtag" data-tag="${escapeHtml(t)}" title="移除標籤">×</button></span>`
  ).join('');
  bar.innerHTML = tags +
    `<span class="tag-input-wrap hidden">
       <input id="tag-input" type="text" placeholder="標籤名稱" maxlength="30">
     </span>
     <button id="tag-add-btn" class="tag-add">＋ 標籤</button>`;
  const addBtn = el('tag-add-btn');
  addBtn.onclick = () => {
    el('tag-input-wrap').classList.remove('hidden');
    addBtn.classList.add('hidden');
    const input = el('tag-input');
    input.focus();
    input.onkeydown = (e) => {
      if (e.key === 'Enter') { addTag(input.value.trim()); }
      if (e.key === 'Escape') { el('tag-input-wrap').classList.add('hidden'); addBtn.classList.remove('hidden'); }
    };
    input.onblur = () => { if (input.value.trim()) addTag(input.value.trim()); else { el('tag-input-wrap').classList.add('hidden'); addBtn.classList.remove('hidden'); } };
  };
  bar.querySelectorAll('[data-op="rmtag"]').forEach((btn) => {
    btn.onclick = () => removeTag(btn.dataset.tag);
  });
}

function addTag(name) {
  if (!name) return;
  const note = currentNote();
  if (!note) return;
  note.tags = note.tags || [];
  if (note.tags.includes(name)) { toast('標籤已存在'); }
  else {
    note.tags.push(name);
    touchField(note, 'tags');
    persistNote(note);
    toast(`已加入標籤「${name}」`);
  }
  renderTagBar(note);
}

function removeTag(name) {
  const note = currentNote();
  if (!note) return;
  note.tags = (note.tags || []).filter((t) => t !== name);
  touchField(note, 'tags');
  persistNote(note);
  renderTagBar(note);
}

/* ---------- 儲存 ---------- */
function touchField(note, field) {
  const now = Date.now();
  note.f = note.f || {};
  note.f[field] = now;
  note.updatedAt = now;
  note.version = (note.version || 0) + 1;
}

function persistNote(note) {
  note.ownerId = getUid();
  saveNoteLocal(note).then(() => {
    enqueue({ coll: 'notes', action: 'upsert', data: note });
    cloudUpsert('notes', note);
    renderList();
    renderSidebar();
  });
}

function saveCurrentNote() {
  const note = currentNote();
  if (!note) return;
  const title = el('editor-title').value.trim();
  const content = el('editor-content').innerHTML;
  if (title !== note.title) touchField(note, 'title');
  if (content !== (note.content || '')) touchField(note, 'content');
  note.title = title;
  note.content = content;
  note.contentText = htmlToText(content).toLowerCase();
  persistNote(note);
  state.editorDirty = false;
  setSaveState('已儲存');
}

function setSaveState(text) { el('editor-save-state').textContent = text; }

function debounceSave() {
  state.editorDirty = true;
  setSaveState('儲存中…');
  clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(saveCurrentNote, DEBOUNCE_MS);
}

/* =====================================================
 * 筆記 CRUD
 * ===================================================== */
async function newNote() {
  const now = Date.now();
  let nbId = state.notebookId;
  if (state.view === 'trash' || !nbId || !state.notebooks.some((n) => n.id === nbId)) {
    const first = [...state.notebooks].filter((n) => !n.deleted).sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0))[0];
    nbId = first ? first.id : null;
  }
  const note = {
    id: genUid('nt'), ownerId: getUid(), notebookId: nbId,
    title: '', content: '', contentText: '', tags: [],
    trash: false, deleted: false,
    createdAt: now, updatedAt: now, version: 1,
    f: { title: now, content: now, notebookId: nbId ? now : 0, tags: now, trash: now }
  };
  state.notes.push(note);
  await saveNoteLocal(note);
  enqueue({ coll: 'notes', action: 'upsert', data: note });
  cloudUpsert('notes', note);
  state.view = 'all'; state.notebookId = nbId; state.tag = null; state.q = '';
  el('search-input').value = '';
  state.selectedNoteId = note.id;
  renderAll();
  el('editor-title').focus();
  toast('已建立新筆記');
}

function trashNote() {
  const note = currentNote();
  if (!note) return;
  touchField(note, 'trash');
  note.trash = true;
  persistNote(note);
  state.selectedNoteId = null;
  renderAll();
  toast('已移到垃圾桶');
}

function restoreNote(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  touchField(note, 'trash');
  note.trash = false;
  persistNote(note);
  toast('已還原');
}

function purgeNote(id) {
  const note = state.notes.find((n) => n.id === id);
  if (!note) return;
  confirmDialog('永久刪除筆記', `確定要永久刪除「${note.title || '無標題'}」嗎？此動作無法復原。`, () => {
    deleteNoteLocal(id).then(() => {
      enqueue({ coll: 'notes', action: 'delete', data: { id } });
      cloudDelete('notes', id);
      state.notes = state.notes.filter((n) => n.id !== id);
      if (state.selectedNoteId === id) state.selectedNoteId = null;
      renderAll();
      toast('已永久刪除');
    });
  }, '永久刪除');
}

/* =====================================================
 * 筆記本
 * ===================================================== */
function newNotebook() {
  inputModal('新增筆記本', '筆記本名稱', '例如：工作、生活、專案', '', (name) => {
    const now = Date.now();
    const nb = {
      id: genUid('nb'), ownerId: getUid(), name,
      sortOrder: state.notebooks.filter((n) => !n.deleted).length,
      deleted: false, createdAt: now, updatedAt: now,
      f: { name: now, sortOrder: now }
    };
    state.notebooks.push(nb);
    saveNotebookLocal(nb).then(() => {
      enqueue({ coll: 'notebooks', action: 'upsert', data: nb });
      cloudUpsert('notebooks', nb);
      state.notebookId = nb.id; state.view = 'all'; state.tag = null;
      renderAll();
      toast(`已建立筆記本「${name}」`);
    });
  });
}

function renameNotebook(id) {
  const nb = state.notebooks.find((n) => n.id === id);
  if (!nb) return;
  inputModal('重新命名筆記本', '筆記本名稱', '', nb.name, (name) => {
    touchField(nb, 'name');
    nb.name = name;
    saveNotebookLocal(nb).then(() => {
      enqueue({ coll: 'notebooks', action: 'upsert', data: nb });
      cloudUpsert('notebooks', nb);
      renderAll();
      toast('已重新命名');
    });
  });
}

function deleteNotebook(id) {
  const nb = state.notebooks.find((n) => n.id === id);
  if (!nb) return;
  confirmDialog('刪除筆記本', `確定刪除筆記本「${nb.name}」嗎？其中的筆記會移入「未分類」並保留。`, () => {
    deleteNotebookLocal(id).then(() => {
      enqueue({ coll: 'notebooks', action: 'delete', data: { id } });
      cloudDelete('notebooks', id);
      state.notebooks = state.notebooks.filter((n) => n.id !== id);
      const moved = state.notes.filter((n) => n.notebookId === id);
      moved.forEach((note) => { touchField(note, 'notebookId'); note.notebookId = null; persistNote(note); });
      if (state.notebookId === id) state.notebookId = null;
      renderAll();
      toast('已刪除筆記本');
    });
  });
}

/* =====================================================
 * 編輯器工具列
 * ===================================================== */
function execCmd(cmd, value) {
  el('editor-content').focus();
  document.execCommand(cmd, false, value);
  debounceSave();
}

function insertTodo() {
  el('editor-content').focus();
  document.execCommand('insertHTML', false, '<div class="todo"><input type="checkbox"><span>&nbsp;</span></div><div>&nbsp;</div>');
  debounceSave();
}

function insertLink() {
  const url = prompt('輸入網址（含 https://）');
  if (url) { execCmd('createLink', url); toast('已插入連結'); }
}

function insertImage(file) {
  if (!file) return;
  const done = (url) => {
    el('editor-content').focus();
    document.execCommand('insertHTML', false, `<img src="${url}" alt="附件圖片">`);
    debounceSave();
  };
  if (isCloudMode() && state.user) {
    uploadImage(file).then(done).catch(() => {
      readAsDataURL(file).then(done);
      toast('雲端上傳失敗，已改用本機圖片', 'err');
    });
  } else {
    readAsDataURL(file).then(done);
  }
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* =====================================================
 * 備份（匯出 / 匯入）
 * ===================================================== */
function exportBackup() {
  const data = {
    app: 'FUHU-NOTE', version: '1.2',
    exportedAt: new Date().toISOString(),
    notebooks: state.notebooks.filter((n) => !n.deleted),
    notes: state.notes.filter((n) => !n.deleted)
  };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  a.href = URL.createObjectURL(blob);
  a.download = `FUHU-NOTE-備份-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
  toast('備份檔已匯出，請存入 D:\\FUHU-NOTE\\備份');
}

function importBackup(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = async () => {
    try {
      const data = JSON.parse(r.result);
      if (!data.notes || !Array.isArray(data.notes)) throw new Error('格式錯誤');
      confirmDialog('匯入備份', `將以備份內容（${data.notes.length} 則筆記）取代本機現有資料。確定繼續？`, async () => {
        const uid = getUid();
        const now = Date.now();
        for (const nb of (data.notebooks || [])) { nb.ownerId = uid; nb.deleted = false; nb.f = nb.f || { name: nb.updatedAt || now, sortOrder: nb.updatedAt || now }; await saveNotebookLocal(nb); enqueue({ coll: 'notebooks', action: 'upsert', data: nb }); cloudUpsert('notebooks', nb); }
        for (const note of data.notes) { note.ownerId = uid; note.deleted = false; note.f = note.f || {}; await saveNoteLocal(note); enqueue({ coll: 'notes', action: 'upsert', data: note }); cloudUpsert('notes', note); }
        await loadData();
        renderAll();
        toast('備份已匯入');
      });
    } catch (e) {
      toast('備份檔格式無效：' + e.message, 'err');
    }
  };
  r.readAsText(file);
}

/* =====================================================
 * 使用者與同步狀態
 * ===================================================== */
function renderUserBox() {
  const user = state.user;
  const cloud = isCloudMode();
  el('login-btn').classList.toggle('hidden', !cloud || !!user);
  el('user-info').classList.toggle('hidden', !user);
  if (user) el('user-name').textContent = user.displayName || user.email || '已登入';
  renderSettingsUser();
}

function renderSettingsUser() {
  const box = el('settings-user');
  const cloud = isCloudMode();
  if (!cloud) {
    box.innerHTML = '<p class="set-note">本機模式：資料僅存於本裝置。請依《Firebase設定指南》設定後即可使用 Google 帳號同步。</p>';
    el('settings-mode').textContent = '同步：未設定 Firebase（本機模式）';
    return;
  }
  if (!state.user) {
    box.innerHTML = '<button id="settings-login" class="btn primary">使用 Google 帳號登入</button>';
    el('settings-login').onclick = doLogin;
    el('settings-mode').textContent = '同步：尚未登入';
    return;
  }
  box.innerHTML = `<p class="set-note">已登入：<b>${escapeHtml(state.user.displayName || state.user.email)}</b>（${escapeHtml(state.user.email || '')}）</p>`;
  el('settings-mode').textContent = '同步：Google 帳號跨裝置同步已啟用';
}

async function doLogin() {
  try {
    await login();
  } catch (e) {
    toast('登入失敗：' + (e.message || '請稍後再試'), 'err');
  }
}

/* ---------- 同步狀態 UI ---------- */
const STATUS_TEXT = {
  'local': '本機模式',
  'logged-out': '未登入（本機模式）',
  'syncing': '同步中…',
  'synced': '已同步',
  'offline': '離線（待同步）',
  'error': '同步異常'
};
const STATUS_CLASS = { 'syncing': 'syncing', 'synced': 'online', 'offline': 'offline', 'error': 'error', 'local': '', 'logged-out': '' };

function setSyncStatusUI(status) {
  state.syncStatus = status;
  el('sync-text').textContent = STATUS_TEXT[status] || status;
  el('sync-dot').className = 'dot ' + (STATUS_CLASS[status] || '');
}

/* =====================================================
 * 事件綁定
 * ===================================================== */
function wireEvents() {
  // 側欄導覽
  el('nav-all').onclick = () => { state.view = 'all'; state.notebookId = null; state.tag = null; renderAll(); };
  el('nav-trash').onclick = () => { state.view = 'trash'; state.notebookId = null; state.tag = null; renderAll(); };
  el('btn-new-notebook').onclick = newNotebook;
  el('btn-new-note').onclick = newNote;
  el('empty-action').onclick = newNote;

  // 搜尋
  el('search-input').addEventListener('input', (e) => { state.q = e.target.value.trim(); renderList(); });

  // 側欄委派（筆記本、標籤）
  el('notebook-list').addEventListener('click', (e) => {
    const opBtn = e.target.closest('[data-op]');
    if (opBtn) {
      e.stopPropagation();
      const id = opBtn.dataset.nb;
      if (opBtn.dataset.op === 'rename') renameNotebook(id);
      if (opBtn.dataset.op === 'delnb') deleteNotebook(id);
      return;
    }
    const item = e.target.closest('[data-nb]');
    if (item) { state.view = 'all'; state.notebookId = item.dataset.nb; state.tag = null; renderAll(); }
  });
  el('tag-list').addEventListener('click', (e) => {
    const item = e.target.closest('[data-tag]');
    if (item) { state.view = 'all'; state.tag = item.dataset.tag; state.notebookId = null; renderAll(); }
  });

  // 筆記列表
  el('note-list').addEventListener('click', (e) => {
    const opBtn = e.target.closest('[data-op]');
    if (opBtn) {
      e.stopPropagation();
      if (opBtn.dataset.op === 'restore') restoreNote(opBtn.dataset.id);
      if (opBtn.dataset.op === 'purge') purgeNote(opBtn.dataset.id);
      return;
    }
    const card = e.target.closest('.note-card');
    if (card) selectNote(card.dataset.id);
  });

  // 編輯器
  el('editor-title').addEventListener('input', debounceSave);
  el('editor-content').addEventListener('input', debounceSave);
  el('cmd-bold').onclick = () => execCmd('bold');
  el('cmd-italic').onclick = () => execCmd('italic');
  el('cmd-underline').onclick = () => execCmd('underline');
  el('cmd-strike').onclick = () => execCmd('strikeThrough');
  el('cmd-h2').onclick = () => execCmd('formatBlock', '<h2>');
  el('cmd-h3').onclick = () => execCmd('formatBlock', '<h3>');
  el('cmd-ul').onclick = () => execCmd('insertUnorderedList');
  el('cmd-ol').onclick = () => execCmd('insertOrderedList');
  el('cmd-todo').onclick = insertTodo;
  el('cmd-link').onclick = insertLink;
  el('cmd-image').onclick = () => el('image-file').click();
  el('image-file').addEventListener('change', (e) => { insertImage(e.target.files[0]); e.target.value = ''; });
  el('btn-trash-note').onclick = trashNote;

  // 行動版
  el('btn-menu').onclick = () => el('sidebar').classList.toggle('open');
  el('btn-mobile-menu').onclick = () => el('sidebar').classList.add('open');
  el('btn-back-list').onclick = () => { el('editor-pane').classList.add('hidden'); };
  // 行動版：點側欄內的按鈕後自動收合；點主區內容也收合
  el('sidebar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && b !== el('btn-menu')) el('sidebar').classList.remove('open');
  });
  el('main').addEventListener('click', () => el('sidebar').classList.remove('open'));

  // 登入 / 設定
  el('login-btn').onclick = doLogin;
  el('btn-settings').onclick = openSettings;
  el('settings-close').onclick = closeSettings;
  el('btn-export').onclick = exportBackup;
  el('set-export').onclick = exportBackup;
  el('set-import').onclick = () => el('import-file').click();
  el('import-file').addEventListener('change', (e) => { importBackup(e.target.files[0]); e.target.value = ''; });
  el('set-clear-local').onclick = () => {
    confirmDialog('清除本機資料', '將刪除本機所有筆記與筆記本（雲端資料不受影響）。確定繼續？', async () => {
      for (const n of state.notes) { await deleteNoteLocal(n.id); enqueue({ coll: 'notes', action: 'delete', data: { id: n.id } }); cloudDelete('notes', n.id); }
      for (const nb of state.notebooks) { await deleteNotebookLocal(nb.id); enqueue({ coll: 'notebooks', action: 'delete', data: { id: nb.id } }); cloudDelete('notebooks', nb.id); }
      state.notes = []; state.notebooks = []; state.selectedNoteId = null;
      await ensureFirstRun(getUid());
      await loadData();
      renderAll();
      toast('本機資料已清除');
    }, '清除');
  };
}

function selectNote(id) {
  state.selectedNoteId = id;
  state.editorDirty = false;
  renderList();
  renderEditor();
  // 行動版：進入編輯畫面
  if (window.innerWidth <= 820) { el('editor-pane').classList.remove('hidden'); el('btn-back-list').classList.remove('hidden'); }
}

/* =====================================================
 * 初始化
 * ===================================================== */
async function init() {
  setSyncStatusCallback(setSyncStatusUI);
  setUserCallback((user) => { state.user = user; renderUserBox(); renderList(); renderSidebar(); });
  await openDb();
  await loadData();
  renderAll();
  wireEvents();
  await initSync();
  setSyncStatusUI(getStatus());
  state.user = getUser();
  renderUserBox();
}

init();
