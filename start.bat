@echo off
setlocal enableextensions
title Star Job Search

rem --- Star Job Search launcher -------------------------------------------
rem Starts the desktop (Electron) app in dev mode. On first run it installs
rem dependencies, which takes a few minutes; subsequent launches are quick.
rem ------------------------------------------------------------------------

set "APP_DIR=%~dp0Star Job Search (1)\star-job-search-quasar"

where node >nul 2>nul
if errorlevel 1 (
    echo [Star] Node.js was not found on PATH. Install Node 18+ and try again.
    echo        https://nodejs.org/
    pause
    exit /b 1
)

if not exist "%APP_DIR%\package.json" (
    echo [Star] Could not find the app at:
    echo        "%APP_DIR%"
    pause
    exit /b 1
)

pushd "%APP_DIR%"

if not exist "node_modules" (
    echo [Star] First run - installing dependencies ^(this can take a few minutes^)...
    call npm install
    if errorlevel 1 (
        echo [Star] npm install failed. See the messages above.
        popd
        pause
        exit /b 1
    )
)

echo [Star] Launching the desktop app...
call npm run dev:electron

popd
endlocal
