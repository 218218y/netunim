@echo off
setlocal
set "APPDIR=%LOCALAPPDATA%\NetunimDocumentBridge\app"
if not exist "%APPDIR%\server.mjs" (
  echo ERROR: Document Bridge is not installed on this computer.
  echo Run install_document_bridge.bat first.
  pause
  exit /b 1
)
node "%APPDIR%\server.mjs" --configure
if errorlevel 1 (
  echo ERROR: Configuration was not saved.
  pause
  exit /b 1
)
node "%APPDIR%\server.mjs" --stop-existing >nul 2>nul
set "AUTOSTART=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\NetunimDocumentBridge.vbs"
if exist "%AUTOSTART%" start "" wscript.exe "%AUTOSTART%"
echo.
echo Configuration saved. Document Bridge was restarted.
pause
