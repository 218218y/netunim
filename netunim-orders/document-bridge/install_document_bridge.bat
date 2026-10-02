@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

set "APPROOT=%LOCALAPPDATA%\NetunimDocumentBridge"
set "LEGACYAPP=%APPROOT%\app"
set "RUNTIMENAME=app-v37-%RANDOM%-%RANDOM%"
set "RUNTIME=%APPROOT%\%RUNTIMENAME%"
set "STAGING=%APPROOT%\app-staging-%RANDOM%-%RANDOM%"
set "ACTIVEFILE=%APPROOT%\active-runtime.txt"
set "ACTIVEBACKUP=%APPROOT%\active-runtime.before-install.txt"
set "ACTIVETMP=%APPROOT%\active-runtime.new.txt"
set "ACTIVEWASNEW=no"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "AUTOSTART=%STARTUP%\NetunimDocumentBridge.vbs"
set "AUTOSTARTBACKUP=%APPROOT%\autostart.before-install.vbs"
set "AUTOSTARTWASNEW=no"
set "CONFIGURETARGET=%APPROOT%\configure_document_bridge.bat"
set "CONFIGUREBACKUP=%APPROOT%\configure_document_bridge.before-install.bat"
set "CONFIGUREWASNEW=no"
set "RUNNERTARGET=%APPROOT%\run_pdf_maintenance.ps1"
set "RUNNERBACKUP=%APPROOT%\run_pdf_maintenance.before-install.ps1"
set "RUNNERWASNEW=no"
set "TASKUPDATED=no"
set "SUMMARY=%APPROOT%\INSTALLATION-LOG.txt"
set "CONFIG=%APPROOT%\config.json"
set "CONFIGBACKUP=%APPROOT%\config.before-install.json"
set "CONFIGWASNEW=no"
set "NODEPOINTER=%APPROOT%\node-runtime.txt"
set "NODEPOINTERBACKUP=%APPROOT%\node-runtime.before-install.txt"
set "NODEPOINTERWASNEW=no"
set "OLDNODERUNTIME="
set "NODERUNTIME="
set "NODE_EXE="

if not exist "%APPROOT%" mkdir "%APPROOT%" >nul 2>nul
rem A new installation transaction never consumes stale rollback artifacts from an
rem earlier interrupted run. Each backup below is recreated immediately before
rem the corresponding live state is changed.
for %%B in ("%CONFIGBACKUP%" "%ACTIVEBACKUP%" "%AUTOSTARTBACKUP%" "%CONFIGUREBACKUP%" "%RUNNERBACKUP%" "%APPROOT%\pdf-maintenance-task.before-install.xml" "%APPROOT%\pdf-maintenance-task.before-install.missing") do (
  if exist "%%~B" del /Q "%%~B" >nul 2>nul
)
if exist "%NODEPOINTERBACKUP%" del /Q "%NODEPOINTERBACKUP%" >nul 2>nul
if exist "%NODEPOINTER%" (
  copy /Y "%NODEPOINTER%" "%NODEPOINTERBACKUP%" >nul || goto :stage_error
  set /p "OLDNODERUNTIME="<"%NODEPOINTER%"
) else (
  set "NODEPOINTERWASNEW=yes"
)

