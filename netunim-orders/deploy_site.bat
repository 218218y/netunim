@echo off
setlocal EnableExtensions DisableDelayedExpansion

rem Always run from the project root, exactly like the known-good manual command.
cd /d "%~dp0"

set "PROJECT_NAME=bargig-orders"
set "SITE_DIR=site"

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

rem Cloudflare Pages Wrangler uploads a root-level functions folder when one exists
rem in the directory from which the command is run. This project is static-only,
rem so stop instead of silently publishing unexpected Functions.
if exist "functions\" (
  echo ERROR: a root-level functions folder exists:
  echo   %CD%\functions
  echo.
  echo Deployment stopped because Wrangler would include that folder.
  echo Remove or review it before publishing this static site.
  pause
  exit /b 2
)

rem Cleanup left by older deploy scripts that ran Wrangler from inside site.
if exist "%SITE_DIR%\.wrangler\" (
  echo Removing stale Wrangler cache from site...
  rmdir /S /Q "%SITE_DIR%\.wrangler" >nul 2>&1
  if exist "%SITE_DIR%\.wrangler\" (
    echo ERROR: could not remove site\.wrangler.
    echo Close any Wrangler process using it and try again.
    pause
    exit /b 2
  )
)

rem Windows may create Thumbs.db automatically. It is not part of the website.
for /R "%SITE_DIR%" %%F in (Thumbs.db) do if exist "%%F" del /Q "%%F" >nul 2>&1

rem Safety guard: the public static site must not contain raw data, databases,
rem backups, private keys, archives, environment files or deployment internals.
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

if exist "%SITE_DIR%\functions\" (
  echo BLOCKED: %CD%\%SITE_DIR%\functions
  set "FOUND_BLOCKED_FILE=1"
)
if exist "%SITE_DIR%\data\" (
  echo BLOCKED: %CD%\%SITE_DIR%\data
  set "FOUND_BLOCKED_FILE=1"
)
if exist "%SITE_DIR%\backups\" (
  echo BLOCKED: %CD%\%SITE_DIR%\backups
  set "FOUND_BLOCKED_FILE=1"
)
if exist "%SITE_DIR%\.git\" (
  echo BLOCKED: %CD%\%SITE_DIR%\.git
  set "FOUND_BLOCKED_FILE=1"
)
if exist "%SITE_DIR%\node_modules\" (
  echo BLOCKED: %CD%\%SITE_DIR%\node_modules
  set "FOUND_BLOCKED_FILE=1"
)
if exist "%SITE_DIR%\_worker.js" (
  echo BLOCKED: %CD%\%SITE_DIR%\_worker.js
  set "FOUND_BLOCKED_FILE=1"
)
if exist "%SITE_DIR%\_routes.json" (
  echo BLOCKED: %CD%\%SITE_DIR%\_routes.json
  set "FOUND_BLOCKED_FILE=1"
)
if exist "%SITE_DIR%\wrangler.toml" (
  echo BLOCKED: %CD%\%SITE_DIR%\wrangler.toml
  set "FOUND_BLOCKED_FILE=1"
)
if exist "%SITE_DIR%\wrangler.json" (
  echo BLOCKED: %CD%\%SITE_DIR%\wrangler.json
  set "FOUND_BLOCKED_FILE=1"
)
if exist "%SITE_DIR%\wrangler.jsonc" (
  echo BLOCKED: %CD%\%SITE_DIR%\wrangler.jsonc
  set "FOUND_BLOCKED_FILE=1"
)

if defined FOUND_BLOCKED_FILE (
  echo.
  echo Deployment stopped: a potentially sensitive or unexpected file exists inside site.
  echo Remove or review the blocked item before publishing.
  pause
  exit /b 2
)

echo.
echo Deploying ONLY the site directory to Cloudflare Pages.
echo Project root:
echo   %CD%
echo Static directory:
echo   %CD%\%SITE_DIR%
echo Project:
echo   %PROJECT_NAME%
echo.
echo Running the same known-good command:
echo   npx wrangler pages deploy site --project-name=bargig-orders
echo.

rem IMPORTANT: Run from the project root and do not force --branch.
rem This is intentionally the exact command that is known to create the Production deployment.
call npx wrangler pages deploy site --project-name=bargig-orders
set "DEPLOY_EXIT=%ERRORLEVEL%"

if not "%DEPLOY_EXIT%"=="0" (
  echo.
  echo Deployment failed. Wrangler exit code: %DEPLOY_EXIT%
  pause
  exit /b %DEPLOY_EXIT%
)

echo.
echo Deployment command completed successfully.
echo Production URL:
echo   https://%PROJECT_NAME%.pages.dev/
echo.
echo If Wrangler printed a deployment URL above, that is the deployment just created.
pause
exit /b 0
