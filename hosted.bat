@echo off
cd /d "%~dp0"

echo Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo npm install failed.
    pause
    exit /b %ERRORLEVEL%
)

echo Starting Chronica...
start "" "http://localhost:3000"
call npm run dev
pause
