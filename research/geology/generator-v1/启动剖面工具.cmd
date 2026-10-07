@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if defined GEOLOGY_PYTHON (
  set "PYTHON_BIN=%GEOLOGY_PYTHON%"
) else (
  set "PYTHON_BIN=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
)

if not exist "%PYTHON_BIN%" (
  echo 未找到本工具所需的 bundled Python。
  echo 可设置 GEOLOGY_PYTHON 为明确的 python.exe 路径后重试。
  pause
  exit /b 1
)

"%PYTHON_BIN%" "%~dp0launch.py"
if errorlevel 1 (
  echo.
  echo 启动失败。请按上方提示处理后重试。
  pause
)
endlocal
