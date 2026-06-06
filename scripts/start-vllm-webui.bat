@echo off
setlocal
set "LEON_ROOT=%~dp0.."
for %%I in ("%LEON_ROOT%") do set "LEON_ROOT=%%~fI"
set "LEON_VERSION_ROOT=%LEON_ROOT%\vllm"
set "LEON_STATIC_DIR=%LEON_ROOT%\static"
cd /d "%LEON_VERSION_ROOT%"
call "%LEON_VERSION_ROOT%\go-webui-VLLM-NoQwen.bat"
