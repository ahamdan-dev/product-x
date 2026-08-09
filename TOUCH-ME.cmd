@echo off
setlocal EnableDelayedExpansion
title Product X - TOUCH-ME Launcher

rem ===========================================================================
rem  TOUCH-ME  -  one file, double-click, runs Product X on any Windows PC.
rem
rem  Contract this file honors:
rem    * FIRST launch on a machine  -> install what is missing (Node LTS, Git).
rem    * EVERY launch after that    -> only CHECK, and update if genuinely stale.
rem    * It must NEVER reinstall on every launch.
rem
rem  How "first launch" is remembered: a stamp file under %LOCALAPPDATA%. It records
rem  the day of the last successful update check. Presence of the stamp is what turns
rem  install mode into check mode, so the expensive path runs exactly once per machine
rem  and the daily check is a version comparison, not a download.
rem
rem  Why .cmd and not .ps1: PowerShell scripts do not run on double-click on a default
rem  Windows box (ExecutionPolicy blocks them, and .ps1 opens in an editor). A .cmd
rem  double-clicks everywhere, and it can invoke PowerShell for the parts that need it.
rem ===========================================================================

cd /d "%~dp0"

set "APP_DIR=%~dp0app"
set "STAMP_DIR=%LOCALAPPDATA%\ProductX"
set "STAMP=%STAMP_DIR%\launcher-state.txt"
set "NODE_MAJOR_MIN=20"

rem  `TOUCH-ME.cmd /check` runs every check and then stops instead of starting the app.
rem  This exists so the launcher itself can be verified — including on a machine that is
rem  about to be used for a demo — without occupying the terminal with a dev server.
set "CHECK_ONLY=0"
if /i "%~1"=="/check" set "CHECK_ONLY=1"

echo.
echo   PRODUCT X
echo   ---------------------------------------------------------------
echo.

if not exist "%STAMP_DIR%" mkdir "%STAMP_DIR%" >nul 2>&1

rem -- Decide mode: first run installs, later runs only verify. -----------------
set "FIRST_RUN=1"
if exist "%STAMP%" set "FIRST_RUN=0"

if "%FIRST_RUN%"=="1" (
  echo   First launch on this PC. Checking prerequisites...
) else (
  echo   Verifying environment...
)
echo.

rem ===========================================================================
rem  Node.js
rem ===========================================================================
set "NODE_OK=0"
set "NODE_VER="
for /f "delims=" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"

if defined NODE_VER (
  rem Strip the leading v, take the major.
  set "NV=!NODE_VER:v=!"
  for /f "tokens=1 delims=." %%a in ("!NV!") do set "NODE_MAJOR=%%a"
  if !NODE_MAJOR! GEQ %NODE_MAJOR_MIN% (
    set "NODE_OK=1"
    echo   [ok]      Node.js !NODE_VER!
  ) else (
    echo   [old]     Node.js !NODE_VER! is below the required v%NODE_MAJOR_MIN%.
  )
) else (
  echo   [missing] Node.js not found.
)

if "!NODE_OK!"=="0" (
  echo.
  echo   Installing the latest Node.js LTS. This happens once.
  echo.
  call :install_pkg "OpenJS.NodeJS.LTS" "Node.js LTS"
  if errorlevel 1 goto :no_node
  call :refresh_path
  set "NODE_VER="
  for /f "delims=" %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
  if not defined NODE_VER goto :reopen_needed
  echo   [ok]      Node.js !NODE_VER! installed.
)

rem ===========================================================================
rem  Git - only needed to pull updates. Absence is not fatal.
rem ===========================================================================
set "GIT_OK=0"
git --version >nul 2>&1 && set "GIT_OK=1"

if "!GIT_OK!"=="1" (
  for /f "tokens=3" %%g in ('git --version 2^>nul') do echo   [ok]      Git %%g
) else (
  if "%FIRST_RUN%"=="1" (
    echo   [missing] Git not found - installing so updates can be pulled.
    call :install_pkg "Git.Git" "Git"
    call :refresh_path
    git --version >nul 2>&1 && set "GIT_OK=1"
  ) else (
    echo   [skip]    Git not installed - update checks disabled.
  )
)

