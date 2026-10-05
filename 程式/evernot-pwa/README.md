# EVERNOT 筆記 — PWA 原始碼

類似 Evernote 的跨平台筆記 App：**離線優先、Google 帳號同步**。純前端、零建置，可部署於任何靜態主機。

## 快速執行

```bat
python -m http.server 8000 --bind 127.0.0.1
```

或雙擊 `D:\EVERNOT\安裝程式\啟動EVERNOT本機版.bat`，開啟 `http://127.0.0.1:8000`。

## 目錄

| 檔案 | 說明 |
| --- | --- |
| `index.html` | 應用外殼（側欄／列表／編輯器） |
| `css/app.css` | 樣式（紙感主題、響應式） |
| `js/config.js` | **Firebase 設定**（未設定時為本機模式） |
| `js/db.js` | 本地資料庫（IndexedDB，離線優先） |
| `js/sync.js` | 同步引擎（Google 登入、Firestore、欄位級 LWW 衝突處理） |
| `js/ui.js` | UI 輔助（對話框、提示） |
| `js/app.js` | 主程式（筆記 CRUD、編輯器、搜尋、備份） |
| `manifest.webmanifest` | PWA 安裝清單 |
| `sw.js` | Service Worker（離線快取） |
| `firestore.rules` / `storage.rules` | Firebase 安全規則（上線前務必套用） |
| `icons/` | App 圖示（腳本於 `scripts/generate_icons.py`） |

## 完整文件

- `D:\EVERNOT\文件\使用者手冊.md` — 功能與操作
- `D:\EVERNOT\文件\Firebase設定指南.md` — 啟用 Google 登入與同步
- `D:\EVERNOT\文件\建置建議報告.md` — 技術選型與規劃

## 版本

v1.0（MVP）— 2026-10-05。變更請記錄於 `D:\EVERNOT\文件\變更紀錄.md`。
