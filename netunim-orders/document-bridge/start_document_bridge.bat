@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "APPROOT=%LOCALAPPDATA%\NetunimDocumentBridge"
set "NODEPOINTER=%APPROOT%\node-runtime.txt"
set "NODERUNTIME="
set "NODE_EXE="
if not exist "%APPROOT%" mkdir "%APPROOT%" >nul 2>nul
if not exist "%NODEPOINTER%" (
  >> "%APPROOT%\bridge-console.log" echo ERROR: Private Node runtime pointer is missing. Reinstall Document Bridge.
  exit /b 1
)
set /p "NODERUNTIME="<"%NODEPOINTER%"
if /I not "%NODERUNTIME:~0,22%"=="node-v24.21.0-win-x64-" goto :bad_node
if not "%NODERUNTIME:\=%"=="%NODERUNTIME%" goto :bad_node
if not "%NODERUNTIME:/=%"=="%NODERUNTIME%" goto :bad_node
if not "%NODERUNTIME:..=%"=="%NODERUNTIME%" goto :bad_node
set "NODE_EXE=%APPROOT%\%NODERUNTIME%\node.exe"
if not exist "%NODE_EXE%" goto :bad_node
cd /d "%APPROOT%"
"%NODE_EXE%" "%~dp0server.mjs" >> "%APPROOT%\bridge-console.log" 2>&1
exit /b %ERRORLEVEL%

:bad_node
>> "%APPROOT%\bridge-console.log" echo ERROR: Pinned private Node.js 24.21.0 runtime is invalid or missing. Reinstall Document Bridge.
exit /b 1
