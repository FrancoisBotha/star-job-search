@echo off
setlocal enableextensions
title Star Job Search

rem --- Star Job Search launcher (self-healing) ----------------------------
rem Starts the desktop (Electron) app in dev mode. Dependencies are installed
rem or re-synced automatically whenever package.json / package-lock.json
rem changes, and the native better-sqlite3 binary is refreshed to match
rem Electron's ABI (a downloaded prebuilt - no C++ compiler required), so a
rem fresh clone or a newly added dependency "just works".
rem ------------------------------------------------------------------------

set "APP_DIR=%~dp0app"

where node >nul 2>nul
if errorlevel 1 (
    echo [Star] Node.js was not found on PATH. Install Node 18+ and try again.
    echo        https://nodejs.org/
    goto :fail
)

if not exist "%APP_DIR%\package.json" (
    echo [Star] Could not find the app at:
    echo        "%APP_DIR%"
    goto :fail
)

pushd "%APP_DIR%"

rem --- decide whether dependencies need (re)installing --------------------
set "NEED_INSTALL="
if not exist "node_modules" set "NEED_INSTALL=1"
if not exist "node_modules\.package-lock.json" set "NEED_INSTALL=1"

if not defined NEED_INSTALL (
    rem package.json or package-lock.json newer than the last install marker?
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$m=(Get-Item 'node_modules/.package-lock.json').LastWriteTimeUtc; $stale=$false; foreach($f in 'package.json','package-lock.json'){ if((Test-Path $f) -and ((Get-Item $f).LastWriteTimeUtc -gt $m)){ $stale=$true } }; exit ([int]$stale)"
    if errorlevel 1 set "NEED_INSTALL=1"
)

if defined NEED_INSTALL (
    echo [Star] Dependencies are out of date - installing / syncing ^(this can take a few minutes^)...
    call npm install
    if errorlevel 1 (
        echo [Star] npm install failed. See the messages above.
        popd
        goto :fail
    )
    call :rebuild_native
)

echo [Star] Launching the desktop app...
call npm run dev:electron

popd
endlocal
exit /b 0

rem --- refresh native modules to match Electron's ABI (no compiler) --------
:rebuild_native
if not exist "node_modules\better-sqlite3" goto :eof
set "ELECTRON_VER="
for /f "delims=" %%v in ('node -p "require('electron/package.json').version" 2^>nul') do set "ELECTRON_VER=%%v"
if not defined ELECTRON_VER goto :eof
echo [Star] Refreshing native modules for Electron %ELECTRON_VER%...
pushd "node_modules\better-sqlite3"
call npx --yes prebuild-install -r electron -t %ELECTRON_VER%
if errorlevel 1 echo [Star] Could not fetch an Electron prebuilt - database/browser features may not work.
popd
goto :eof

:fail
echo.
pause
exit /b 1
