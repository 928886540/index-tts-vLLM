@echo off
if /i "%LEON_ENABLE_MSVC%"=="0" goto :disabled
if /i "%LEON_ENABLE_MSVC%"=="false" goto :disabled
if /i "%LEON_ENABLE_MSVC%"=="no" goto :disabled
if /i "%LEON_ENABLE_MSVC%"=="off" goto :disabled

set "VS_PATH="
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if not exist "%VSWHERE%" goto :fallback_vs
for /f "usebackq tokens=* delims=" %%I in (`"%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2^>nul`) do if not defined VS_PATH set "VS_PATH=%%I"

:fallback_vs
if not defined VS_PATH call :try_vs "%ProgramFiles%\Microsoft Visual Studio\2022\Community"
if not defined VS_PATH call :try_vs "%ProgramFiles%\Microsoft Visual Studio\2022\BuildTools"
if not defined VS_PATH call :try_vs "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\Community"
if not defined VS_PATH call :try_vs "%ProgramFiles(x86)%\Microsoft Visual Studio\2022\BuildTools"

if not defined VS_PATH (
    echo [WARNING] MSVC NOT FOUND
    goto :eof
)

set "VSDEVCMD=%VS_PATH%\Common7\Tools\VsDevCmd.bat"
if not exist "%VSDEVCMD%" goto :manual_msvc_bin
call "%VSDEVCMD%" -arch=x64 -host_arch=x64 >nul
echo MSVC ENV: %VS_PATH%
goto :eof

:manual_msvc_bin
set "MSVC_BIN="
for /f "delims=" %%I in ('dir /b /ad /o-n "%VS_PATH%\VC\Tools\MSVC" 2^>nul') do (
    if not defined MSVC_BIN if exist "%VS_PATH%\VC\Tools\MSVC\%%I\bin\Hostx64\x64\cl.exe" set "MSVC_BIN=%VS_PATH%\VC\Tools\MSVC\%%I\bin\Hostx64\x64"
)

if defined MSVC_BIN (
    set "PATH=%PATH%;%MSVC_BIN%"
    echo MSVC BIN: %MSVC_BIN%
    goto :eof
)

echo [WARNING] MSVC install found but x64 compiler was not detected.
goto :eof

:disabled
echo MSVC ENV: disabled
goto :eof

:try_vs
if not defined VS_PATH if exist "%~1\VC\Tools\MSVC" set "VS_PATH=%~1"
goto :eof
