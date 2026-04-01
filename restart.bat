@echo off
setlocal

set "NANOCLAW_DIR=%~dp0"
if "%NANOCLAW_DIR:~-1%"=="\" set "NANOCLAW_DIR=%NANOCLAW_DIR:~0,-1%"

cd /d "%NANOCLAW_DIR%"

echo Compiling NanoClaw...
call npm run build
if errorlevel 1 (
    echo.
    echo Compilation FAILED. NanoClaw was NOT restarted.
    exit /b 1
)
echo Compilation successful.

:: Stop all existing instances by process name
echo Stopping existing NanoClaw instances...
powershell -NoProfile -Command "Get-WmiObject Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -like '*dist/index.js*' } | ForEach-Object { Write-Host \"Killing PID $($_.ProcessId)\"; Stop-Process -Id $_.ProcessId -Force }"
timeout /t 2 /nobreak >nul

:: Start new instance
echo Starting NanoClaw...
powershell -NoProfile -Command "& { $p = Start-Process -FilePath 'node' -ArgumentList 'dist/index.js' -WorkingDirectory '%NANOCLAW_DIR%' -NoNewWindow -PassThru; Write-Host \"NanoClaw started (PID $($p.Id)).\" }"
if errorlevel 1 (
    echo Failed to start NanoClaw.
    exit /b 1
)

endlocal
