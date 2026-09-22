@echo off
setlocal EnableExtensions
title LP Studio - Windows Build
cd /d "%~dp0"
rem UTF-8 terminal art; restore the original console code page on exit.
for /f "tokens=2 delims=:" %%C in ('chcp') do set "LP_ORIGINAL_CP=%%C"
chcp 65001 >nul
where node >nul 2>nul
if errorlevel 1 (
    echo [!] Node.js was not found. Install Node.js and run this launcher again.
    set "LP_EXIT_CODE=1"
    goto :finish
)
call npm.cmd --silent run pack:win
set "LP_EXIT_CODE=%errorlevel%"
:finish
if defined LP_ORIGINAL_CP chcp %LP_ORIGINAL_CP% >nul
if not "%LP_EXIT_CODE%"=="0" pause
endlocal & exit /b %LP_EXIT_CODE%
