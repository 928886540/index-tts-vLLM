@echo off
setlocal
set "LEON_ROOT=%~dp0.."
for %%I in ("%LEON_ROOT%") do set "LEON_ROOT=%%~fI"
set "LEON_VERSION_ROOT=%LEON_ROOT%\vllm"
set "LEON_STATIC_DIR=%LEON_ROOT%\static"
cd /d "%LEON_VERSION_ROOT%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LEON_VERSION_ROOT%\tools\restart_indextts_api.ps1" -Port 9880 -HostAddress 0.0.0.0 -LeonRoot "%LEON_ROOT%"
if not defined LEON_LAUNCHER_NO_PAUSE pause
