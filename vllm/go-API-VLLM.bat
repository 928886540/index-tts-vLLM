@echo off
cd /d "%~dp0"
set SC_PATH=%CD%\indextts2runtime\Scripts
set HF_HOME=%CD%\checkpoints
set PATH=%SC_PATH%;%PATH%
call "%~dp0tools\load_msvc_env.bat"

:run
indextts2runtime\python.exe indextts2_api.py --use_deepspeed --cuda_kernel --fp16
pause
