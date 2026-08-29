@echo off
setlocal
cd /d "%~dp0"

where npm >nul 2>nul
if errorlevel 1 (
    echo npm is required. Install Node.js 22 or newer, then run this script again.
    exit /b 1
)

if not exist node_modules (
    echo Installing dependencies...
    call npm ci
    if errorlevel 1 exit /b %ERRORLEVEL%
)

echo Starting Chronica at http://localhost:3000
echo Press Ctrl-C to stop the local server.
start "" "http://localhost:3000"
call npm run dev
