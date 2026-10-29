@echo off
title Nussy EBuLa - Bridge fuer Zusi 3
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js fehlt - bitte von https://nodejs.org installieren & pause & exit /b 1)
node bridge.js %*
pause
