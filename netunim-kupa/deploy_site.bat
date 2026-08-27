@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"

set "PROJECT_NAME=bargig-kupa"
set "BUILD_MARKER=kupa-public-data-free-v1"
set "RUNTIME_SELF_CHECK_MARKER=globalThis[name]"
set "WRANGLER_VERSION=4.125.0"
set "SITE_DIR=%CD%\site"
set "DEPLOY_WORK_DIR=%TEMP%\%PROJECT_NAME%-wrangler-%RANDOM%-%RANDOM%"

if not exist "%SITE_DIR%\index.html" (
  echo ERROR: site\index.html was not found.
  echo Keep deploy_site.bat in the project root, next to the site folder.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js was not found. Install a supported Node.js version or fix PATH.
  pause
  exit /b 1
)
where npx >nul 2>&1
if errorlevel 1 (
  echo ERROR: npx was not found. Install npm/Node.js or fix PATH before deployment.
  pause
  exit /b 1
)

rem Prove that the public, data-free build is the file being deployed.
findstr /C:"%BUILD_MARKER%" "%SITE_DIR%\index.html" >nul 2>&1
if errorlevel 1 (
  echo ERROR: site\index.html is not the verified data-free public build.
  echo Expected build marker: %BUILD_MARKER%
  echo Rebuild/review site before deployment. Never deploy a source HTML file containing business data.
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

rem CSP intentionally does not allow eval(). Reject a public build that reintroduces it.
findstr /C:"eval(" "%SITE_DIR%\index.html" >nul 2>&1
if not errorlevel 1 (
  echo ERROR: site\index.html contains eval^(^), which is blocked by the production CSP.
  pause
  exit /b 2
)
if defined RUNTIME_SELF_CHECK_MARKER (
  findstr /C:"%RUNTIME_SELF_CHECK_MARKER%" "%SITE_DIR%\index.html" >nul 2>&1
  if errorlevel 1 (
    echo ERROR: site\index.html does not contain the expected CSP-safe runtime self-check.
    pause
    exit /b 2
  )
)

rem Validate the minimum security/runtime headers expected by both static applications.
findstr /C:"Content-Security-Policy:" "%SITE_DIR%\_headers" >nul 2>&1
if errorlevel 1 (
  echo ERROR: site\_headers does not contain a Content-Security-Policy header.
  pause
  exit /b 2
)
findstr /C:"connect-src 'self'" "%SITE_DIR%\_headers" >nul 2>&1
if errorlevel 1 (
  echo ERROR: site\_headers CSP does not allow same-origin connect-src.
  echo Service Worker and Cloudflare same-origin requests may be blocked.
  pause
  exit /b 2
)
findstr /C:"X-Frame-Options: DENY" "%SITE_DIR%\_headers" >nul 2>&1
if errorlevel 1 (
  echo ERROR: site\_headers does not deny framing.
  pause
  exit /b 2
)

rem The browser bundle may contain only a Supabase publishable key, never a secret key.
findstr /C:"publishableKey" "%SITE_DIR%\supabase\config.js" >nul 2>&1
if errorlevel 1 (
  echo ERROR: site\supabase\config.js does not contain the expected publishableKey setting.
  pause
  exit /b 2
)
findstr /I /C:"sb_secret_" /C:"SUPABASE_SERVICE_ROLE_KEY" "%SITE_DIR%\supabase\config.js" >nul 2>&1
if not errorlevel 1 (
  echo ERROR: a Supabase secret/service-role key marker was found in public config.js.
  echo Remove the secret before deployment.
  pause
  exit /b 2
)

rem Remove harmless OS/Wrangler leftovers before the safety scan.
if exist "%SITE_DIR%\.wrangler\" (
  echo Removing stale Wrangler cache from site...
  rmdir /S /Q "%SITE_DIR%\.wrangler" >nul 2>&1
  if exist "%SITE_DIR%\.wrangler\" (
    echo ERROR: could not remove site\.wrangler.
    pause
    exit /b 2
  )
)
for /R "%SITE_DIR%" %%F in (Thumbs.db .DS_Store) do if exist "%%F" del /Q "%%F" >nul 2>&1

