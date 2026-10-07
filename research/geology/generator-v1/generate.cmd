@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

if "%~1"=="" (
  echo 用法：把已适配的 XLS 或规范 XLSX 拖到 generate.cmd 上。
  echo 也可在命令行运行：generate.cmd 输入文件 [剖面方位角]
  pause
  exit /b 2
)

if defined GEOLOGY_PYTHON (
  set "PYTHON_BIN=%GEOLOGY_PYTHON%"
) else (
  set "PYTHON_BIN=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
)
if not exist "%PYTHON_BIN%" (
  echo 未找到 bundled Python。可设置 GEOLOGY_PYTHON 后重试。
  pause
  exit /b 1
)

set "OUT_DIR=%~dp0generated\manual-%RANDOM%-%RANDOM%"
if "%~2"=="" (
  "%PYTHON_BIN%" "%~dp0pipeline.py" --input "%~1" --output "%OUT_DIR%"
) else (
  "%PYTHON_BIN%" "%~dp0pipeline.py" --input "%~1" --output "%OUT_DIR%" --axis "%~2"
)
if errorlevel 1 (
  echo.
  echo 生成失败，请查看上方结构化错误和 logs 目录。
  pause
  exit /b 1
)
echo.
echo 已生成：%OUT_DIR%
start "" "%OUT_DIR%\report.html"
pause
endlocal
