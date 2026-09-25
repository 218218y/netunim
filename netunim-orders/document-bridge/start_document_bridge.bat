@echo off
setlocal EnableExtensions DisableDelayedExpansion
cd /d "%~dp0"
set "APPROOT=%LOCALAPPDATA%\NetunimDocumentBridge"
node server.mjs >> "%APPROOT%\bridge-console.log" 2>&1
