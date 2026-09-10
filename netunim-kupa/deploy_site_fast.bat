@echo off
setlocal EnableExtensions DisableDelayedExpansion
call "%~dp0..\tools\deploy_fast_core.bat" "kupa" "%~1"
set "DEPLOY_EXIT=%ERRORLEVEL%"
if /I not "%~1"=="--preflight-only" pause
exit /b %DEPLOY_EXIT%
