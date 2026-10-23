@echo off
setlocal
rem FATAAK per-user install: copies this folder to %LOCALAPPDATA%\Programs\FATAAK and creates
rem Start Menu + Desktop shortcuts. No installer executable, no admin rights, no registry changes
rem beyond what Windows does for a shortcut. Safe on managed laptops (Defender for Endpoint / Intune).
set "SRC=%~dp0"
set "DST=%LOCALAPPDATA%\Programs\FATAAK"
echo Installing FATAAK to "%DST%" ...
taskkill /im FATAAK.exe /f >nul 2>&1
robocopy "%SRC%." "%DST%" /E /R:2 /W:2 /NDL /NJH /NJS /NC /NS /NP /NFL
if errorlevel 8 (
  echo Copy failed - close any running FATAAK window and run this again.
  pause
  exit /b 1
)
rem the app writes its own shortcuts (with icon + AppUserModelID, so taskbar pinning shows the FATAAK logo)
"%DST%\FATAAK.exe" --install-shortcuts
if errorlevel 1 echo Warning: could not create shortcuts.
echo Done. Starting FATAAK (Alt+Space shows or hides it).
start "" "%DST%\FATAAK.exe"
endlocal
