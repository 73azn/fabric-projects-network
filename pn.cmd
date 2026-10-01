@echo off
rem Launcher for Windows cmd.exe: runs pn.ps1 (the only requirement is Docker Desktop)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pn.ps1" %*
exit /b %ERRORLEVEL%
