@echo off
cd /d "%~dp0"
set SC_PATH=%CD%\indextts2runtime\Scripts
set HF_HOME=%CD%\checkpoints
set PATH=%SC_PATH%;%PATH%
call "%~dp0tools\load_msvc_env.bat"

:run
indextts2runtime\python.exe webui.py --host 127.0.0.1 --fp16 --deepspeed --cuda_kernel
pause
