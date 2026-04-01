@echo off
setlocal

set NANOCLAW_DIR=D:\Dev\Tools\nanoclaw
set DOCKER_EXE=C:\Program Files\Docker\Docker\Docker Desktop.exe
set LOG_FILE=%NANOCLAW_DIR%\logs\nanoclaw.log

echo [%DATE% %TIME%] Starting Docker Desktop...
start "" "%DOCKER_EXE%"

echo [%DATE% %TIME%] Waiting for Docker to be ready...
:wait_docker
timeout /t 5 /nobreak >nul
docker info >nul 2>&1
if errorlevel 1 goto wait_docker

echo [%DATE% %TIME%] Docker is ready. Starting NanoClaw...
cd /d "%NANOCLAW_DIR%"
start "" /b cmd /c "npm start >> "%LOG_FILE%" 2>&1"

echo [%DATE% %TIME%] NanoClaw started. Check logs at %LOG_FILE%
endlocal