rem Safety guard: the public site must not contain raw data, databases, backups,
rem private keys, archives, environment files, deployment internals, or source-only directories.
set "FOUND_BLOCKED_FILE="
for /R "%SITE_DIR%" %%F in (*.json *.sql *.db *.sqlite *.sqlite3 *.bak *.zip *.patch *.pem *.key *.pfx *.p12 *.csv *.tsv) do (
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

rem Cloudflare Pages currently limits each uploaded file to 25 MiB.
set "FOUND_OVERSIZED_FILE="
for /R "%SITE_DIR%" %%F in (*) do (
  if %%~zF GTR 26214400 (
    echo BLOCKED: file exceeds 25 MiB: %%F
    set "FOUND_OVERSIZED_FILE=1"
  )
)
if defined FOUND_OVERSIZED_FILE (
  echo.
  echo Deployment stopped: one or more files exceed the Cloudflare Pages per-file limit.
  pause
  exit /b 2
)

rem These projects are intentionally static-only. If deployment-affecting files appear
rem in the project root, stop so they are reviewed instead of silently ignoring them.
if exist "%CD%\functions\" (
  echo ERROR: a root-level functions folder exists: %CD%\functions
  echo This deployment is static-only. Review/remove that folder before publishing.
  pause
  exit /b 2
)
for %%F in (_worker.js _routes.json wrangler.toml wrangler.json wrangler.jsonc) do if exist "%CD%\%%F" (
  echo ERROR: a root-level deployment file exists: %CD%\%%F
  echo This script deliberately deploys a static Pages project without local Wrangler configuration.
  echo Review/remove that file before publishing.
  pause
  exit /b 2
)

rem Use a fresh isolated working directory on every run. Cloudflare documents that a
rem functions folder where Wrangler is run can be uploaded, and Wrangler can also discover
rem generated configuration by walking parent directories. Isolation prevents both classes
rem of accidental deployment and avoids stale Wrangler metadata from earlier runs.
if exist "%DEPLOY_WORK_DIR%\" rmdir /S /Q "%DEPLOY_WORK_DIR%" >nul 2>&1
mkdir "%DEPLOY_WORK_DIR%" >nul 2>&1
if not exist "%DEPLOY_WORK_DIR%\" (
  echo ERROR: could not create the isolated Wrangler working directory:
  echo   %DEPLOY_WORK_DIR%
  pause
  exit /b 3
)

for /f "delims=" %%V in ('node --version 2^>nul') do set "NODE_VERSION=%%V"

echo.
echo Deployment preflight passed.
echo Project:
 echo   %PROJECT_NAME%
echo Static root:
 echo   %SITE_DIR%
echo Isolated Wrangler working directory:
 echo   %DEPLOY_WORK_DIR%
echo Node.js:
 echo   %NODE_VERSION%
echo Wrangler:
 echo   %WRANGLER_VERSION% ^(pinned for reproducible deployments^)
echo.
echo Deploying the verified static site to Cloudflare Pages production...
echo.

pushd "%DEPLOY_WORK_DIR%"
if errorlevel 1 (
  echo ERROR: could not enter the isolated Wrangler working directory.
  rmdir /S /Q "%DEPLOY_WORK_DIR%" >nul 2>&1
  pause
  exit /b 3
)
call npx --yes wrangler@%WRANGLER_VERSION% pages deploy "%SITE_DIR%" --project-name "%PROJECT_NAME%"
set "DEPLOY_EXIT=%ERRORLEVEL%"
popd

rmdir /S /Q "%DEPLOY_WORK_DIR%" >nul 2>&1

if not "%DEPLOY_EXIT%"=="0" (
  echo.
  echo Deployment failed. Wrangler exit code: %DEPLOY_EXIT%
  pause
  exit /b %DEPLOY_EXIT%
)

echo.
echo Deployment completed successfully.
echo Production URL:
echo   https://%PROJECT_NAME%.pages.dev/
echo.
echo Wrangler may also print the unique URL for this deployment above.
pause
exit /b 0
