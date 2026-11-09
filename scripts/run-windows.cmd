@echo off
setlocal

cd /d "%~dp0"

where pwsh.exe >nul 2>&1
if %ERRORLEVEL% equ 0 (
    set "PS_CMD=pwsh.exe"
) else (
    set "PS_CMD=powershell.exe"
)

"%PS_CMD%" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-windows.ps1" %*

set "RUNNER_EXIT=%ERRORLEVEL%"

echo.
echo Runner stopped.
pause

exit /b %RUNNER_EXIT%
