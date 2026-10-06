@echo off
title Wardogs Tactical Map — FAST bridge (:3000)
cd /d "%~dp0.."

echo Killing ports 3000 / 3015...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "foreach($p in 3000,3015){ Get-NetTCPConnection -LocalPort $p -State Listen -EA SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -EA SilentlyContinue } }"

echo.
echo Fast ingest bridge on http://127.0.0.1:3000
echo (raw Node API — not Next — so provider posts stay under ~5ms)
echo Keep this window OPEN.
echo.
node scripts\fast-bridge.mjs
pause
