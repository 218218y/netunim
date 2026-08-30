@echo off
setlocal
title kupa - Debug Mode
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
    exit /b 1
)
echo Node.js is found.

echo.
echo [STEP 4] Starting the server...

REM serve performs a network update check on every launch unless disabled.
REM Keep local startup deterministic; these variables exist only inside this launcher.
set "NO_UPDATE_CHECK=1"
set "npm_config_update_notifier=false"

REM Resolve the site from this BAT file's own directory.
REM The absolute path is also passed directly to serve, so the served root never depends on CWD.
set "SITE_DIR=%~dp0netunim-kupa\site"
for %%I in ("%SITE_DIR%") do set "SITE_DIR=%%~fI"
if not exist "%SITE_DIR%\index.html" (
    echo.
    echo [CRITICAL ERROR] Kupa site folder was not found:
    echo "%SITE_DIR%"
    echo.
    pause
    exit /b 1
)

pushd "%SITE_DIR%" || (
    echo.
    echo [CRITICAL ERROR] Could not enter the Kupa site folder:
    echo "%SITE_DIR%"
    echo.
    pause
    exit /b 1
)

echo [INFO] Serving directory: "%SITE_DIR%"
call npx serve "%SITE_DIR%"
set "SERVER_EXIT=%ERRORLEVEL%"
popd

echo.
echo ==========================================
echo Server stopped. Press any key to close.
pause
exit /b %SERVER_EXIT%
