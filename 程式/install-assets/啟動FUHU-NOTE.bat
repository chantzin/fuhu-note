@echo off
chcp 65001 >nul
title FUHU-NOTE

rem If port 8000 is already serving, just open the browser.
netstat -ano | findstr ":8000" | findstr "LISTENING" >nul 2>&1
if not errorlevel 1 (
  start "" "http://127.0.0.1:8000"
  exit /b 0
)

rem Start the local server (portable Python, no console window) then open the browser.
start "" "%~dp0python\pythonw.exe" "%~dp0run_server.py"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8000"
exit /b 0
