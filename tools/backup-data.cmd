@echo off
setlocal
rem Back up Classroom Local's private data (data\ and .env) to a dated folder
rem outside the project. Git does NOT back these up.

cd /d "%~dp0.."
set "ROOT=%CD%"

if not exist "%ROOT%\data" (
  echo [!] No data folder found at "%ROOT%\data". Nothing to back up.
  pause
  exit /b 1
)

echo.
echo  Classroom Local - data backup
echo  ------------------------------
echo  Please CLOSE the Classroom server window first,
echo  so no task is writing to data\ during the copy.
echo.
pause

for /f %%i in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmm"') do set "TS=%%i"
set "BASE=%USERPROFILE%\Documents\Classroom-Backups"
set "DEST=%BASE%\classroom-data-%TS%"

echo.
echo  Copying to: %DEST%
echo.
robocopy "%ROOT%\data" "%DEST%\data" /E /COPY:DAT /R:1 /W:1 /NFL /NDL /NP
if errorlevel 8 (
  echo.
  echo [!] Copy failed. The backup is incomplete - check the messages above.
  pause
  exit /b 1
)

if exist "%ROOT%\.env" copy /y "%ROOT%\.env" "%DEST%\.env" >nul

echo.
echo  Done. Backup saved to:
echo    %DEST%
echo  Keep a copy somewhere else too (external drive or private cloud folder).
echo  It contains your API keys and course materials - do not share it.
echo.
pause
