@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
set "HIDDEN=0"
if /I "%~1"=="--hidden" set "HIDDEN=1"

set "APPROOT=%LOCALAPPDATA%\NetunimKupaBankBridge"
set "NODERUNTIME="
if not exist "%APPROOT%\node-runtime.txt" exit /b 1
set /p "NODERUNTIME="<"%APPROOT%\node-runtime.txt"
if /I not "%NODERUNTIME:~0,22%"=="node-v24.22.2-win-x64-" exit /b 1
if not "%NODERUNTIME:\=%"=="%NODERUNTIME%" exit /b 1
if not "%NODERUNTIME:/=%"=="%NODERUNTIME%" exit /b 1
if not "%NODERUNTIME:..=%"=="%NODERUNTIME%" exit /b 1
if not exist "%APPROOT%\%NODERUNTIME%\node.exe" exit /b 1
set "NODE=%APPROOT%\%NODERUNTIME%\node.exe"

if "%HIDDEN%"=="1" (
  if not exist "%LOCALAPPDATA%\NetunimKupaBankBridge" mkdir "%LOCALAPPDATA%\NetunimKupaBankBridge" >nul 2>nul
  "%NODE%" server.mjs >> "%LOCALAPPDATA%\NetunimKupaBankBridge\bridge.log" 2>&1
  goto :eof
)

"%NODE%" server.mjs