rem ===========================================================================
rem  Daily update check. Once per calendar day, never on every launch.
rem ===========================================================================
for /f "delims=" %%d in ('powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd"') do set "TODAY=%%d"
set "LAST_CHECK="
if exist "%STAMP%" (
  for /f "usebackq tokens=1,2 delims==" %%a in ("%STAMP%") do (
    if "%%a"=="lastCheck" set "LAST_CHECK=%%b"
  )
)

if "!LAST_CHECK!"=="!TODAY!" (
  echo   [ok]      Already checked for updates today.
) else (
  if "!GIT_OK!"=="1" (
    if exist "%~dp0.git" (
      echo   Checking for updates...
      git -C "%~dp0" remote update --prune >nul 2>&1
      for /f %%c in ('git -C "%~dp0" rev-list HEAD..@{upstream} --count 2^>nul') do set "BEHIND=%%c"
      if not defined BEHIND set "BEHIND=0"
      if !BEHIND! GTR 0 (
        echo   !BEHIND! update^(s^) available. Applying...
        rem Only fast-forward. A merge or rebase here could conflict with local edits and
        rem leave a demo machine in a broken state; refusing is safer than guessing.
        git -C "%~dp0" merge --ff-only @{upstream} >nul 2>&1
        if errorlevel 1 (
          echo   [warn]    Local changes present - skipped auto-update to avoid a conflict.
        ) else (
          echo   [ok]      Updated to the latest version.
          set "DEPS_DIRTY=1"
        )
      ) else (
        echo   [ok]      Up to date.
      )
    ) else (
      echo   [skip]    Not a git checkout - nothing to update.
    )
  )
)

rem ===========================================================================
rem  Dependencies. Installed when absent or when a pull changed the lockfile.
rem ===========================================================================
if not exist "%APP_DIR%\package.json" goto :no_app

set "NEED_INSTALL=0"
if not exist "%APP_DIR%\node_modules" set "NEED_INSTALL=1"
if "!DEPS_DIRTY!"=="1" set "NEED_INSTALL=1"

rem  Has the lockfile changed since WE last installed?
rem
rem  The obvious test — compare package-lock.json's timestamp against node_modules' — is wrong:
rem  npm does not reliably bump the directory's mtime, so a healthy install reads as stale and
rem  reinstalls on every launch. That is precisely the behaviour this launcher must never have.
rem  Instead, record the lockfile's own timestamp in our stamp file at install time and compare
rem  against that. It only changes when the lockfile actually changes.
set "LOCK_NOW="
if exist "%APP_DIR%\package-lock.json" (
  for /f "delims=" %%t in ('powershell -NoProfile -Command "(Get-Item '%APP_DIR%\package-lock.json').LastWriteTimeUtc.ToString('o')"') do set "LOCK_NOW=%%t"
)
set "LOCK_WAS="
if exist "%STAMP%" (
  for /f "usebackq tokens=1,* delims==" %%a in ("%STAMP%") do (
    if "%%a"=="lock" set "LOCK_WAS=%%b"
  )
)
if defined LOCK_NOW (
  if not "!LOCK_NOW!"=="!LOCK_WAS!" (
    if exist "%APP_DIR%\node_modules" echo   [note]    Lockfile changed since the last install.
    set "NEED_INSTALL=1"
  )
)

if "!NEED_INSTALL!"=="1" (
  echo.
  echo   Installing dependencies...
  pushd "%APP_DIR%"
  set "DEP_RC=0"
  if exist package-lock.json (
    call npm ci --no-audit --no-fund
    rem Capture the code immediately: the next command overwrites errorlevel, and `popd`
    rem succeeding is what silently turned a failed install into "Dependencies ready".
    if errorlevel 1 (
      echo   [warn]    npm ci failed - retrying with npm install.
      call npm install --no-audit --no-fund
      if errorlevel 1 set "DEP_RC=1"
    )
  ) else (
    call npm install --no-audit --no-fund
    if errorlevel 1 set "DEP_RC=1"
  )
  popd
  if "!DEP_RC!"=="1" goto :dep_fail
  echo   [ok]      Dependencies ready.
) else (
  echo   [ok]      Dependencies already installed.
)

