@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "EXE="
set "PS1="

for %%F in ("%SCRIPT_DIR%LEON*.exe") do (
    set "EXE=%%~fF"
    goto :found_exe
)

:found_exe
if defined EXE (
    start "" /wait "%EXE%"
    exit /b %ERRORLEVEL%
)

for %%F in ("%SCRIPT_DIR%LEON*.ps1") do (
    set "PS1=%%~fF"
    goto :found_ps1
)

:found_ps1
if not defined PS1 (
    echo [ERROR] Launcher files are missing.
    echo Folder: %SCRIPT_DIR%
    pause
    exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%"
if errorlevel 1 (
    echo.
    echo [ERROR] Launcher exited with an error.
    pause
)
