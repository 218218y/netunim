@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

where node >nul 2>nul || (
  echo ERROR: Node.js was not found. Install Node.js 22.13 LTS or newer first.
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);process.exit(((v[0]===22&&v[1]>=13)||v[0]>=24)?0:1)" >nul 2>nul
if not "%ERRORLEVEL%"=="0" (
  echo ERROR: Document Bridge requires Node.js 22.13+ or Node.js 24+.
  echo Node.js 23 is intentionally not supported on Windows.
  pause
  exit /b 1
)

set "APPROOT=%LOCALAPPDATA%\NetunimDocumentBridge"
set "APPDIR=%APPROOT%\app"
set "STAGING=%APPROOT%\app-staging"
set "APPBACKUP=%APPROOT%\app-rollback"
set "APPFAILED=%APPROOT%\app-failed-install"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "AUTOSTART=%STARTUP%\NetunimDocumentBridge.vbs"
set "SUMMARY=%APPROOT%\INSTALLATION-LOG.txt"
set "CONFIG=%APPROOT%\config.json"
set "CONFIGBACKUP=%APPROOT%\config.before-install.json"
set "CONFIGWASNEW=no"

if not exist "%APPROOT%" mkdir "%APPROOT%" >nul 2>nul
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
mkdir "%STAGING%" >nul 2>nul || goto :stage_error
for %%F in (server.mjs lib.mjs start_document_bridge.bat configure_document_bridge.ps1) do (
  copy /Y "%~dp0%%F" "%STAGING%\%%F" >nul || goto :stage_error
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_es.ps1" -AppRoot "%APPROOT%"
if not "%ERRORLEVEL%"=="0" goto :es_error

if exist "%CONFIGBACKUP%" del /Q "%CONFIGBACKUP%" >nul 2>nul
if exist "%CONFIG%" (
  copy /Y "%CONFIG%" "%CONFIGBACKUP%" >nul || goto :stage_error
) else (
  set "CONFIGWASNEW=yes"
)

node "%STAGING%\server.mjs" --init
if not "%ERRORLEVEL%"=="0" goto :stage_error
if not exist "%CONFIG%" goto :stage_error

rem Always use a normal Windows picker. Existing roots are preloaded for easy verification.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%STAGING%\configure_document_bridge.ps1" -AppRoot "%APPROOT%" -FirstRun
if not "%ERRORLEVEL%"=="0" goto :config_error

rem Write the key/diagnostics before the doctor too, so failures are easy to inspect.
node "%STAGING%\server.mjs" --write-install-summary >nul 2>nul
node "%STAGING%\server.mjs" --doctor
if not "%ERRORLEVEL%"=="0" goto :doctor_error

node "%STAGING%\server.mjs" --stop-existing
if not "%ERRORLEVEL%"=="0" goto :stop_error

if exist "%APPBACKUP%" rmdir /S /Q "%APPBACKUP%" >nul 2>nul
if exist "%APPDIR%" move "%APPDIR%" "%APPBACKUP%" >nul || goto :activate_error
move "%STAGING%" "%APPDIR%" >nul || goto :activate_error

copy /Y "%~dp0launch_hidden.vbs" "%AUTOSTART%" >nul || goto :activate_error
copy /Y "%~dp0configure_document_bridge.bat" "%APPROOT%\configure_document_bridge.bat" >nul || goto :activate_error
start "" wscript.exe "%AUTOSTART%"
timeout /t 2 /nobreak >nul
node "%APPDIR%\server.mjs" --check-running
if not "%ERRORLEVEL%"=="0" goto :activate_error

node "%APPDIR%\server.mjs" --write-install-summary >nul
if not "%ERRORLEVEL%"=="0" goto :activate_error
if exist "%APPROOT%\bridge-token.txt" type "%APPROOT%\bridge-token.txt" | clip

if exist "%APPBACKUP%" rmdir /S /Q "%APPBACKUP%" >nul 2>nul
if exist "%CONFIGBACKUP%" del /Q "%CONFIGBACKUP%" >nul 2>nul

echo.
echo ============================================================
echo Document Bridge installed successfully on THIS computer.
echo Notepad will open with the key to paste into the website,
echo configured folders and real Everything index diagnostics.
echo ============================================================
echo.
start "" notepad.exe "%SUMMARY%"
pause
exit /b 0

:es_error
echo.
echo ERROR: Could not install/verify the official Everything ES command-line client.
echo Detailed log: %APPROOT%\install-es.log
call :restore_config
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
pause
exit /b 1

:config_error
call :restore_config
echo.
echo ERROR: Document folder selection was cancelled or invalid.
echo The previous configuration was restored.
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
pause
exit /b 1

:doctor_error
node "%STAGING%\server.mjs" --write-install-summary >nul 2>nul
if exist "%SUMMARY%" start "" notepad.exe "%SUMMARY%"
call :restore_config
echo.
echo ERROR: Document search diagnostics failed.
echo The previous configuration was restored. See the opened INSTALLATION-LOG.txt.
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
pause
exit /b 1

:stop_error
call :restore_config
echo.
echo ERROR: The existing Document Bridge could not be stopped safely.
echo The current installation and configuration were preserved.
echo Runtime log: %APPROOT%\bridge.log
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
pause
exit /b 1

:stage_error
call :restore_config
echo ERROR: Could not prepare Document Bridge. The current installation was preserved.
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
pause
exit /b 1

:activate_error
call :restore_config
node "%APPDIR%\server.mjs" --stop-existing >nul 2>nul
if exist "%APPFAILED%" rmdir /S /Q "%APPFAILED%" >nul 2>nul
if exist "%APPDIR%" move "%APPDIR%" "%APPFAILED%" >nul 2>nul
if exist "%APPBACKUP%" move "%APPBACKUP%" "%APPDIR%" >nul 2>nul
if exist "%APPDIR%" start "" wscript.exe "%AUTOSTART%"
echo ERROR: New Document Bridge did not start correctly. Previous runtime/configuration was restored when available.
echo See: %APPROOT%\bridge.log
echo Console log: %APPROOT%\bridge-console.log
pause
exit /b 1

:restore_config
if exist "%CONFIGBACKUP%" (
  copy /Y "%CONFIGBACKUP%" "%CONFIG%" >nul 2>nul
  del /Q "%CONFIGBACKUP%" >nul 2>nul
) else if /I "%CONFIGWASNEW%"=="yes" (
  del /Q "%CONFIG%" >nul 2>nul
)
exit /b 0
