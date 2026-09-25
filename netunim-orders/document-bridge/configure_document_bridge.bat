@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "APPROOT=%LOCALAPPDATA%\NetunimDocumentBridge"
set "APPDIR=%APPROOT%\app"
set "CONFIG=%APPROOT%\config.json"
set "BACKUP=%APPROOT%\config.before-reconfigure.json"
set "WASNEW=no"
set "SUMMARY=%APPROOT%\INSTALLATION-LOG.txt"
set "AUTOSTART=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\NetunimDocumentBridge.vbs"

if not exist "%APPDIR%\server.mjs" (
  echo ERROR: Document Bridge is not installed on this computer.
  echo Run install_document_bridge.bat first.
  pause
  exit /b 1
)

if exist "%BACKUP%" del /Q "%BACKUP%" >nul 2>nul
if exist "%CONFIG%" (
  copy /Y "%CONFIG%" "%BACKUP%" >nul || goto :backup_error
) else (
  set "WASNEW=yes"
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%APPDIR%\configure_document_bridge.ps1" -AppRoot "%APPROOT%"
if not "%ERRORLEVEL%"=="0" goto :restore_config

node "%APPDIR%\server.mjs" --write-install-summary >nul 2>nul
node "%APPDIR%\server.mjs" --doctor
if not "%ERRORLEVEL%"=="0" goto :diagnostic_error

node "%APPDIR%\server.mjs" --stop-existing
if not "%ERRORLEVEL%"=="0" goto :runtime_error

if exist "%AUTOSTART%" start "" wscript.exe "%AUTOSTART%"
timeout /t 2 /nobreak >nul
node "%APPDIR%\server.mjs" --check-running
if not "%ERRORLEVEL%"=="0" goto :runtime_error

node "%APPDIR%\server.mjs" --write-install-summary >nul
if not "%ERRORLEVEL%"=="0" goto :runtime_error
if exist "%BACKUP%" del /Q "%BACKUP%" >nul 2>nul
if exist "%SUMMARY%" start "" notepad.exe "%SUMMARY%"
echo.
echo Configuration saved and Document Bridge restarted successfully.
pause
exit /b 0

:diagnostic_error
node "%APPDIR%\server.mjs" --write-install-summary >nul 2>nul
if exist "%SUMMARY%" start "" notepad.exe "%SUMMARY%"
echo ERROR: The selected folders did not pass document-index diagnostics.
goto :restore_config

:runtime_error
echo ERROR: Document Bridge could not be restarted safely.
echo See: %APPROOT%\bridge.log
goto :restore_config

:restore_config
if exist "%BACKUP%" (
  copy /Y "%BACKUP%" "%CONFIG%" >nul 2>nul
  del /Q "%BACKUP%" >nul 2>nul
) else if /I "%WASNEW%"=="yes" (
  del /Q "%CONFIG%" >nul 2>nul
)
echo Configuration was not activated. The previous configuration was restored.
pause
exit /b 1

:backup_error
echo ERROR: Could not create a safe backup of the current Document Bridge configuration.
pause
exit /b 1
