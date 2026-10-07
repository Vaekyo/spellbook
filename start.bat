@echo off
title Spellbook
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js belum terinstall. Download di https://nodejs.org & pause & exit /b)
if not exist node_modules (echo Installing... & call npm install --omit=dev)
node server.js
pause
