@echo off
setlocal

cd /d "%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-windows.ps1"

set "RUNNER_EXIT=%ERRORLEVEL%"

echo.
echo Runner stopped.
pause

exit /b %RUNNER_EXIT%