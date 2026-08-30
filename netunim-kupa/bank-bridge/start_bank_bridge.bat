@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
set "HIDDEN=0"
if /I "%~1"=="--hidden" set "HIDDEN=1"

where node >nul 2>nul || (
  if "%HIDDEN%"=="0" (
    echo ERROR: Node.js was not found. Install Node.js 22.22.2 or newer first.
    pause
  )
  exit /b 1
)

if "%HIDDEN%"=="1" (
  if not exist "%LOCALAPPDATA%\NetunimKupaBankBridge" mkdir "%LOCALAPPDATA%\NetunimKupaBankBridge" >nul 2>nul
  node server.mjs >> "%LOCALAPPDATA%\NetunimKupaBankBridge\bridge.log" 2>&1
  exit /b %ERRORLEVEL%
)

node server.mjs
