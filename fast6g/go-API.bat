@echo off
set "LEON_ROOT=%~dp0.."
for %%I in ("%LEON_ROOT%") do set "LEON_ROOT=%%~fI"
call "%LEON_ROOT%\scripts\start-fast6g-api.bat"
