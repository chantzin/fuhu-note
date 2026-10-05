/* =====================================================
 * FUHU-NOTE 筆記 — Firebase 設定檔
 * =====================================================
 * 使用方法（詳見 D:\FUHU-NOTE\文件\Firebase設定指南.md）：
 *
 * 1. 前往 https://console.firebase.google.com 建立專案
 * 2. 新增「網頁應用程式」，複製 firebaseConfig 內容
 * 3. 在 Authentication 啟用「Google 登入」
 * 4. 建立 Firestore 資料庫，貼上 firestore.rules（與本檔案同目錄）
 * 5. 將下方 FIREBASE_CONFIG 從 null 改為你的設定
 *
 * 未設定時：APP 以「本機模式」運作，僅在本裝置使用、無法跨裝置同步。
 */
const FIREBASE_CONFIG = null; // ← 貼上設定後，改為 { apiKey: "...", authDomain: "...", projectId: "...", storageBucket: "...", messagingSenderId: "...", appId: "..." }

/* 本機模式下的使用者識別碼（無 Firebase 時產生，區分本機資料） */
const LOCAL_UID_PREFIX = 'local-user';

export { FIREBASE_CONFIG, LOCAL_UID_PREFIX };
