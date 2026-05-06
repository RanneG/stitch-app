@echo off
setlocal
cd /d "%~dp0"
title Stitch Desktop (stitch-app)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Start-Stitch.ps1" -Mode TauriDev %*
if errorlevel 1 pause
