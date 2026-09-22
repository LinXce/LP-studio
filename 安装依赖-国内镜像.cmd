@echo off
setlocal EnableExtensions
title LP Studio - Install Dependencies
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
    echo [!] Node.js was not found. Install Node.js with npm first.
    pause
    exit /b 1
)
rem Compact ASCII logo is safe in every Windows console code page.
set "LP_UNICODE=0"
node scripts/install.mjs --source=mirror
set "LP_EXIT_CODE=%errorlevel%"
pause
endlocal & exit /b %LP_EXIT_CODE%
