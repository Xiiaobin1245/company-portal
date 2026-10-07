@echo off
title Company COA Application Server
cd /d "%~dp0"
rem tells the server that this window restarts it when "Restart server" is pressed in Settings
set COA_LAUNCHER=restart
:start
where python >nul 2>nul
if %errorlevel%==0 (python server.py) else (py server.py)
rem exit code 3 = "Restart server" was pressed in Settings
if %errorlevel%==3 goto start
pause
