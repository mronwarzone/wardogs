@echo off
title Wardogs Tactical Map (:3000)
cd /d "%~dp0"

echo Killing anything stuck on port 3000...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\kill-port.ps1"

echo.
echo Starting map at http://127.0.0.1:3000
echo Keep this window OPEN while you use radar.
echo Close it only when you are done.
echo.
npm run dev
pause
