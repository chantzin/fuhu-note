/* =====================================================
 * FUHU-NOTE 筆記 — UI 輔助層（DOM、提示、對話框、格式）
 * ===================================================== */

export const el = (id) => document.getElementById(id);

export function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/* 從 HTML 內容萃取純文字（列表預覽用） */
export function htmlToText(html) {
  const div = document.createElement('div');
  div.innerHTML = html || '';
  return (div.textContent || '').replace(/\s+/g, ' ').trim();
}

export function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const pad = (n) => String(n).padStart(2, '0');
  if (sameDay) return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
}

/* ---------- Toast ---------- */
let _toastTimer = null;
export function toast(message, type = 'ok') {
  const root = el('toast-root');
  const t = document.createElement('div');
  t.className = 'toast ' + type;
  t.textContent = message;
  root.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; setTimeout(() => t.remove(), 300); }, 2600);
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {}, 3000);
}

/* ---------- 通用對話框 ---------- */
export function openModal({ title, body, okText = '確定', cancelable = true, onOk = null, okDisabled = false }) {
  const root = el('modal-root');
  el('modal-title').textContent = title;
  el('modal-body').innerHTML = body;
  const okBtn = el('modal-ok');
  okBtn.textContent = okText;
  okBtn.disabled = okDisabled;
  root.classList.remove('hidden');
  const close = () => { root.classList.add('hidden'); el('modal-body').innerHTML = ''; };
  el('modal-cancel').classList.toggle('hidden', !cancelable);
  el('modal-cancel').onclick = close;
  okBtn.onclick = () => { const ret = onOk ? onOk() : true; if (ret !== false) close(); };
}

export function confirmDialog(title, message, onConfirm, okText = '確定') {
  openModal({
    title,
    body: `<p class="set-note" style="font-size:14px;color:var(--ink-2)">${message}</p>`,
    okText,
    onOk: () => { onConfirm(); }
  });
}

export function inputModal(title, label, placeholder, value, onOk) {
  openModal({
    title,
    body: `<label class="form-label">${label}<input type="text" id="modal-input" placeholder="${escapeHtml(placeholder || '')}" value="${escapeHtml(value || '')}"></label>`,
    onOk: () => { const v = el('modal-input').value.trim(); if (!v) { toast('請輸入內容', 'err'); return false; } onOk(v); }
  });
  setTimeout(() => { const i = el('modal-input'); if (i) { i.focus(); i.select(); } }, 50);
}

/* ---------- 設定視窗 ---------- */
export function openSettings() { el('settings-root').classList.remove('hidden'); }
export function closeSettings() { el('settings-root').classList.add('hidden'); }

/* ---------- 空狀態 ---------- */
export function setEmptyState(visible, text, showAction) {
  el('empty-list').classList.toggle('hidden', !visible);
  el('note-list').classList.toggle('hidden', visible);
  el('empty-text').textContent = text || '這裡還沒有筆記';
  el('empty-action').classList.toggle('hidden', !showAction);
}
