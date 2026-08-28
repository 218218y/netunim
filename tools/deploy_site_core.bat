@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Internal per-site deployment engine. Verification is intentionally owned by
rem deploy_site.bat (single-site) or deploy_all.bat (two-site) so the repository
rem test suite has exactly one authoritative gate per deployment operation.
if not "%NETUNIM_DEPLOY_VERIFIED%"=="1" (
  echo ERROR: deploy_site_core.bat is internal and requires a successful repository verification gate.
  echo Use deploy_all.bat or an application's deploy_site.bat instead.
  exit /b 2
)
if "%~1"=="" exit /b 2
if "%~2"=="" exit /b 2
if "%~3"=="" exit /b 2
if "%~5"=="" exit /b 2
if not "%~7"=="" if /I not "%~7"=="--preflight-only" exit /b 2

set "PROJECT_DIR=%~f1"
set "PROJECT_NAME=%~2"
set "BUILD_MARKER=%~3"
set "RUNTIME_SELF_CHECK_MARKER=%~4"
set "WRANGLER_VERSION=%~5"
set "RUNTIME_SELF_CHECK_FILE=%~6"
cd /d "%PROJECT_DIR%"
if errorlevel 1 (
  echo ERROR: project directory was not found or could not be opened:
  echo   %PROJECT_DIR%
  exit /b 2
)
set "SITE_DIR=%CD%\site"
set "DEPLOY_WORK_DIR=%TEMP%\%PROJECT_NAME%-wrangler-%RANDOM%-%RANDOM%"

if not exist "%SITE_DIR%\index.html" (
  echo ERROR: site\index.html was not found.
  echo Keep deploy_site.bat in the project root, next to the site folder.
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo ERROR: Node.js was not found. Install a supported Node.js version or fix PATH.
  exit /b 1
)
where npx >nul 2>&1
if errorlevel 1 (
  echo ERROR: npx was not found. Install npm/Node.js or fix PATH before deployment.
  exit /b 1
)

rem Prove that the public, data-free build is the file being deployed.
findstr /C:"%BUILD_MARKER%" "%SITE_DIR%\index.html" >nul 2>&1
if errorlevel 1 (
  echo ERROR: site\index.html is not the verified data-free public build.
  echo Expected build marker: %BUILD_MARKER%
  echo Rebuild/review site before deployment. Never deploy a source HTML file containing business data.
  exit /b 2
)

rem Required public shell files: fail before Wrangler if the site directory is incomplete.
for %%F in (index.html _headers service-worker.js manifest.webmanifest assets\app.css assets\app.js assets\js\main.js assets\js\lifecycle.js favicon.ico favicon-16x16.png favicon-32x32.png apple-touch-icon.png android-chrome-192x192.png android-chrome-512x512.png) do if not exist "%SITE_DIR%\%%F" (
  echo ERROR: required public file is missing: site\%%F
  exit /b 2
)
if not exist "%SITE_DIR%\supabase\config.js" (
  echo ERROR: required public file is missing: site\supabase\config.js
  exit /b 2
)

rem Executable browser code is kept in explicit JavaScript assets. The CSP does not
rem allow dynamic code execution, so reject eval/Function-constructor regressions anywhere
rem in the published JavaScript tree rather than checking index.html only.
set "FOUND_DYNAMIC_CODE="
for /R "%SITE_DIR%" %%F in (*.js) do (
  findstr /C:"eval(" "%%F" >nul 2>&1
  if not errorlevel 1 (
    echo ERROR: public JavaScript contains eval^(^): %%F
    set "FOUND_DYNAMIC_CODE=1"
  )
  findstr /C:"new Function(" "%%F" >nul 2>&1
  if not errorlevel 1 (
    echo ERROR: public JavaScript contains a Function constructor: %%F
    set "FOUND_DYNAMIC_CODE=1"
  )
)
if defined FOUND_DYNAMIC_CODE (
  echo Remove dynamic-code execution before deployment.
  exit /b 2
)
if defined RUNTIME_SELF_CHECK_MARKER (
  if not defined RUNTIME_SELF_CHECK_FILE (
    echo ERROR: runtime self-check marker was configured without a target file.
    exit /b 2
  )
  findstr /C:"%RUNTIME_SELF_CHECK_MARKER%" "%SITE_DIR%\%RUNTIME_SELF_CHECK_FILE%" >nul 2>&1
  if errorlevel 1 (
    echo ERROR: site\%RUNTIME_SELF_CHECK_FILE% does not contain the expected CSP-safe runtime self-check.
    exit /b 2
  )
)

rem Validate the minimum security/runtime headers expected by both static applications.
findstr /C:"Content-Security-Policy:" "%SITE_DIR%\_headers" >nul 2>&1
if errorlevel 1 (
  echo ERROR: site\_headers does not contain a Content-Security-Policy header.
  exit /b 2
)
findstr /C:"connect-src 'self'" "%SITE_DIR%\_headers" >nul 2>&1
if errorlevel 1 (
  echo ERROR: site\_headers CSP does not allow same-origin connect-src.
  echo Service Worker and Cloudflare same-origin requests may be blocked.
  exit /b 2
)
findstr /C:"X-Frame-Options: DENY" "%SITE_DIR%\_headers" >nul 2>&1
if errorlevel 1 (
  echo ERROR: site\_headers does not deny framing.
  exit /b 2
)

rem The browser bundle may contain only a Supabase publishable key, never a secret key.
findstr /C:"publishableKey" "%SITE_DIR%\supabase\config.js" >nul 2>&1
if errorlevel 1 (
  echo ERROR: site\supabase\config.js does not contain the expected publishableKey setting.
  exit /b 2
)
findstr /I /C:"sb_secret_" /C:"SUPABASE_SERVICE_ROLE_KEY" "%SITE_DIR%\supabase\config.js" >nul 2>&1
if not errorlevel 1 (
  echo ERROR: a Supabase secret/service-role key marker was found in public config.js.
  echo Remove the secret before deployment.
  exit /b 2
)

rem Preflight is read-only. Review/remove unexpected files explicitly.
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
  exit /b 2
)

rem These projects are intentionally static-only. If deployment-affecting files appear
rem in the project root, stop so they are reviewed instead of silently ignoring them.
if exist "%CD%\functions\" (
  echo ERROR: a root-level functions folder exists: %CD%\functions
  echo This deployment is static-only. Review/remove that folder before publishing.
  exit /b 2
)
for %%F in (_worker.js _routes.json wrangler.toml wrangler.json wrangler.jsonc) do if exist "%CD%\%%F" (
  echo ERROR: a root-level deployment file exists: %CD%\%%F
  echo This script deliberately deploys a static Pages project without local Wrangler configuration.
  echo Review/remove that file before publishing.
  exit /b 2
)

if /I "%~7"=="--preflight-only" (
  echo Deployment preflight passed. No deployment requested.
  exit /b 0
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
  exit /b 3
)
call npx --yes wrangler@%WRANGLER_VERSION% pages deploy "%SITE_DIR%" --project-name "%PROJECT_NAME%"
set "DEPLOY_EXIT=%ERRORLEVEL%"
popd

rmdir /S /Q "%DEPLOY_WORK_DIR%" >nul 2>&1

if not "%DEPLOY_EXIT%"=="0" (
  echo.
  echo Deployment failed. Wrangler exit code: %DEPLOY_EXIT%
  exit /b %DEPLOY_EXIT%
)

echo.
echo Deployment completed successfully.
echo Production URL:
echo   https://%PROJECT_NAME%.pages.dev/
echo.
echo Wrangler may also print the unique URL for this deployment above.
exit /b 0
