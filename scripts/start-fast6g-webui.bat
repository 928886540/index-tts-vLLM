@echo off
setlocal
set "LEON_ROOT=%~dp0.."
for %%I in ("%LEON_ROOT%") do set "LEON_ROOT=%%~fI"
set "LEON_VERSION_ROOT=%LEON_ROOT%\fast6g"
set "LEON_STATIC_DIR=%LEON_ROOT%\static"
set "HF_HOME=%LEON_VERSION_ROOT%\checkpoints"
set "PATH=%LEON_VERSION_ROOT%\indextts2runtime\Scripts;%PATH%"
cd /d "%LEON_VERSION_ROOT%"
if not exist "%LEON_VERSION_ROOT%\indextts2runtime\python.exe" (
  echo Missing runtime: %LEON_VERSION_ROOT%\indextts2runtime\python.exe
  pause
  exit /b 1
)
"%LEON_VERSION_ROOT%\indextts2runtime\python.exe" "%LEON_VERSION_ROOT%\webui.py" --host 127.0.0.1 --fp16
pause