rem -- Record a successful pass. This is what stops the install path re-running. --
rem  Written only after deps really succeeded, so a failed install cannot mark the machine
rem  as provisioned and skip the fix on the next launch.
> "%STAMP%" echo lastCheck=!TODAY!
>>"%STAMP%" echo installed=1
if defined LOCK_NOW >>"%STAMP%" echo lock=!LOCK_NOW!

rem ===========================================================================
rem  Launch
rem ===========================================================================
if "%CHECK_ONLY%"=="1" (
  echo.
  echo   [ok]      All checks passed. /check was requested, so not starting the app.
  exit /b 0
)

echo.
echo   ---------------------------------------------------------------
echo   Starting Product X...
echo   Close this window to stop the app.
echo   ---------------------------------------------------------------
echo.

pushd "%APP_DIR%"
call npm run dev
popd
goto :done

rem ===========================================================================
rem  Helpers
rem ===========================================================================

:install_pkg
rem  %1 = winget id, %2 = friendly name. Falls back to a direct download when winget
rem  is absent (Windows Server, stripped images, older Windows 10 builds).
where winget >nul 2>&1
if not errorlevel 1 (
  winget install --id %~1 -e --source winget --accept-source-agreements --accept-package-agreements --disable-interactivity
  if not errorlevel 1 exit /b 0
  echo   [warn]    winget could not install %~2.
)
if /i "%~1"=="OpenJS.NodeJS.LTS" (
  echo   Falling back to a direct download of the Node.js LTS MSI...
  powershell -NoProfile -ExecutionPolicy Bypass -Command ^
    "$ErrorActionPreference='Stop';" ^
    "$idx=Invoke-RestMethod https://nodejs.org/dist/index.json;" ^
    "$lts=($idx ^| Where-Object { $_.lts } ^| Select-Object -First 1).version;" ^
    "$arch=if([Environment]::Is64BitOperatingSystem){'x64'}else{'x86'};" ^
    "$msi=\"$env:TEMP\node-$lts-$arch.msi\";" ^
    "Write-Host \"   Downloading Node $lts ($arch)...\";" ^
    "Invoke-WebRequest \"https://nodejs.org/dist/$lts/node-$lts-$arch.msi\" -OutFile $msi;" ^
    "Write-Host '   Installing (a UAC prompt may appear)...';" ^
    "Start-Process msiexec.exe -ArgumentList '/i',\"`\"$msi`\"\",'/qb','/norestart' -Wait"
  if not errorlevel 1 exit /b 0
)
exit /b 1

:refresh_path
rem A fresh install writes PATH to the registry, but this already-running shell holds a
rem stale copy. Rebuild it from the registry so `node` resolves without reopening.
for /f "usebackq tokens=2,*" %%a in (`reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul`) do set "SYS_PATH=%%b"
for /f "usebackq tokens=2,*" %%a in (`reg query "HKCU\Environment" /v Path 2^>nul`) do set "USR_PATH=%%b"
set "PATH=%SYS_PATH%;%USR_PATH%"
exit /b 0

:no_node
echo.
echo   Could not install Node.js automatically.
echo   Install the LTS from https://nodejs.org  then double-click TOUCH-ME again.
goto :fail

:reopen_needed
echo.
echo   Node.js was installed, but this window still has the old environment.
echo   Close this window and double-click TOUCH-ME once more. It will not reinstall.
> "%STAMP%" echo lastCheck=!TODAY!
>>"%STAMP%" echo installed=1
goto :fail

:no_app
echo.
echo   Could not find "app\package.json" next to this launcher.
echo   Keep TOUCH-ME.cmd in the project root.
goto :fail

:dep_fail
echo.
echo   Dependency install failed. Scroll up for the npm error.
goto :fail

:fail
echo.
pause
exit /b 1

:done
echo.
echo   Product X stopped.
pause
exit /b 0
