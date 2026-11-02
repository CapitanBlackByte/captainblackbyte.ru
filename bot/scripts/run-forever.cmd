@echo off
cd /d "%~dp0.."
if not exist data mkdir data
:loop
node src\index.js >> data\bot.log 2>&1
ping -n 11 127.0.0.1 >nul
goto loop
