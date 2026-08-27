@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

set "SITE_DIR=%CD%\site"
set "PROJECT_NAME=bargig-kupa"
set "DEPLOY_WORK_DIR=%TEMP%\bargig-kupa-wrangler-work"

if not exist "%SITE_DIR%\index.html" (
  echo ERROR: site\index.html was not found.
  echo Keep deploy_site.bat in the project root, next to the site folder.
  pause
  exit /b 1
)
where npx >nul 2>&1
if errorlevel 1 (
  echo ERROR: npx was not found. Install Node.js or fix PATH before deployment.
  pause
  exit /b 1
)

rem Hard proof that this is the intentionally generated public, data-free build.
findstr /C:"kupa-public-data-free-v1" "%SITE_DIR%\index.html" >nul 2>&1
if errorlevel 1 (
  echo ERROR: site\index.html is not the verified data-free public build.
  echo Rebuild/review site before deployment. The source HTML must never be deployed directly.
  pause
  exit /b 2
)

rem Required public shell files: fail before Wrangler if the site directory is incomplete.
for %%F in (index.html _headers service-worker.js manifest.webmanifest favicon.ico favicon-16x16.png favicon-32x32.png apple-touch-icon.png android-chrome-192x192.png android-chrome-512x512.png) do if not exist "%SITE_DIR%\%%F" (
  echo ERROR: required public file is missing: site\%%F
  pause
  exit /b 2
)
if not exist "%SITE_DIR%\supabase\config.js" (
  echo ERROR: required public file is missing: site\supabase\config.js
  pause
  exit /b 2
)

rem CSP-safe runtime self-check: eval() is intentionally forbidden by our CSP.
findstr /C:"globalThis[name]" "%SITE_DIR%\index.html" >nul 2>&1
if errorlevel 1 (
  echo ERROR: site\index.html does not contain the CSP-safe runtime self-check.
  pause
  exit /b 2
)
findstr /C:"eval(name)" "%SITE_DIR%\index.html" >nul 2>&1
if not errorlevel 1 (
  echo ERROR: site\index.html still uses eval in the runtime self-check.
  echo This build would be blocked by the production Content-Security-Policy.
  pause
  exit /b 2
)

rem Same-origin fetches are required by the service worker and Cloudflare /cdn-cgi challenge code.
findstr /C:"connect-src 'self'" "%SITE_DIR%\_headers" >nul 2>&1
if errorlevel 1 (
  echo ERROR: site\_headers CSP does not allow same-origin connect-src.
  echo Service Worker and Cloudflare challenge requests would be blocked.
  pause
  exit /b 2
)

if exist "%SITE_DIR%\.wrangler\" (
  echo Removing stale Wrangler cache from site...
  rmdir /S /Q "%SITE_DIR%\.wrangler" >nul 2>&1
  if exist "%SITE_DIR%\.wrangler\" (
    echo ERROR: could not remove site\.wrangler.
    pause
    exit /b 2
  )
)
for /R "%SITE_DIR%" %%F in (Thumbs.db) do if exist "%%F" del /Q "%%F" >nul 2>&1

set "FOUND_BLOCKED_FILE="
for /R "%SITE_DIR%" %%F in (*.json *.sql *.db *.sqlite *.sqlite3 *.bak *.zip *.patch *.pem *.key *.pfx *.p12) do (
  if exist "%%F" (
    echo BLOCKED: %%F
    set "FOUND_BLOCKED_FILE=1"
  )
)
for /R "%SITE_DIR%" %%F in (.env .env.* .dev.vars .dev.vars.*) do (
  if exist "%%F" (
    echo BLOCKED: %%F
    set "FOUND_BLOCKED_FILE=1"
  )
)
for %%D in (.wrangler functions data backups .git node_modules) do if exist "%SITE_DIR%\%%D\" (
  echo BLOCKED: %SITE_DIR%\%%D
  set "FOUND_BLOCKED_FILE=1"
)
for %%F in (_worker.js _routes.json wrangler.toml wrangler.json wrangler.jsonc) do if exist "%SITE_DIR%\%%F" (
  echo BLOCKED: %SITE_DIR%\%%F
  set "FOUND_BLOCKED_FILE=1"
)
if defined FOUND_BLOCKED_FILE (
  echo.
  echo Deployment stopped: a potentially sensitive or unexpected file exists inside site.
  echo Remove or review the blocked item before publishing.
  pause
  exit /b 2
)

if not exist "%DEPLOY_WORK_DIR%\" mkdir "%DEPLOY_WORK_DIR%" >nul 2>&1
if not exist "%DEPLOY_WORK_DIR%\" (
  echo ERROR: could not create the isolated Wrangler working directory:
  echo   %DEPLOY_WORK_DIR%
  pause
  exit /b 3
)
if exist "%DEPLOY_WORK_DIR%\functions\" (
  echo ERROR: unexpected functions directory exists in the isolated Wrangler working directory:
  echo   %DEPLOY_WORK_DIR%\functions
  pause
  exit /b 3
)

echo.
echo Deploying ONLY the verified site directory to Cloudflare Pages.
echo Static root:
echo   %SITE_DIR%
echo Wrangler working directory:
echo   %DEPLOY_WORK_DIR%
echo Project:
echo   %PROJECT_NAME%
echo.
pushd "%DEPLOY_WORK_DIR%"
if errorlevel 1 (
  echo ERROR: could not enter the isolated Wrangler working directory.
  pause
  exit /b 3
)
call npx wrangler pages deploy "%SITE_DIR%" --project-name "%PROJECT_NAME%"
set "DEPLOY_EXIT=%ERRORLEVEL%"
popd
if not "%DEPLOY_EXIT%"=="0" (
  echo.
  echo Deployment failed. Wrangler exit code: %DEPLOY_EXIT%
  pause
  exit /b %DEPLOY_EXIT%
)
echo.
echo Deployment completed successfully.
pause
exit /b 0
