@echo off
setlocal
call "%~dp0scripts\run-windows.cmd" %*
exit /b %ERRORLEVEL%

