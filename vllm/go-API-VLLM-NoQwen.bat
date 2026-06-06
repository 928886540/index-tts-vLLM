@echo off
set "LEON_ROOT=%~dp0.."
for %%I in ("%LEON_ROOT%") do set "LEON_ROOT=%%~fI"
cd /d "%LEON_ROOT%"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%LEON_ROOT%\vllm\tools\restart_indextts_api.ps1" -Port 9880 -HostAddress 0.0.0.0 -LeonRoot "%LEON_ROOT%"
if not defined LEON_LAUNCHER_NO_PAUSE pause
