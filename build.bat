@echo off
setlocal DisableDelayedExpansion
pushd "%~dp0"
if errorlevel 1 exit /b 1
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 18 or newer is required. Install Node.js LTS and reopen this window.
  set "build_result=1"
  goto finish
)
node "%~dp0scripts\package.mjs" %*
set "build_result=%ERRORLEVEL%"
:finish
popd
if "%~1"=="" if not defined CI pause
exit /b %build_result%
