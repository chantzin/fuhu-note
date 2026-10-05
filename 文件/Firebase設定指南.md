# EVERNOT 筆記 — Firebase 設定指南

> 目標：讓 EVERNOT 使用 Google 帳號登入，並啟用跨裝置雲端同步。
> 全程約 20–30 分鐘。Firebase 免費方案（Spark）即足夠個人使用。

## 步驟 1 — 建立 Firebase 專案

1. 開啟 [Firebase 主控台](https://console.firebase.google.com)（需 Google 帳號）。
2. 「建立專案」→ 輸入專案名稱（例如 `evernot-app`）→ 依引導完成（Analytics 可不啟用）。
3. 專案建立後，畫面右上角可切換專案。

## 步驟 2 — 註冊網頁應用程式（取得設定）

1. 專案總覽 →「</> 網頁應用程式」→ 輸入應用暱稱（例如 `evernot-pwa`）→ 註冊。
2. 畫面上出現的 `firebaseConfig` 內容，形如：

```js
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "evernot-app.firebaseapp.com",
  projectId: "evernot-app",
  storageBucket: "evernot-app.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc..."
};
```

3. 開啟 `D:\EVERNOT\程式\evernot-pwa\js\config.js`，將 `FIREBASE_CONFIG = null;` 改為：

```js
const FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "...",
  projectId: "...",
  storageBucket: "...",
  messagingSenderId: "...",
  appId: "..."
};
```

## 步驟 3 — 啟用 Google 登入

1. 左側「Authentication」→「開始使用」→「登入方法」分頁。
2. 找到 **Google** → 啟用 → 支援電子郵件填你的 Google 帳號 → 儲存。
3. 「設定 → 已授權網域」確認 `localhost` 與 `127.0.0.1` 在列（預設已有）。

## 步驟 4 — 建立 Firestore 資料庫並套用安全規則

1. 左側「Firestore Database」→「建立資料庫」。
2. 位置選離你最近的區域（例如 `asia-east1` 台灣／`asia-northeast1`）。
3. **安全規則模式選「測試模式」**（先能開發），完成建立。
4. 建立後到「規則」分頁，**整段覆蓋**為 `firestore.rules` 檔的內容
   （檔案位置：`D:\EVERNOT\程式\evernot-pwa\firestore.rules`，內容以 uid 隔離每位使用者資料）。
5. 發布規則。

> 上線前務必完成此規則設定；測試模式等於任何人可讀寫，勿長期使用。

## 步驟 5 — 啟用 Cloud Storage（附件圖片）

1. 左側「Storage」→「開始使用」→ 依引導完成（區域同 Firestore）。
2. 「規則」分頁 → 整段覆蓋為 `storage.rules` 檔的內容（附件僅本人可讀寫）→ 發布。

## 步驟 6 — 本機測試

1. 雙擊 `D:\EVERNOT\安裝程式\啟動EVERNOT本機版.bat`。
2. 開啟 `http://127.0.0.1:8000` → 側欄底部出現「使用 Google 帳號登入」→ 登入。
3. 狀態列顯示「已同步」即成功。新增筆記 → 在另一裝置（手機）登入同一帳號 → 筆記出現即同步成功。

## 步驟 7 — 部署上線（手機也能用）

**方式一：Firebase Hosting（推薦，簡單）**

```bat
cd D:\EVERNOT\程式\evernot-pwa
npm install -g firebase-tools
firebase login
firebase init hosting        REM 公開目錄填「.」，單頁應用選 Yes
firebase deploy
```

部署完成後會得到 `https://<專案名>.web.app` 網址。接著：
- Firebase 主控台 → Authentication → 已授權網域 → 新增該網址（`.web.app`）。
- 手機 Chrome 開啟該網址 →「加到主畫面」→ 即安裝為 App（含離線）。

**方式二：自有伺服器（如你的 Ubuntu 主機）**
- 將 `evernot-pwa` 整個資料夾內容放到網頁根目錄（如 Nginx），設定 HTTPS。
- 網址加入 Firebase 已授權網域即可。

## 步驟 8 — 上線後檢查清單

| 項目 | 狀態 |
| --- | --- |
| Firestore 規則已是 uid 隔離版（非測試模式） | ☐ |
| Storage 規則已是 uid 隔離版 | ☐ |
| Firebase 已授權網域含正式網址 | ☐ |
| 設定過「Cloud Storage 用量預算」或 Firebase 帳單預算警示 | ☐ |
| 首次登入、雙裝置同步、離線編輯各測一輪 | ☐ |

## 費用說明（2026 參考）

- **Spark 免費方案**：Firestore 1GB 儲存、每日 50K 讀／20K 寫、Storage 5GB、每月 10GB 傳輸——個人筆記使用量通常遠低於此，**基本免費**。
- 用量超額才需升級 Blaze（用量計費）；可在「帳單 → 預算警示」設上限提醒。
- 詳細額度以 Firebase 官方頁面為準。
