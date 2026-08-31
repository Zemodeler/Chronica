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

echo Freeing ports 3000 through 3010...
powershell.exe -NoProfile -Command "$processIds = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | Where-Object { $_.LocalPort -ge 3000 -and $_.LocalPort -le 3010 } | Select-Object -ExpandProperty OwningProcess -Unique; if ($processIds) { Stop-Process -Id $processIds -Force -ErrorAction SilentlyContinue }"

echo Starting Chronica at http://localhost:3000
echo Press Ctrl-C to stop the local server.
call npm run dev
