@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0installer\setup.ps1" -InstallDir "%~dp0"
