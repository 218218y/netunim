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
set "LEGACYAPP=%APPROOT%\app"
set "RUNTIMENAME=app-v27-%RANDOM%-%RANDOM%"
set "RUNTIME=%APPROOT%\%RUNTIMENAME%"
set "STAGING=%APPROOT%\app-staging-%RANDOM%-%RANDOM%"
set "ACTIVEFILE=%APPROOT%\active-runtime.txt"
set "ACTIVEBACKUP=%APPROOT%\active-runtime.before-install.txt"
set "ACTIVETMP=%APPROOT%\active-runtime.new.txt"
set "ACTIVEWASNEW=no"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "AUTOSTART=%STARTUP%\NetunimDocumentBridge.vbs"
set "SUMMARY=%APPROOT%\INSTALLATION-LOG.txt"
set "CONFIG=%APPROOT%\config.json"
set "CONFIGBACKUP=%APPROOT%\config.before-install.json"
set "CONFIGWASNEW=no"

if not exist "%APPROOT%" mkdir "%APPROOT%" >nul 2>nul
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
mkdir "%STAGING%" >nul 2>nul || goto :stage_error
for %%F in (server.mjs lib.mjs pdf_form_index.mjs start_document_bridge.bat) do (
  copy /Y "%~dp0%%F" "%STAGING%\%%F" >nul || goto :stage_error
)
if exist "%STAGING%\pdfjs" rmdir /S /Q "%STAGING%\pdfjs" >nul 2>nul
xcopy /E /I /Y "%~dp0..\site\assets\vendor\pdfjs" "%STAGING%\pdfjs" >nul || goto :stage_error

echo Building local Windows Preview Handler host...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build_native_preview.ps1" -Source "%~dp0native_preview_host.cs" -Output "%STAGING%\NetunimPreviewHost.exe"
if not "%ERRORLEVEL%"=="0" goto :preview_host_error

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_es.ps1" -AppRoot "%APPROOT%"
if not "%ERRORLEVEL%"=="0" goto :es_error

if exist "%CONFIGBACKUP%" del /Q "%CONFIGBACKUP%" >nul 2>nul
if exist "%CONFIG%" (
  copy /Y "%CONFIG%" "%CONFIGBACKUP%" >nul || goto :stage_error
) else (
  set "CONFIGWASNEW=yes"
)

if exist "%ACTIVEBACKUP%" del /Q "%ACTIVEBACKUP%" >nul 2>nul
if exist "%ACTIVEFILE%" (
  copy /Y "%ACTIVEFILE%" "%ACTIVEBACKUP%" >nul || goto :stage_error
) else (
  set "ACTIVEWASNEW=yes"
)

node "%STAGING%\server.mjs" --init
if not "%ERRORLEVEL%"=="0" goto :stage_error
if not exist "%CONFIG%" goto :stage_error

echo Ensuring Everything is running in background mode - no search window...
node "%STAGING%\server.mjs" --ensure-everything
if not "%ERRORLEVEL%"=="0" goto :everything_error

echo Preserving local interactive PDF text index...
echo Existing PDF index progress is reused; background inspection resumes only after the new Bridge starts.

rem Search scope is the complete Everything index. Configure indexed locations in Everything itself.
rem The new runtime is validated before the old runtime is stopped.
node "%STAGING%\server.mjs" --write-install-summary >nul 2>nul
node "%STAGING%\server.mjs" --doctor
if not "%ERRORLEVEL%"=="0" goto :doctor_error

rem Stop the current listener first. v27 activation is side-by-side, so a stale
rem Windows handle in an older runtime can never block installation of the new one.
node "%STAGING%\server.mjs" --stop-existing
if not "%ERRORLEVEL%"=="0" goto :stop_error
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop_runtime_helpers.ps1" -AppRoot "%APPROOT%" >nul 2>nul

rem Promote only the new staging directory. Never rename/delete the active runtime
rem as part of activation: Windows may legally keep executable/current-directory
rem handles alive for a short time after shutdown.
call :move_dir_with_retry "%STAGING%" "%RUNTIME%"
if errorlevel 1 goto :activate_error

> "%ACTIVETMP%" echo %RUNTIMENAME%
move /Y "%ACTIVETMP%" "%ACTIVEFILE%" >nul || goto :activate_error
copy /Y "%~dp0launch_hidden.vbs" "%AUTOSTART%" >nul || goto :activate_error
copy /Y "%~dp0configure_document_bridge.bat" "%APPROOT%\configure_document_bridge.bat" >nul || goto :activate_error
start "" wscript.exe "%AUTOSTART%"
timeout /t 2 /nobreak >nul
node "%RUNTIME%\server.mjs" --check-running
if not "%ERRORLEVEL%"=="0" goto :activate_error

