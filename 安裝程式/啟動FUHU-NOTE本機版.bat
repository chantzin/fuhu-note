@echo off
chcp 65001 >nul
title FUHU-NOTE 筆記 - 本機版
cd /d "%~dp0..\程式\fuhu-note"

echo ============================================================
echo   FUHU-NOTE 筆記 - 本機版啟動中
echo   瀏覽器將自動開啟 http://127.0.0.1:8000
echo   關閉此視窗即停止服務（資料不會遺失）
echo ============================================================

start "" cmd /c "timeout /t 2 >nul & start http://127.0.0.1:8000"
python -m http.server 8000 --bind 127.0.0.1

pause
