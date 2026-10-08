/* =====================================================
 * FUHU-NOTE 筆記 — 主程式
 * 功能：筆記本／筆記／標籤／搜尋／垃圾桶／離線同步／Google 登入／備份
 * ===================================================== */
import {
  genUid, loadNotebooks, saveNotebookLocal, deleteNotebookLocal,
  loadNotes, saveNoteLocal, deleteNoteLocal,
  enqueue, ensureFirstRun, openDb, metaSet, TAG_PRESETS
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
      const titleHit = (n.title || '').toLowerCase().includes(q);
      const body = (n.contentText || '').toLowerCase() || htmlToText(n.content).toLowerCase();
      if (!titleHit && !body.includes(q)) return false;
    }
    return true;
  }).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/* 筆記內容中的待辦進度（已完成/總數）；以 .todo 結構判斷，不依賴 checked 屬性 */
function todoStatsOf(html) {
  if (!html) return null;
  const div = document.createElement('div');
  div.innerHTML = html;
  const todos = div.querySelectorAll('.todo');
  if (!todos.length) return null;
  return { done: div.querySelectorAll('.todo.done').length, total: todos.length };
}

/* 提醒時間顯示（MM/DD HH:mm） */
function fmtRemind(ts) {
  const d = new Date(ts);
  const pad = (x) => String(x).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

  const usageArr = allTags();
  const usageMap = {};
  usageArr.forEach((u) => { usageMap[u.name] = u.count; });
  const groupDefs = [
    { key: 'topic', label: '主題' },
    { key: 'status', label: '狀態' }
  ];
  const extraTags = usageArr.filter((u) => !TAG_PRESETS.topic.includes(u.name) && !TAG_PRESETS.status.includes(u.name)).map((u) => u.name);
  if (extraTags.length) groupDefs.push({ key: 'extra', label: '其他' });
  el('tag-list').innerHTML = groupDefs.map((g) => {
    const names = g.key === 'extra' ? extraTags : TAG_PRESETS[g.key];
    const items = names.map((name) => {
      const count = usageMap[name] || 0;
      const active = state.tag === name;
      return `<button class="side-item ${active ? 'active' : ''}" data-tag="${escapeHtml(name)}">
        <span class="tag-chip ${g.key === 'extra' ? '' : g.key}">${escapeHtml(name)}</span><span class="count ${count ? '' : 'zero'}">${count}</span>
      </button>`;
    }).join('');
    return `<div class="side-tag-group"><div class="side-tag-head">${g.label}</div>${items}</div>`;
  }).join('');

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
    const tagCls = (t) => (TAG_PRESETS.topic.includes(t) ? 'theme' : TAG_PRESETS.status.includes(t) ? 'status' : '');
    const tags = (n.tags || []).slice(0, 3).map((t) => `<span class="tag-chip ${tagCls(t)}">${escapeHtml(t)}</span>`).join('');
    const t = todoStatsOf(n.content);
    const remind = n.remindAt && !n.trash ? `<span class="remind-chip" title="提醒時間">${fmtRemind(n.remindAt)}</span>` : '';
    return `<div class="note-card ${active ? 'active' : ''}" data-id="${escapeHtml(n.id)}">
      <h3>${escapeHtml(n.title) || '（無標題）'}</h3>
      <p>${escapeHtml(htmlToText(n.content))}</p>
      <div class="card-foot">
        ${t ? `<span class="todo-stat" title="待辦完成進度">${t.done}/${t.total}</span>` : ''}
        ${remind}
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
    // 既有筆記中的舊圖片（尚未包刪除鈕）自動補上刪除按鈕
    content.querySelectorAll('img.fn-img').forEach((img) => {
      if (img.parentElement && img.parentElement.classList.contains('fn-wrap')) return;
      const w = document.createElement('span');
      w.className = 'fn-wrap';
      w.innerHTML = '<span class="fn-del" role="button" title="刪除圖片">×</span>';
      img.parentNode.insertBefore(w, img);
      w.insertBefore(img, w.firstChild);
    });
  }
  renderTagBar(note);
  el('cmd-remind').classList.toggle('has-remind', !!note.remindAt);
  state.lastEditorUpdatedAt = note.updatedAt;
  setSaveState('已儲存');
}

function renderTagBar(note) {
  const bar = el('editor-tag-bar');
  const tags = (note.tags || []).map((t) =>
    `<span class="tag-ed">${escapeHtml(t)}<button data-op="rmtag" data-tag="${escapeHtml(t)}" title="移除標籤">×</button></span>`
  ).join('');
  bar.innerHTML = tags +
    `<span id="tag-input-wrap" class="tag-input-wrap hidden">
       <input id="tag-input" type="text" list="tag-suggest" placeholder="標籤名稱" maxlength="30">
     </span>
     <button id="tag-add-btn" class="tag-add">＋ 標籤</button>`;
  // 標籤輸入自動補全（既有＋預設）
  let dl = el('tag-suggest');
  if (!dl) { dl = document.createElement('datalist'); dl.id = 'tag-suggest'; document.body.appendChild(dl); }
  const suggest = [...new Set([...TAG_PRESETS.topic, ...TAG_PRESETS.status, ...allTags().map((u) => u.name)])];
  dl.innerHTML = suggest.map((t) => `<option value="${escapeHtml(t)}">`).join('');
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
    trash: false, deleted: false, remindAt: null, reminded: false,
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
  // 檔案管理員可選非圖片檔（accept 混合型），非圖片予以提示；
  // 部分來源 file.type 為空，再以副檔名判斷
  const fname = (file.name || '').toLowerCase();
  const isImg = file.type ? file.type.startsWith('image/') : /\.(jpe?g|png|gif|webp|heic|heif|bmp|avif)$/.test(fname);
  if (!isImg) {
    toast('請選擇圖片檔案', 'err');
    return;
  }
  const done = (url) => {
    const ed = el('editor-content');
    try { ed.focus(); } catch (e) {}
    // 手機從照片選擇器返回後，focus 為非同步、游標可能不在編輯器內，
    // 先將游標放回編輯器末端再插入，避免 execCommand 靜默失敗。
    const sel = window.getSelection();
    let inEditor = false;
    let caretInWrap = false;
    if (sel && sel.rangeCount) {
      try {
        const r = sel.getRangeAt(0);
        inEditor = ed.contains(r.commonAncestorContainer);
        caretInWrap = !!(r.commonAncestorContainer.closest && r.commonAncestorContainer.closest('.fn-wrap'));
      } catch (e) {}
    }
    // 游標不在編輯器內、或游標在圖片包裝內（會造成雙層包裹）時，移到編輯器末端
    if (!inEditor || caretInWrap) {
      try {
        const r = document.createRange();
        r.selectNodeContents(ed);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      } catch (e) {}
    }
    const html = `<span class="fn-wrap"><img class="fn-img" src="${url}" alt="附件圖片"><span class="fn-del" role="button" title="刪除圖片">×</span></span>`;
    const before = ed.querySelectorAll('.fn-img').length;
    let ok = false;
    try { ok = document.execCommand('insertHTML', false, html); } catch (e) { ok = false; }
    // execCommand 失敗（或未產生圖片）時，逐步備援：附加至末端 → 直接寫入 innerHTML
    if (!ok || ed.querySelectorAll('.fn-img').length === before) {
      try { ed.insertAdjacentHTML('beforeend', `<div>${html}</div>`); } catch (e) {}
    }
    if (ed.querySelectorAll('.fn-img').length === before) {
      try { ed.innerHTML = ed.innerHTML + `<div>${html}</div>`; } catch (e) {}
    }
    saveCurrentNote();
    toast('已插入照片');
  };
  if (isCloudMode() && state.user) {
    uploadImage(file).then(done).catch(() => {
      toast('雲端上傳失敗，已改用本機圖片', 'err');
      readAsDataURL(file).then(done).catch(() => toast('插入照片失敗（無法讀取照片）', 'err'));
    });
  } else {
    readAsDataURL(file).then(done).catch(() => toast('插入照片失敗（無法讀取照片）', 'err'));
  }
}

function readAsDataURL(file) {
  return new Promise((resolve, reject) => {
    // 方法二：原始讀取（不壓縮）——供壓縮路徑失敗時回退
    const fallbackRaw = () => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(new Error('file-read-failed'));
      r.readAsDataURL(file);
    };
    // 方法一：壓縮（Image＋Canvas）——格式無法解碼（如部分 HEIC）時自動退回方法二
    if (file.type && file.type.startsWith('image/')) {
      let objUrl;
      try { objUrl = URL.createObjectURL(file); } catch (e) { fallbackRaw(); return; }
      const img = new Image();
      img.onload = () => {
        try {
          const MAX = 1600;
          let w = img.naturalWidth, h = img.naturalHeight;
          if (!w || !h) { URL.revokeObjectURL(objUrl); fallbackRaw(); return; }
          if (w > MAX || h > MAX) {
            const s = Math.min(MAX / w, MAX / h);
            w = Math.round(w * s);
            h = Math.round(h * s);
          }
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const ctx = c.getContext('2d');
          if (!ctx) { URL.revokeObjectURL(objUrl); fallbackRaw(); return; }
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          URL.revokeObjectURL(objUrl);
          resolve(c.toDataURL('image/jpeg', 0.82));
        } catch (e) {
          try { URL.revokeObjectURL(objUrl); } catch (e2) {}
          fallbackRaw();
        }
      };
      img.onerror = () => {
        try { URL.revokeObjectURL(objUrl); } catch (e2) {}
        fallbackRaw();
      };
      img.src = objUrl;
    } else {
      fallbackRaw();
    }
  });
}

/* =====================================================
 * 備份（匯出 / 匯入）＋ Markdown 匯出
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

/* 依副檔名分流：FUHU-NOTE JSON／Joplin Markdown（可多檔）／Evernote ENEX */
async function importFiles(files) {
  if (!files || !files.length) return;
  const list = [...files];
  const md = list.filter((f) => /\.md$/i.test(f.name));
  const enex = list.find((f) => /\.enex$/i.test(f.name));
  const json = list.find((f) => /\.json$/i.test(f.name));
  if (md.length) { await importJoplinMD(md); return; }
  if (enex) { await importENEX(enex); return; }
  if (json) { importJSONBackup(json); return; }
  toast('不支援的備份檔格式（支援 .json／.md／.enex）', 'err');
}

/* FUHU-NOTE 自家 JSON 備份（完整取代） */
function importJSONBackup(file) {
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

/* ---------- Joplin 匯入（Markdown 資料夾／單檔，可多檔） ---------- */
function parseJoplinMD(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  let title = '', tags = [], created = null, updated = null, content = '';
  if (m) {
    const meta = m[1];
    content = m[2];
    const tm = meta.match(/^title:\s*(.+)$/m);
    if (tm) title = tm[1].trim().replace(/^["']|["']$/g, '');
    const tagm = meta.match(/^tags:\s*(.+)$/m);
    if (tagm) {
      const raw = tagm[1].trim();
      tags = raw.replace(/^\[|\]$/g, '').split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    }
    const cm = meta.match(/^created_time:\s*(.+)$/m);
    if (cm) created = Math.round(parseFloat(cm[1].trim()) * 1000);
    const um = meta.match(/^updated_time:\s*(.+)$/m);
    if (um) updated = Math.round(parseFloat(um[1].trim()) * 1000);
  } else {
    const lines = text.split('\n');
    title = (lines[0] || '').replace(/^#\s*/, '').trim();
    content = text;
  }
  return { title: title || '（匯入）', tags, created, updated, content: mdToHtml(content) };
}

/* 簡化 Markdown → HTML（支援待辦／標題／清單／圖片／連結／粗斜體） */
function mdToHtml(md) {
  const lines = (md || '').split('\n');
  let html = '';
  lines.forEach((line) => {
    const l = line.trim();
    if (!l) { return; }
    const tm = l.match(/^[-*]?\s*\[( |x|X)\]\s+(.*)/);
    if (tm) {
      const done = tm[1].toLowerCase() === 'x';
      html += `<div class="todo${done ? ' done' : ''}"><input type="checkbox"${done ? ' checked' : ''}><span>${escapeHtml(tm[2])}</span></div>`;
      return;
    }
    const hm = l.match(/^(#{1,3})\s+(.*)/);
    if (hm) { html += `<h${hm[1].length}>${escapeHtml(hm[2])}</h${hm[1].length}>`; return; }
    const lm = l.match(/^[-*]\s+(.*)/);
    if (lm) { html += `<div>• ${escapeHtml(lm[1])}</div>`; return; }
    if (/^-{3,}$/.test(l)) { html += '<hr>'; return; }
    const im = l.match(/!\[(.*?)\]\((.*?)\)/);
    if (im) {
      html += `<span class="fn-wrap"><img class="fn-img" src="${im[2]}" alt="${escapeHtml(im[1])}"><span class="fn-del" role="button" title="刪除圖片">×</span></span>`;
      return;
    }
    let out = l.replace(/\[(.*?)\]\((.*?)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    out = out.replace(/\*\*(.*?)\*\*/g, '<b>$1</b>').replace(/__(.*?)__/g, '<b>$1</b>').replace(/\*(.*?)\*/g, '<i>$1</i>');
    html += `<div>${out}</div>`;
  });
  return html;
}

async function importJoplinMD(files) {
  let count = 0;
  for (const f of files) {
    let text;
    try { text = await f.text(); } catch (e) { continue; }
    const note = parseJoplinMD(text);
    if (!note.title && !note.content) continue;
    await createImportedNote(note);
    count++;
  }
  await loadData();
  renderAll();
  toast(`已匯入 ${count} 則筆記（Joplin）`);
}

/* ---------- Evernote 匯入（ENEX） ---------- */
function b64ToUtf8(b64) {
  try {
    const bytes = Uint8Array.from(atob(b64.replace(/\s+/g, '')), (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch (e) { return ''; }
}

function enmlToHtml(enml) {
  try {
    const doc = new DOMParser().parseFromString(enml, 'text/xml');
    const note = doc.querySelector('en-note');
    return note ? note.innerHTML : '';
  } catch (e) { return ''; }
}

function parseENEXDate(s) {
  if (!s) return null;
  const m = s.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z|[+-]\d{4})?/);
  if (!m) return null;
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
}

function parseENEX(xml) {
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('無法解析 XML');
  const notes = [];
  doc.querySelectorAll('note').forEach((nEl) => {
    const title = (nEl.querySelector('title')?.textContent || '').trim();
    const tags = [...nEl.querySelectorAll('tag')].map((t) => t.textContent.trim()).filter(Boolean);
    const created = parseENEXDate(nEl.querySelector('created')?.textContent);
    const updated = parseENEXDate(nEl.querySelector('updated')?.textContent);
    let content = '';
    const contentEl = nEl.querySelector('content');
    if (contentEl) {
      const enml = b64ToUtf8((contentEl.textContent || '').trim());
      content = enmlToHtml(enml);
    }
    // 資源（圖片/附件）依序替換 <en-media> 標記
    const resources = [...nEl.querySelectorAll('resource')];
    resources.forEach((res) => {
      const dataEl = res.querySelector('data');
      if (!dataEl) return;
      const mime = (res.querySelector('mime')?.textContent || '').trim();
      const fnameEl = res.querySelector('resource-attributes file-name');
      const name = fnameEl ? fnameEl.textContent.trim() : '';
      const dataUrl = `data:${mime || 'application/octet-stream'};base64,${dataEl.textContent.replace(/\s+/g, '')}`;
      content = content.replace(/<en-media[^>]*\/?>/, () => {
        const alt = escapeHtml(name || '附件');
        return mime.startsWith('image/')
          ? `<span class="fn-wrap"><img class="fn-img" src="${dataUrl}" alt="${alt}"><span class="fn-del" role="button" title="刪除圖片">×</span></span>`
          : `<span class="fn-wrap"><a class="fn-file" href="${dataUrl}" target="_blank" rel="noopener">📎 ${alt}</a><span class="fn-del" role="button" title="刪除附件">×</span></span>`;
      });
    });
    // 移除殘留的 <en-media>
    content = content.replace(/<en-media[^>]*\/?>/g, '');
    if (title || content) notes.push({ title, content, tags, created, updated });
  });
  return notes;
}

async function importENEX(file) {
  let text;
  try { text = await file.text(); } catch (e) { toast('無法讀取檔案', 'err'); return; }
  let notes;
  try { notes = parseENEX(text); } catch (e) { toast('ENEX 格式錯誤：' + e.message, 'err'); return; }
  if (!notes.length) { toast('ENEX 中沒有可匯入的筆記', 'err'); return; }
  let count = 0;
  for (const n of notes) { await createImportedNote(n); count++; }
  await loadData();
  renderAll();
  toast(`已匯入 ${count} 則筆記（Evernote）`);
}

/* 建立匯入的筆記（保留原時間與標籤，匯入「未分類」） */
async function createImportedNote({ title, content, tags, created, updated }) {
  const now = Date.now();
  const note = {
    id: genUid('nt'), ownerId: getUid(), notebookId: null,
    title: title || '（匯入）', content: content || '', contentText: htmlToText(content).toLowerCase(), tags: tags || [],
    trash: false, deleted: false, remindAt: null, reminded: false,
    createdAt: created || now, updatedAt: updated || now, version: 1,
    f: { title: now, content: now, tags: now, createdAt: now, updatedAt: now, trash: now }
  };
  await saveNoteLocal(note);
  enqueue({ coll: 'notes', action: 'upsert', data: note });
  cloudUpsert('notes', note);
}

/* ---------- Markdown 匯出 ---------- */
function htmlToMarkdown(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  div.querySelectorAll('img').forEach((img) => img.replaceWith(`![${img.alt || '附件圖片'}](${img.src})`));
  div.querySelectorAll('.todo').forEach((t) => {
    const ck = t.querySelector('input[type="checkbox"]');
    const txt = t.textContent.trim();
    t.replaceWith(`${ck && ck.checked ? '[x]' : '[ ]'} ${txt}`);
  });
  div.querySelectorAll('a').forEach((a) => a.replaceWith(`[${a.textContent}](${a.href})`));
  let md = '';
  div.childNodes.forEach((node) => {
    if (node.nodeType === 3) { md += node.textContent; return; }
    const tg = node.tagName;
    if (tg === 'DIV' || tg === 'P') md += node.textContent.trim() + '\n\n';
    else if (tg === 'H1') md += '# ' + node.textContent.trim() + '\n\n';
    else if (tg === 'H2') md += '## ' + node.textContent.trim() + '\n\n';
    else if (tg === 'H3') md += '### ' + node.textContent.trim() + '\n\n';
    else if (tg === 'LI') md += '- ' + node.textContent.trim() + '\n';
    else if (tg === 'HR') md += '---\n\n';
    else md += node.textContent.trim() + '\n\n';
  });
  return md.replace(/\n{3,}/g, '\n\n').trim();
}

function downloadTextFile(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function exportNoteMD() {
  const note = currentNote();
  if (!note) return;
  const title = note.title || '未命名筆記';
  const md = `# ${title}\n\n${htmlToMarkdown(note.content)}\n\n---\n- 標籤：${(note.tags || []).join('、') || '無'}\n- 更新：${new Date(note.updatedAt).toLocaleString('zh-TW')}`;
  downloadTextFile(`${title}.md`, md);
  toast('已匯出本則筆記（Markdown）');
}

