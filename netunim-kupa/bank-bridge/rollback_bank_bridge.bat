@echo off
setlocal EnableExtensions DisableDelayedExpansion

set "APPROOT=%LOCALAPPDATA%\NetunimKupaBankBridge"
set "APPDIR=%APPROOT%\app"
set "APPBACKUP=%APPROOT%\app-rollback"
set "SWAP=%APPROOT%\app-rollback-swap"
set "AUTOSTART=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\NetunimKupaBankBridge.vbs"

where node >nul 2>nul || (
  echo ERROR: Node.js was not found.
  pause
  exit /b 1
)
if not exist "%APPDIR%\server.mjs" (
  echo ERROR: The active Bank Bridge runtime is missing.
  pause
  exit /b 1
)
if not exist "%APPBACKUP%\server.mjs" (
  echo ERROR: No preserved Bank Bridge runtime is available for rollback.
  pause
  exit /b 1
)

echo Stopping the active Bank Bridge...
node "%APPDIR%\server.mjs" --stop-existing
if errorlevel 1 (
  echo ERROR: The active Bank Bridge could not be stopped safely.
  pause
  exit /b 1
)

if exist "%SWAP%" rmdir /S /Q "%SWAP%" >nul 2>nul
if exist "%SWAP%" (
  echo ERROR: The temporary rollback folder is locked: %SWAP%
  pause
  exit /b 1
)
move "%APPDIR%" "%SWAP%" >nul || (
  echo ERROR: The active runtime could not be moved aside.
  pause
  exit /b 1
)
move "%APPBACKUP%" "%APPDIR%" >nul || (
  move "%SWAP%" "%APPDIR%" >nul
  echo ERROR: The preserved runtime could not be activated. The current runtime was restored.
  pause
  exit /b 1
)
move "%SWAP%" "%APPBACKUP%" >nul || (
  echo WARNING: Rollback succeeded, but the newer runtime could not be retained for a one-command roll-forward.
)

pushd "%APPDIR%"
node server.mjs --init
if errorlevel 1 (
  popd
  echo ERROR: The restored Bridge could not initialize. Review %APPROOT%\bridge.log.
  pause
  exit /b 1
)
popd

if exist "%AUTOSTART%" start "" wscript.exe "%AUTOSTART%"
timeout /t 2 /nobreak >nul
node -e "fetch('http://127.0.0.1:8765/health',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(j.service!=='netunim-kupa-bank-bridge')process.exit(2);console.log('Restored Bank Bridge version '+j.version)}).catch(()=>process.exit(1))"
if errorlevel 1 (
  echo ERROR: The restored Bank Bridge did not answer its health check.
  echo See: %APPROOT%\bridge.log
  pause
  exit /b 1
)

echo Rollback completed. Credit data and encrypted profiles under %APPROOT% were not deleted.
echo Run this helper again to swap back to the other preserved runtime, or rerun install_bank_bridge.bat.
pause
