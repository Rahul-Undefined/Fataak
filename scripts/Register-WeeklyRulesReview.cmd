@echo off
rem Registers a per-user Windows scheduled task (no admin) that runs the weekly FATAAK rules review every
rem Monday at 09:00 through Claude Code. Run once from this folder. Remove with:
rem   schtasks /delete /tn "FATAAK rules review" /f
setlocal
set "PS1=%~dp0weekly-rules-review.ps1"
schtasks /create /f /sc weekly /d MON /st 09:00 /tn "FATAAK rules review" /tr "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"%PS1%\""
if errorlevel 1 (
  echo Could not register the task.
  exit /b 1
)
echo Registered "FATAAK rules review": every Monday 09:00, logs in %LOCALAPPDATA%\FATAAK-rules-review
echo One-time: run claude.exe, type /login, finish in the browser, then /exit.
endlocal
