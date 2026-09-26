@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "APPROOT=%LOCALAPPDATA%\NetunimDocumentBridge"
set "APPDIR=%APPROOT%\app"
set "SUMMARY=%APPROOT%\INSTALLATION-LOG.txt"

if not exist "%APPDIR%\server.mjs" (
  echo ERROR: Document Bridge is not installed on this computer.
  pause
  exit /b 1
)

echo.
echo Document Bridge v4 searches the COMPLETE Everything index.
echo There is no separate folder list in the Bridge anymore.
echo Add/remove indexed drives and folders directly in Everything Options.
echo.
node "%APPDIR%\server.mjs" --ensure-everything
node "%APPDIR%\server.mjs" --write-install-summary >nul 2>nul
if exist "%SUMMARY%" start "" notepad.exe "%SUMMARY%"
pause