function exportAllMD() {
  const notes = state.notes.filter((n) => !n.trash && !n.deleted);
  if (!notes.length) { toast('沒有可匯出的筆記', 'err'); return; }
  const parts = notes.map((n) => {
    const title = n.title || '未命名筆記';
    return `# ${title}\n\n${htmlToMarkdown(n.content)}\n\n---\n- 標籤：${(n.tags || []).join('、') || '無'}\n- 更新：${new Date(n.updatedAt).toLocaleString('zh-TW')}`;
  });
  const d = new Date();
  const pad = (x) => String(x).padStart(2, '0');
  downloadTextFile(`FUHU-NOTE-全部筆記-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.md`, parts.join('\n\n---\n\n'));
  toast(`已匯出 ${notes.length} 則筆記（Markdown）`);
}

/* =====================================================
 * 筆記提醒
 * ===================================================== */
function toggleRemindBar() {
  const note = currentNote();
  if (!note) return;
  const bar = el('remind-bar');
  bar.classList.toggle('hidden');
  if (note.remindAt) {
    const d = new Date(note.remindAt);
    const pad = (x) => String(x).padStart(2, '0');
    el('remind-input').value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } else {
    el('remind-input').value = '';
  }
  if (!bar.classList.contains('hidden') && Notification && typeof Notification.requestPermission === 'function') {
    Notification.requestPermission().catch(() => {});
  }
}

