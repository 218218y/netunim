@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
where node >nul 2>nul || (
  echo ERROR: Node.js was not found. Install Node.js 22.13 or newer first.
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]>22||(v[0]===22&&v[1]>=13)?0:1)" >nul 2>nul
if errorlevel 1 (
  echo ERROR: Document Bridge requires Node.js 22.13 or newer.
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

if not exist "%APPROOT%" mkdir "%APPROOT%" >nul 2>nul
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
mkdir "%STAGING%" >nul 2>nul || goto :stage_error
for %%F in (server.mjs lib.mjs start_document_bridge.bat) do (
  copy /Y "%~dp0%%F" "%STAGING%\%%F" >nul || goto :stage_error
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install_es.ps1" -AppRoot "%APPROOT%"
if errorlevel 1 (
  echo.
  echo ERROR: Could not install/verify the official Everything ES command-line client.
  echo The installer no longer waits indefinitely on a blocked download host.
  echo If your filter blocks the automatic download, download the exact ES ZIP shown above,
  echo leave it next to this installer or in your Downloads folder, and run this file again.
  echo Detailed log: %APPROOT%\install-es.log
  rmdir /S /Q "%STAGING%" >nul 2>nul
  pause
  exit /b 1
)

node "%STAGING%\server.mjs" --init
if errorlevel 1 goto :stage_error
if not exist "%APPROOT%\config.json" goto :stage_error

rem Configure roots on first install. Existing per-computer configuration is preserved on upgrades.
for /f %%A in ('powershell.exe -NoProfile -Command "$c=Get-Content -Raw -ErrorAction SilentlyContinue '%APPROOT%\config.json'|ConvertFrom-Json; if($c.roots.Count -gt 0){'yes'}else{'no'}"') do set "HASROOTS=%%A"
if /I not "%HASROOTS%"=="yes" (
  node "%STAGING%\server.mjs" --configure
  if errorlevel 1 goto :stage_error
)

node "%STAGING%\server.mjs" --doctor
if errorlevel 1 (
  echo.
  echo ERROR: Everything/ES doctor check failed. The existing Document Bridge was not changed.
  echo Make sure Everything 1.5 is running and the configured folders are indexed for content.
  rmdir /S /Q "%STAGING%" >nul 2>nul
  pause
  exit /b 1
)

node "%STAGING%\server.mjs" --stop-existing
if errorlevel 1 (
  echo ERROR: An older Document Bridge could not be stopped safely.
  rmdir /S /Q "%STAGING%" >nul 2>nul
  pause
  exit /b 1
)
if exist "%APPBACKUP%" rmdir /S /Q "%APPBACKUP%" >nul 2>nul
if exist "%APPDIR%" move "%APPDIR%" "%APPBACKUP%" >nul || (
  echo ERROR: Could not preserve the current Document Bridge for rollback.
  rmdir /S /Q "%STAGING%" >nul 2>nul
  pause
  exit /b 1
)
move "%STAGING%" "%APPDIR%" >nul || (
  if exist "%APPBACKUP%" move "%APPBACKUP%" "%APPDIR%" >nul
  echo ERROR: Could not activate the new Document Bridge.
  pause
  exit /b 1
)
copy /Y "%~dp0launch_hidden.vbs" "%AUTOSTART%" >nul || goto :activate_error
copy /Y "%~dp0configure_document_bridge.bat" "%APPROOT%\configure_document_bridge.bat" >nul || goto :activate_error
start "" wscript.exe "%AUTOSTART%"
timeout /t 2 /nobreak >nul
node -e "fetch('http://127.0.0.1:8766/health',{cache:'no-store'}).then(r=>r.json()).then(j=>process.exit(j.service==='netunim-orders-document-bridge'&&Number(j.version)>=1?0:2)).catch(()=>process.exit(1))"
if errorlevel 1 goto :activate_error
if exist "%APPROOT%\bridge-token.txt" type "%APPROOT%\bridge-token.txt" | clip

echo.
echo Document Bridge installed successfully on THIS computer.
echo Its private key was copied to the clipboard. Open the website, choose "documents on this computer", and paste the key once.
echo Install this Bridge separately on every computer. Each computer searches only its own local Everything index.
echo To change local/network document roots later run: %APPROOT%\configure_document_bridge.bat
echo PDF files are not uploaded to the website or Supabase.
echo.
pause
exit /b 0

:stage_error
echo ERROR: Could not prepare Document Bridge. The current installation was not changed.
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
pause
exit /b 1

:activate_error
node "%APPDIR%\server.mjs" --stop-existing >nul 2>nul
if exist "%APPFAILED%" rmdir /S /Q "%APPFAILED%" >nul 2>nul
if exist "%APPDIR%" move "%APPDIR%" "%APPFAILED%" >nul 2>nul
if exist "%APPBACKUP%" move "%APPBACKUP%" "%APPDIR%" >nul 2>nul
if exist "%APPDIR%" start "" wscript.exe "%AUTOSTART%"
echo ERROR: New Document Bridge did not start correctly. Previous runtime was restored when available.
echo See: %APPROOT%\bridge.log
pause
exit /b 1
