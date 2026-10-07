@echo off
setlocal
cd /d "%~dp0"
"C:\Users\sigeryang\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" launch.py
if errorlevel 1 pause
endlocal