function setReminder() {
  const note = currentNote();
  const v = el('remind-input').value;
  if (!note || !v) { toast('請選擇提醒時間', 'err'); return; }
  const ts = new Date(v).getTime();
  touchField(note, 'remindAt');
  note.remindAt = ts;
  note.reminded = false;
  persistNote(note);
  enqueue({ coll: 'notes', action: 'upsert', data: note });
  cloudUpsert('notes', note);
  el('cmd-remind').classList.add('has-remind');
  el('remind-bar').classList.add('hidden');
  renderList();
  toast('提醒已設定');
}

function clearReminder() {
  const note = currentNote();
  if (!note) return;
  touchField(note, 'remindAt');
  note.remindAt = null;
  note.reminded = false;
  persistNote(note);
  enqueue({ coll: 'notes', action: 'upsert', data: note });
  cloudUpsert('notes', note);
  el('cmd-remind').classList.remove('has-remind');
  el('remind-bar').classList.add('hidden');
  renderList();
  toast('提醒已清除');
}

/* 每分鐘檢查到期提醒（App 開啟時生效；背景請開啟通知權限） */
function checkReminders() {
  const now = Date.now();
  state.notes.forEach((n) => {
    if (!n.trash && !n.deleted && n.remindAt && n.remindAt <= now && !n.reminded) {
      n.reminded = true;
      persistNote(n);
      enqueue({ coll: 'notes', action: 'upsert', data: n });
      cloudUpsert('notes', n);
      const title = n.title || '未命名筆記';
      toast(`提醒：${title}`, 'remind');
      try {
        if (Notification && Notification.permission === 'granted') {
          if (navigator.serviceWorker) {
            navigator.serviceWorker.ready.then((reg) => reg.showNotification('FUHU-NOTE 提醒', { body: title, icon: 'icons/icon-192.png' })).catch(() => {});
          } else {
            new Notification('FUHU-NOTE 提醒', { body: title, icon: 'icons/icon-192.png' });
          }
        }
      } catch (e) {}
    }
  });
}

