@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

where node >nul 2>nul || (
  echo ERROR: Node.js was not found. Install Node.js 22.22.2 or newer first.
  pause
  exit /b 1
)
node -e "const v=process.versions.node.split('.').map(Number);const ok=v[0]>22||(v[0]===22&&(v[1]>22||(v[1]===22&&v[2]>=2)));process.exit(ok?0:1)" >nul 2>nul
if errorlevel 1 (
  echo ERROR: Bank Bridge requires Node.js 22.22.2 or newer.
  pause
  exit /b 1
)

set "APPROOT=%LOCALAPPDATA%\NetunimKupaBankBridge"
set "APPDIR=%APPROOT%\app"
set "STAGING=%APPROOT%\app-staging"
set "STARTUP=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup"
set "AUTOSTART=%STARTUP%\NetunimKupaBankBridge.vbs"
set "CAMOUFOX_INSTALL_DIR=%APPROOT%\camoufox"

if not exist "%APPROOT%" mkdir "%APPROOT%" >nul 2>nul
if exist "%STAGING%" rmdir /S /Q "%STAGING%" >nul 2>nul
mkdir "%STAGING%" >nul 2>nul || (
  echo ERROR: Could not create the Bank Bridge staging folder.
  pause
  exit /b 1
)

rem Build the new runtime first. The currently installed bridge stays untouched until all checks pass.
for %%F in (server.mjs lib.mjs isracard-camoufox.mjs provision-camoufox.mjs package.json package-lock.json start_bank_bridge.bat) do (
  copy /Y "%~dp0%%F" "%STAGING%\%%F" >nul || (
    echo ERROR: Could not copy %%F into the Bank Bridge staging folder.
    rmdir /S /Q "%STAGING%" >nul 2>nul
    pause
    exit /b 1
  )
)

pushd "%STAGING%"
echo Installing the pinned bank and credit-card scraper dependency...
rem The bridge uses Chrome/Edge already installed on Windows. Puppeteer must not download its own browser.
set "PUPPETEER_SKIP_DOWNLOAD=true"
call npm ci --omit=dev --no-audit --no-fund
set "PUPPETEER_SKIP_DOWNLOAD="
if errorlevel 1 (
  popd
  rmdir /S /Q "%STAGING%" >nul 2>nul
  echo ERROR: npm install failed. The existing Bank Bridge was not changed.
  pause
  exit /b 1
)

echo Installing the pinned Camoufox adapter used by American Express...
call npm install --no-save --package-lock=false --no-audit --no-fund camoufox-js@0.12.0 playwright-core@1.60.0
if errorlevel 1 (
  popd
  rmdir /S /Q "%STAGING%" >nul 2>nul
  echo ERROR: Camoufox Node runtime installation failed. The existing Bank Bridge was not changed.
  pause
  exit /b 1
)

echo Validating/provisioning the Camoufox browser in the stable local cache...
rem Do not use the upstream `camoufox fetch` CLI here: it also downloads the optional GeoIP MMDB.
rem Netunim never enables Camoufox geoip, so that unrelated download must not make Bridge installation fail.
node provision-camoufox.mjs
if errorlevel 1 (
  popd
  rmdir /S /Q "%STAGING%" >nul 2>nul
  echo ERROR: Camoufox browser provisioning failed. The existing Bank Bridge was not changed.
  echo Check the error above and try install_bank_bridge.bat again.
  pause
  exit /b 1
)

echo Checking Chrome/Edge, Camoufox and the scraper runtime...
node server.mjs --doctor
if errorlevel 1 (
  popd
  rmdir /S /Q "%STAGING%" >nul 2>nul
  echo ERROR: Bank Bridge doctor check failed. Install or update Google Chrome or Microsoft Edge and try again.
  pause
  exit /b 1
)
popd

echo Stopping an older Bank Bridge instance, if one is running...
node "%STAGING%\server.mjs" --stop-existing
if errorlevel 1 (
  rmdir /S /Q "%STAGING%" >nul 2>nul
  echo ERROR: An older Bank Bridge could not be stopped safely.
  pause
  exit /b 1
)

if exist "%APPDIR%" rmdir /S /Q "%APPDIR%" >nul 2>nul
if exist "%APPDIR%" (
  rmdir /S /Q "%STAGING%" >nul 2>nul
  echo ERROR: The previous Bank Bridge runtime could not be removed.
  echo Close any antivirus/file-manager process holding: %APPDIR%
  pause
  exit /b 1
)
move "%STAGING%" "%APPDIR%" >nul || (
  echo ERROR: Could not activate the new Bank Bridge runtime.
  pause
  exit /b 1
)

pushd "%APPDIR%"
node server.mjs --init
if errorlevel 1 (
  popd
  echo ERROR: Bank Bridge initialization failed.
  pause
  exit /b 1
)
popd

rem Replace the historical generated VBS with an ASCII-only launcher that resolves LOCALAPPDATA at runtime.
copy /Y "%~dp0launch_hidden.vbs" "%AUTOSTART%" >nul || (
  echo ERROR: Could not install the Windows startup launcher.
  pause
  exit /b 1
)

start "" wscript.exe "%AUTOSTART%"
timeout /t 2 /nobreak >nul
node -e "fetch('http://127.0.0.1:8765/health',{cache:'no-store'}).then(r=>r.json()).then(j=>{if(j.service!=='netunim-kupa-bank-bridge'||!(Number(j.version)>=15))process.exit(2)}).catch(()=>process.exit(1))"
if errorlevel 1 (
  echo ERROR: Bank Bridge did not start correctly.
  echo See: %APPROOT%\bridge.log
  pause
  exit /b 1
)

if exist "%APPROOT%\bridge-token.txt" type "%APPROOT%\bridge-token.txt" | clip
echo.
echo Bank Bridge was installed successfully in a stable local folder and added to Windows startup.
echo The Bank Bridge key was copied to the clipboard. Paste it into Kupa on THIS computer.
echo Install the Bridge separately on every other computer that should refresh bank or credit-card data.
echo Hapoalim and credit-card credentials stay encrypted by Windows DPAPI on each computer and are never uploaded to Kupa or Supabase.
echo American Express uses a local Camoufox browser installed under %CAMOUFOX_INSTALL_DIR% to pass the issuer WAF with a real browser fingerprint.
echo.
pause
