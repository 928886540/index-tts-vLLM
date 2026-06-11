@echo off
chcp 65001 >nul
setlocal
set "LEON_ROOT=%~dp0.."
for %%I in ("%LEON_ROOT%") do set "LEON_ROOT=%%~fI"
set "LEON_STATIC_DIR=%LEON_ROOT%\static"
set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"
cd /d "%LEON_ROOT%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LEON_ROOT%\scripts\restart-leon-api.ps1" -Version vllm -Port 9880 -HostAddress 0.0.0.0 -LeonRoot "%LEON_ROOT%"
if not defined LEON_LAUNCHER_NO_PAUSE pause
