@echo off
setlocal
cd /d "%~dp0"

where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo Node.js and npm are required. Install Node.js, then run this file again.
  pause
  exit /b 1
)

if not exist "node_modules\.bin\vite.cmd" (
  echo Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo Dependency installation failed.
    pause
    exit /b 1
  )
)

echo Starting the game. The browser will open when Vite is ready.
echo Keep this window open while playing. Press Ctrl+C to stop the server.
call npm run dev -- --open

if errorlevel 1 echo The development server stopped with an error.
pause
