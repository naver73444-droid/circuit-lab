@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 20 or newer is required.
  echo Install Node.js, then run this file again.
  pause
  exit /b 1
)
node scripts\launch.mjs
if errorlevel 1 (
  echo Startup failed. Keep the message above for diagnosis.
  echo Another Circuit Lab may already be using port 4173.
  echo Try: node scripts\launch.mjs 4191
  pause
)
