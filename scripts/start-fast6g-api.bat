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
  if not defined LEON_LAUNCHER_NO_PAUSE pause
  exit /b 1
)
set "QWEN_ARG=--no_qwen_emo"
if "%LEON_ENABLE_QWEN_EMO%"=="1" set "QWEN_ARG=--qwen_emo"
"%LEON_VERSION_ROOT%\indextts2runtime\python.exe" "%LEON_VERSION_ROOT%\indextts2_api.py" -a 0.0.0.0 -p 9880 --fp16 %QWEN_ARG%
if not defined LEON_LAUNCHER_NO_PAUSE pause