/* =====================================================
 * 附件（非圖片檔案，雲端 Storage）
 * ===================================================== */
function insertAttachment(file) {
  if (!file) return;
  if (!state.user) { toast('請先登入 Google 帳號才能上傳附件', 'err'); return; }
  if (file.size > 50 * 1024 * 1024) { toast('附件上限 50MB', 'err'); return; }
  toast('附件上傳中…');
  uploadImage(file).then((url) => {
    const name = escapeHtml(file.name);
    const html = `<span class="fn-wrap"><a class="fn-file" href="${url}" target="_blank" rel="noopener">📎 ${name}</a><span class="fn-del" role="button" title="刪除附件">×</span></span>`;
    const ed = el('editor-content');
    const sel = window.getSelection();
    let inEditor = false;
    if (sel && sel.rangeCount) {
      try { inEditor = ed.contains(sel.getRangeAt(0).commonAncestorContainer); } catch (e) {}
    }
    try {
      ed.focus();
      if (!inEditor) {
        const r = document.createRange();
        r.selectNodeContents(ed);
        r.collapse(false);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      if (!document.execCommand('insertHTML', false, html)) ed.insertAdjacentHTML('beforeend', html);
    } catch (e) {
      ed.insertAdjacentHTML('beforeend', html);
    }
    saveCurrentNote();
    toast('已插入附件');
  }).catch(() => toast('附件上傳失敗（請確認已登入）', 'err'));
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
  // 插入圖片：input 直接覆蓋在按鈕上（原生點擊），Android WebView 交付檔案最可靠，不需 JS click()
  el('image-file').addEventListener('change', (e) => { insertImage(e.target.files[0]); e.target.value = ''; });
  // Android Photo Picker / TWA 已知問題：選擇照片返回後 change 可能不觸發。
  // 以「頁面回到前景」補救——若 input 內已有檔案而 change 未處理，此時手動插入。
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const f = el('image-file');
      if (f && f.files && f.files.length) {
        insertImage(f.files[0]);
        f.value = '';
      }
    }
  });
  // 編輯器內圖片刪除（事件委派：內容由使用者編輯、DOM 會重建）
  el('editor-content').addEventListener('click', (e) => {
    const del = e.target.closest('.fn-del');
    if (del) {
      e.preventDefault();
      e.stopPropagation();
      // 移除包裝鏈，並清理因此出現的空白包裝（避免嵌套殘留空殼）
      let w = del.closest('.fn-wrap');
      while (w) {
        const p = w.parentElement;
        w.remove();
        if (!p || !p.classList || !p.classList.contains('fn-wrap') || p.querySelector('img.fn-img')) break;
        w = p;
      }
      saveCurrentNote();
      toast('已刪除照片');
    }
  });
  // 編輯器內待辦勾選：打勾/取消即儲存，並切換完成樣式
  el('editor-content').addEventListener('change', (e) => {
    if (e.target.matches('.todo input[type="checkbox"]')) {
      const t = e.target.closest('.todo');
      if (t) t.classList.toggle('done', e.target.checked);
      if (e.target.checked) e.target.setAttribute('checked', 'checked');
      else e.target.removeAttribute('checked');
      saveCurrentNote();
      renderList();
    }
  });
  el('btn-trash-note').onclick = trashNote;

  // 行動版
  el('btn-menu').onclick = () => el('sidebar').classList.toggle('open');
  el('btn-mobile-menu').onclick = () => el('sidebar').classList.add('open');
  el('btn-back-list').onclick = () => { el('editor-pane').classList.add('hidden'); };
  el('btn-back-editor').onclick = () => { el('editor-pane').classList.add('hidden'); };
  // 行動版：點側欄內的按鈕後自動收合；點主區內容也收合
  el('sidebar').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b && b !== el('btn-menu')) el('sidebar').classList.remove('open');
  });
  el('main').addEventListener('click', (e) => {
    if (e.target.closest('#btn-mobile-menu')) return;
    el('sidebar').classList.remove('open');
  });

  // 登入 / 設定
  el('login-btn').onclick = doLogin;
  el('btn-settings').onclick = openSettings;
  el('settings-close').onclick = closeSettings;
  el('btn-export').onclick = exportBackup;
  el('set-export').onclick = exportBackup;
  el('set-import').onclick = () => el('import-file').click();
  el('cmd-export-md').onclick = exportNoteMD;
  el('set-export-md').onclick = exportAllMD;
  // 筆記提醒
  el('cmd-remind').onclick = toggleRemindBar;
  el('remind-save').onclick = setReminder;
  el('remind-clear').onclick = clearReminder;
  // 附件（input 覆蓋按鈕，同圖片機制）
  el('attach-file').addEventListener('change', (e) => { insertAttachment(e.target.files[0]); e.target.value = ''; });
  setInterval(checkReminders, 60000);
  el('import-file').addEventListener('change', (e) => { importFiles(e.target.files); e.target.value = ''; });
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
  // 行動版：進入編輯畫面（返回按鈕在編輯器工具列內）
  if (window.innerWidth <= 820) { el('editor-pane').classList.remove('hidden'); }
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
