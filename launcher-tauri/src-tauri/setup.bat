@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

echo ========================================
echo   LEON Launcher - Rust Backend Setup
echo ========================================
echo.

REM 检查 Rust 是否安装
where rustc >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Rust is not installed!
    echo.
    echo Please install Rust from: https://rustup.rs/
    echo.
    pause
    exit /b 1
)

echo [OK] Rust is installed
rustc --version
echo.

REM 检查 Cargo
where cargo >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Cargo is not found!
    pause
    exit /b 1
)

echo [OK] Cargo is installed
cargo --version
echo.

REM 进入 src-tauri 目录
cd /d "%~dp0"

echo ========================================
echo   Building Rust Backend...
echo ========================================
echo.

REM 构建项目（检查依赖）
cargo check

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [ERROR] Cargo check failed!
    echo Please fix the errors above.
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Build Successful!
echo ========================================
echo.
echo Next steps:
echo   1. Install Node.js dependencies: npm install
echo   2. Run dev mode: npm run tauri dev
echo   3. Build for production: npm run tauri build
echo.
pause
