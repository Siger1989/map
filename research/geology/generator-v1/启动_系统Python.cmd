@echo off
setlocal
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 goto use_python
py -3 -c "import openpyxl, xlrd" >nul 2>nul
if errorlevel 1 goto missing_deps
py -3 launch.py
goto end
:use_python
python -c "import openpyxl, xlrd" >nul 2>nul
if errorlevel 1 goto missing_deps
python launch.py
goto end
:missing_deps
echo Missing dependencies. Install with: py -3 -m pip install openpyxl xlrd
exit /b 2
:end
exit /b %errorlevel%
