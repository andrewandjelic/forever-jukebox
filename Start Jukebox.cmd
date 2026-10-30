@echo off
rem Double-click to start Forever Jukebox on Windows (see "Get started" in README.md).
title Forever Jukebox
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-jukebox.ps1" %*
if errorlevel 1 pause