echo Installing/verifying pinned private Node.js 24.21.0 runtime...
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0install_node_runtime.ps1" -AppRoot "%APPROOT%"
if not "%ERRORLEVEL%"=="0" goto :node_error
set /p "NODERUNTIME="<"%NODEPOINTER%"
call :resolve_private_node "%NODERUNTIME%"
if errorlevel 1 goto :node_error
"%NODE_EXE%" -e "process.exit(process.versions.node==='24.21.0'?0:1)" >nul 2>nul
if not "%ERRORLEVEL%"=="0" goto :node_error
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
mkdir "%STAGING%" >nul 2>nul || goto :stage_error
for %%F in (server.mjs lib.mjs pdf_form_index.mjs pdf-index-policy.mjs pdf-extract-worker.mjs start_document_bridge.bat) do (
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

"%NODE_EXE%" "%STAGING%\server.mjs" --init
if not "%ERRORLEVEL%"=="0" goto :stage_error
if not exist "%CONFIG%" goto :stage_error

echo Ensuring Everything is running in background mode - no search window...
"%NODE_EXE%" "%STAGING%\server.mjs" --ensure-everything
if not "%ERRORLEVEL%"=="0" goto :everything_error

echo Preserving local interactive PDF text index...
echo Existing PDF index progress is reused; scheduled maintenance runs separately from the Bridge.

rem Search scope is the complete Everything index. Configure indexed locations in Everything itself.
rem The new runtime is validated before the old runtime is stopped.
"%NODE_EXE%" "%STAGING%\server.mjs" --write-install-summary >nul 2>nul
"%NODE_EXE%" "%STAGING%\server.mjs" --doctor --allow-unready-task
if not "%ERRORLEVEL%"=="0" goto :doctor_error

rem Stop the current listener first. v37 activation is side-by-side, so a stale
rem Windows handle in an older runtime can never block installation of the new one.
"%NODE_EXE%" "%STAGING%\server.mjs" --stop-existing
if not "%ERRORLEVEL%"=="0" goto :stop_error
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0stop_runtime_helpers.ps1" -AppRoot "%APPROOT%" >nul 2>nul

rem Promote only the new staging directory. Never rename/delete the active runtime
rem as part of activation: Windows may legally keep executable/current-directory
rem handles alive for a short time after shutdown.
call :move_dir_with_retry "%STAGING%" "%RUNTIME%"
if errorlevel 1 goto :activate_error

rem Top-level helpers and the Startup launcher are also transactional. The new
rem maintenance runner depends on node-runtime.txt, so leaving it behind after a
rem failed activation would break a legacy runtime whose Node pointer is restored.
if exist "%AUTOSTARTBACKUP%" del /Q "%AUTOSTARTBACKUP%" >nul 2>nul
if exist "%AUTOSTART%" (
  copy /Y "%AUTOSTART%" "%AUTOSTARTBACKUP%" >nul || goto :activate_error
) else (
  set "AUTOSTARTWASNEW=yes"
)
if exist "%CONFIGUREBACKUP%" del /Q "%CONFIGUREBACKUP%" >nul 2>nul
if exist "%CONFIGURETARGET%" (
  copy /Y "%CONFIGURETARGET%" "%CONFIGUREBACKUP%" >nul || goto :activate_error
) else (
  set "CONFIGUREWASNEW=yes"
)
if exist "%RUNNERBACKUP%" del /Q "%RUNNERBACKUP%" >nul 2>nul
if exist "%RUNNERTARGET%" (
  copy /Y "%RUNNERTARGET%" "%RUNNERBACKUP%" >nul || goto :activate_error
) else (
  set "RUNNERWASNEW=yes"
)

> "%ACTIVETMP%" echo %RUNTIMENAME%
move /Y "%ACTIVETMP%" "%ACTIVEFILE%" >nul || goto :activate_error
copy /Y "%~dp0launch_hidden.vbs" "%AUTOSTART%" >nul || goto :activate_error
copy /Y "%~dp0configure_document_bridge.bat" "%CONFIGURETARGET%" >nul || goto :activate_error
copy /Y "%~dp0run_pdf_maintenance.ps1" "%RUNNERTARGET%" >nul || goto :activate_error
start "" wscript.exe "%AUTOSTART%"
timeout /t 2 /nobreak >nul
"%NODE_EXE%" "%RUNTIME%\server.mjs" --check-running
if not "%ERRORLEVEL%"=="0" goto :activate_error

powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0install_pdf_maintenance_task.ps1" -AppRoot "%APPROOT%"
if not "%ERRORLEVEL%"=="0" goto :activate_error
set "TASKUPDATED=yes"

"%NODE_EXE%" "%RUNTIME%\server.mjs" --doctor
if not "%ERRORLEVEL%"=="0" goto :activate_error

"%NODE_EXE%" "%RUNTIME%\server.mjs" --write-install-summary >nul
if not "%ERRORLEVEL%"=="0" goto :activate_error
if exist "%APPROOT%\bridge-token.txt" type "%APPROOT%\bridge-token.txt" | clip >nul 2>nul

if exist "%CONFIGBACKUP%" del /Q "%CONFIGBACKUP%" >nul 2>nul
if exist "%ACTIVEBACKUP%" del /Q "%ACTIVEBACKUP%" >nul 2>nul
if exist "%NODEPOINTERBACKUP%" del /Q "%NODEPOINTERBACKUP%" >nul 2>nul
if exist "%AUTOSTARTBACKUP%" del /Q "%AUTOSTARTBACKUP%" >nul 2>nul
if exist "%CONFIGUREBACKUP%" del /Q "%CONFIGUREBACKUP%" >nul 2>nul
if exist "%RUNNERBACKUP%" del /Q "%RUNNERBACKUP%" >nul 2>nul
if exist "%APPROOT%\pdf-maintenance-task.before-install.xml" del /Q "%APPROOT%\pdf-maintenance-task.before-install.xml" >nul 2>nul
if exist "%APPROOT%\pdf-maintenance-task.before-install.missing" del /Q "%APPROOT%\pdf-maintenance-task.before-install.missing" >nul 2>nul

rem Old runtimes are cleanup-only. Failure to delete one must never roll back a
rem healthy installation; a stale Windows handle will disappear on its own later.
call :cleanup_inactive_runtimes "%RUNTIMENAME%"
call :cleanup_inactive_node_runtimes "%NODERUNTIME%"

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

:node_error
echo.
echo ERROR: Could not install or verify the pinned private Node.js 24.21.0 runtime.
echo Detailed log: %APPROOT%\install-node.log
echo The previous Document Bridge runtime pointer was preserved.
call :restore_state
pause
exit /b 1

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
"%NODE_EXE%" "%STAGING%\server.mjs" --write-install-summary >nul 2>nul
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
"%NODE_EXE%" "%RUNTIME%\server.mjs" --stop-existing >nul 2>nul
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

:resolve_private_node
set "CANDIDATE_NODE_RUNTIME=%~1"
if not defined CANDIDATE_NODE_RUNTIME exit /b 1
if /I not "%CANDIDATE_NODE_RUNTIME:~0,22%"=="node-v24.21.0-win-x64-" exit /b 1
if not "%CANDIDATE_NODE_RUNTIME:\=%"=="%CANDIDATE_NODE_RUNTIME%" exit /b 1
if not "%CANDIDATE_NODE_RUNTIME:/=%"=="%CANDIDATE_NODE_RUNTIME%" exit /b 1
if not "%CANDIDATE_NODE_RUNTIME:..=%"=="%CANDIDATE_NODE_RUNTIME%" exit /b 1
set "NODE_EXE=%APPROOT%\%CANDIDATE_NODE_RUNTIME%\node.exe"
if not exist "%NODE_EXE%" exit /b 1
exit /b 0

:cleanup_inactive_node_runtimes
set "KEEP_NODE_RUNTIME=%~1"
for /D %%D in ("%APPROOT%\node-v*-win-x64-*") do (
  if /I not "%%~nxD"=="%KEEP_NODE_RUNTIME%" rmdir /S /Q "%%~fD" >nul 2>nul
)
exit /b 0

:restore_helper
set "HELPER_BACKUP=%~1"
set "HELPER_TARGET=%~2"
set "HELPER_WAS_NEW=%~3"
if exist "%HELPER_BACKUP%" (
  copy /Y "%HELPER_BACKUP%" "%HELPER_TARGET%" >nul 2>nul
  del /Q "%HELPER_BACKUP%" >nul 2>nul
) else if /I "%HELPER_WAS_NEW%"=="yes" (
  del /Q "%HELPER_TARGET%" >nul 2>nul
)
exit /b 0

:restore_state
if /I "%TASKUPDATED%"=="yes" (
  powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%~dp0install_pdf_maintenance_task.ps1" -AppRoot "%APPROOT%" -RestoreBackup >nul 2>nul
  if errorlevel 1 echo WARNING: Could not restore the previous PDF maintenance task state.
  set "TASKUPDATED=no"
)
call :restore_helper "%AUTOSTARTBACKUP%" "%AUTOSTART%" "%AUTOSTARTWASNEW%"
call :restore_helper "%CONFIGUREBACKUP%" "%CONFIGURETARGET%" "%CONFIGUREWASNEW%"
call :restore_helper "%RUNNERBACKUP%" "%RUNNERTARGET%" "%RUNNERWASNEW%"
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
if exist "%NODEPOINTERBACKUP%" (
  copy /Y "%NODEPOINTERBACKUP%" "%NODEPOINTER%" >nul 2>nul
  del /Q "%NODEPOINTERBACKUP%" >nul 2>nul
) else if /I "%NODEPOINTERWASNEW%"=="yes" (
  del /Q "%NODEPOINTER%" >nul 2>nul
)
if defined NODERUNTIME if /I not "%NODERUNTIME%"=="%OLDNODERUNTIME%" (
  if exist "%APPROOT%\%NODERUNTIME%" rmdir /S /Q "%APPROOT%\%NODERUNTIME%" >nul 2>nul
)
exit /b 0
