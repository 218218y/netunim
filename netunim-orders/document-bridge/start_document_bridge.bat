@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "APPROOT=%LOCALAPPDATA%\NetunimDocumentBridge"
if not exist "%APPROOT%" mkdir "%APPROOT%" >nul 2>nul
cd /d "%APPROOT%"
node "%~dp0server.mjs" >> "%APPROOT%\bridge-console.log" 2>&1
