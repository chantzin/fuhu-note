# FUHU-NOTE 本機伺服器啟動腳本（供 pythonw.exe 執行，無視窗）
# pythonw 沒有 stdout/stderr，此處先抑制輸出，避免 http.server 寫日誌時崩潰
import os
import sys

sys.stdout = open(os.devnull, "w")
sys.stderr = open(os.devnull, "w")

# 切換到網頁程式目錄（本檔位於 {app}\，程式位於 {app}\FUHU-NOTE\）
BASE = os.path.dirname(os.path.abspath(__file__))
os.chdir(os.path.join(BASE, "FUHU-NOTE"))

from http.server import HTTPServer, SimpleHTTPRequestHandler

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass  # 完全靜音

    def end_headers(self):
        # 一律不緩存：確保更新版程式碼即時生效（避免瀏覽器沿用舊 JS/CSS）
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

HTTPServer(("127.0.0.1", 8000), QuietHandler).serve_forever()
