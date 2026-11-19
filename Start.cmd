@echo off
setlocal
cd /d "%~dp0"
if exist "runtime\node.exe" (
  set "CLASS_NODE=%~dp0runtime\node.exe"
) else (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Please install Node.js 22 or newer from https://nodejs.org and reopen this file.
    pause
    exit /b 1
  )
  set "CLASS_NODE=node"
)
"%CLASS_NODE%" server.mjs --open
if errorlevel 1 pause
