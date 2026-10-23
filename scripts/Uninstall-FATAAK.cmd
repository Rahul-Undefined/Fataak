@echo off
setlocal
set "DST=%LOCALAPPDATA%\Programs\FATAAK"
taskkill /im FATAAK.exe /f >nul 2>&1
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\FATAAK.lnk" >nul 2>&1
del "%USERPROFILE%\Desktop\FATAAK.lnk" >nul 2>&1
if defined OneDrive del "%OneDrive%\Desktop\FATAAK.lnk" >nul 2>&1
echo FATAAK removed. Your history and settings in "%APPDATA%\FATAAK" were kept; delete that folder to remove them too.
rem this script may live inside %DST%, so delete the folder from a detached process after we exit
start "" /min cmd /c "ping -n 3 127.0.0.1 >nul & rmdir /s /q "%DST%""
endlocal