node "%RUNTIME%\server.mjs" --write-install-summary >nul
if not "%ERRORLEVEL%"=="0" goto :activate_error
if exist "%APPROOT%\bridge-token.txt" type "%APPROOT%\bridge-token.txt" | clip

if exist "%CONFIGBACKUP%" del /Q "%CONFIGBACKUP%" >nul 2>nul
if exist "%ACTIVEBACKUP%" del /Q "%ACTIVEBACKUP%" >nul 2>nul

rem Old runtimes are cleanup-only. Failure to delete one must never roll back a
rem healthy installation; a stale Windows handle will disappear on its own later.
call :cleanup_inactive_runtimes "%RUNTIMENAME%"

echo.
echo ============================================================
echo Document Bridge installed successfully on THIS computer.
echo Everything will be started automatically in background mode
echo whenever the Bridge starts. No Everything search window is needed.
echo Notepad will open with the key and diagnostics.
echo ============================================================
echo.
start "" notepad.exe "%SUMMARY%"
pause
exit /b 0

:preview_host_error
echo.
echo ERROR: Could not build the local Windows Preview Handler host.
echo This component is required for fast native Office previews.
call :restore_state
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
pause
exit /b 1

:es_error
echo.
echo ERROR: Could not install/verify the official Everything ES command-line client.
echo Detailed log: %APPROOT%\install-es.log
call :restore_state
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
pause
exit /b 1

:everything_error
call :restore_state
echo.
echo ERROR: Everything could not be started in background mode.
echo The installer looked for the installed Everything.exe and used the official -startup mode.
echo Install Everything 1.5 with the official installer, then run this installer again.
echo Runtime log: %APPROOT%\bridge.log
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
pause
exit /b 1

:doctor_error
node "%STAGING%\server.mjs" --write-install-summary >nul 2>nul
if exist "%SUMMARY%" start "" notepad.exe "%SUMMARY%"
call :restore_state
echo.
echo ERROR: Document search diagnostics failed.
echo The previous configuration was restored. See the opened INSTALLATION-LOG.txt.
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
pause
exit /b 1

:stop_error
call :restore_state
echo.
echo ERROR: The existing Document Bridge could not be stopped safely.
echo The current installation and configuration were preserved.
echo Runtime log: %APPROOT%\bridge.log
start "" wscript.exe "%AUTOSTART%"
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
pause
exit /b 1

:stage_error
call :restore_state
echo ERROR: Could not prepare Document Bridge. The current installation was preserved.
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
pause
exit /b 1

:activate_error
rem If the new listener did start, stop it before switching the active marker back.
node "%RUNTIME%\server.mjs" --stop-existing >nul 2>nul
call :restore_state
start "" wscript.exe "%AUTOSTART%"
if exist "%RUNTIME%" rmdir /S /Q "%RUNTIME%" >nul 2>nul
echo ERROR: New Document Bridge did not start correctly. Previous runtime/configuration was restored when available.
echo See: %APPROOT%\bridge.log
echo Console log: %APPROOT%\bridge-console.log
pause
exit /b 1

:move_dir_with_retry
set "MOVE_SOURCE=%~1"
set "MOVE_TARGET=%~2"
for /L %%R in (1,1,12) do (
  move "%MOVE_SOURCE%" "%MOVE_TARGET%" >nul 2>nul && exit /b 0
  >nul 2>nul timeout /t 1 /nobreak
)
echo ERROR: Could not activate new runtime "%MOVE_TARGET%" after waiting for staging handles to close.
exit /b 1

:cleanup_inactive_runtimes
set "KEEP_RUNTIME=%~1"
for /D %%D in ("%APPROOT%\app-v*") do (
  if /I not "%%~nxD"=="%KEEP_RUNTIME%" rmdir /S /Q "%%~fD" >nul 2>nul
)
rem Legacy v25-and-earlier runtime may still have a transient Windows handle.
rem Cleanup is best effort only and never affects successful activation.
if exist "%LEGACYAPP%" rmdir /S /Q "%LEGACYAPP%" >nul 2>nul
exit /b 0

:restore_state
if exist "%CONFIGBACKUP%" (
  copy /Y "%CONFIGBACKUP%" "%CONFIG%" >nul 2>nul
  del /Q "%CONFIGBACKUP%" >nul 2>nul
) else if /I "%CONFIGWASNEW%"=="yes" (
  del /Q "%CONFIG%" >nul 2>nul
)
if exist "%ACTIVEBACKUP%" (
  copy /Y "%ACTIVEBACKUP%" "%ACTIVEFILE%" >nul 2>nul
  del /Q "%ACTIVEBACKUP%" >nul 2>nul
) else if /I "%ACTIVEWASNEW%"=="yes" (
  del /Q "%ACTIVEFILE%" >nul 2>nul
)
if exist "%ACTIVETMP%" del /Q "%ACTIVETMP%" >nul 2>nul
exit /b 0
