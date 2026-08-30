@echo off
setlocal
title orders - Debug Mode
echo ==========================================
echo           DIAGNOSTIC START
echo ==========================================

echo.
echo [STEP 1] Checking for Node.js...
node -v
IF %ERRORLEVEL% NEQ 0 (
    echo.
    echo [CRITICAL ERROR] Node.js is NOT installed!
    echo You must install it from: https://nodejs.org/
    echo.
    pause
    exit
)
echo Node.js is found.

echo.

echo [STEP 4] Starting the server...

REM serve performs a network update check on every launch unless disabled.
REM Keep local startup deterministic; this variable exists only inside this launcher.
set "NO_UPDATE_CHECK=1"
set "npm_config_update_notifier=false"

cd netunim-orders\site
npx serve .

echo.
echo ==========================================
echo Server stopped. Press any key to close.
pause