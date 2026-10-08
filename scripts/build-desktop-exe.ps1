param(
  [string]$Python = "",
  [string]$Node = "",
  [switch]$SkipMapBuild
)

$ErrorActionPreference = "Stop"
$project = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$buildRoot = Join-Path $project ".openai\build\desktop-app"
$venv = Join-Path $buildRoot "venv"
$venvPython = Join-Path $venv "Scripts\python.exe"
$pyInstallerDist = Join-Path $buildRoot "dist"
$pyInstallerWork = Join-Path $buildRoot "pyinstaller"
$mapBuilder = Join-Path $project "scripts\build-desktop-map.mjs"
$mapRuntime = Join-Path $project "EXE\山兔桌面\resources\map-runtime"
$finalApp = Join-Path $project "EXE\山兔桌面"

if ([string]::IsNullOrWhiteSpace($Python)) {
  $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
  if ($launcher) {
    $detected = & $launcher.Source -3.12 -c "import sys; print(sys.executable)" 2>$null
    if ($LASTEXITCODE -eq 0 -and $detected) { $Python = $detected.Trim() }
  }
  if ([string]::IsNullOrWhiteSpace($Python)) {
    $pythonCommand = Get-Command python.exe -ErrorAction SilentlyContinue
    if ($pythonCommand) { $Python = $pythonCommand.Source }
  }
}
if (-not $Python -or -not (Test-Path -LiteralPath $Python -PathType Leaf)) {
  throw "未找到Python。请安装Python 3.10+ x64，或使用 -Python 指定python.exe。"
}
$runtime = & $Python -c "import struct,sys; print('%d.%d.%d|%d' % (*sys.version_info[:3], struct.calcsize('P')*8))"
if ($LASTEXITCODE -ne 0 -or -not $runtime) { throw "无法识别Python运行时：$Python" }
$runtimeParts = $runtime.Trim() -split '\|'
if ([version]$runtimeParts[0] -lt [version]'3.10' -or [int]$runtimeParts[1] -ne 64) {
  throw "要求Python 3.10+ x64；当前为 $($runtime.Trim())。请用 -Python 指定解释器。"
}

if ([string]::IsNullOrWhiteSpace($Node)) {
  $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
  if ($nodeCommand) { $Node = $nodeCommand.Source }
}
if (-not $Node -or -not (Test-Path -LiteralPath $Node -PathType Leaf)) {
  throw "未找到Node.js。请安装Node 22.13+ x64，或使用 -Node 指定node.exe。"
}
$nodeVersionText = & $Node -p "process.versions.node"
if ($LASTEXITCODE -ne 0 -or [version]$nodeVersionText -lt [version]'22.13') {
  throw "地图运行包构建要求Node 22.13+；当前为 $nodeVersionText。"
}

New-Item -ItemType Directory -Path $buildRoot,$pyInstallerDist,$pyInstallerWork -Force | Out-Null
$requestedMinor = ($runtimeParts[0] -split '\.')[0..1] -join '.'
if (Test-Path -LiteralPath $venvPython -PathType Leaf) {
  $venvRuntime = & $venvPython -c "import struct,sys; print('%d.%d|%d' % (*sys.version_info[:2], struct.calcsize('P')*8))"
  if ($LASTEXITCODE -ne 0 -or $venvRuntime.Trim() -ne "$requestedMinor|64") {
    $versionTag = ($runtimeParts[0] -split '\.')[0..1] -join ''
    $venv = Join-Path $buildRoot "venv-py$versionTag"
    $venvPython = Join-Path $venv "Scripts\python.exe"
  }
}
if (-not (Test-Path -LiteralPath $venvPython -PathType Leaf)) {
  & $Python -m venv $venv
  if ($LASTEXITCODE -ne 0) { throw "创建本地构建虚拟环境失败 ($LASTEXITCODE)。" }
}
$buildPackages = @(
  "openpyxl==3.1.5",
  "xlrd==2.0.2",
  "pywebview==6.2.1",
  "pyinstaller==6.22.3",
  "Pillow==12.2.0"
)
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "更新pip失败 ($LASTEXITCODE)。" }
& $venvPython -m pip install $buildPackages
if ($LASTEXITCODE -ne 0) { throw "安装桌面构建依赖失败 ($LASTEXITCODE)。" }

$iconSource = Join-Path $project "public\brand\shantu-logo.png"
$iconPath = Join-Path $buildRoot "shantu.ico"
$iconCode = "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGBA').save(sys.argv[2], format='ICO', sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])"
& $venvPython -c $iconCode $iconSource $iconPath
if ($LASTEXITCODE -ne 0) { throw "将原始山兔Logo等比转换为ICO失败 ($LASTEXITCODE)。" }

if (-not $SkipMapBuild) {
  if (-not (Test-Path -LiteralPath $mapBuilder -PathType Leaf)) {
    throw "尚未找到地图构建脚本：$mapBuilder。若要复用已有运行资源，请传入 -SkipMapBuild。"
  }
  & $Node $mapBuilder
  if ($LASTEXITCODE -ne 0) { throw "构建地图运行资源失败 ($LASTEXITCODE)。" }
}
foreach ($required in @("node.exe", "server.mjs", "web\index.html")) {
  if (-not (Test-Path -LiteralPath (Join-Path $mapRuntime $required) -PathType Leaf)) {
    throw "地图运行资源缺失：$(Join-Path $mapRuntime $required)"
  }
}

# PyInstaller writes into .openai first so its collector never touches the Node runtime.
$stagedApp = Join-Path $pyInstallerDist "山兔桌面"
$buildRootFull = [System.IO.Path]::GetFullPath($buildRoot).TrimEnd('\') + '\'
$stagedFull = [System.IO.Path]::GetFullPath($stagedApp)
if (-not $stagedFull.StartsWith($buildRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "构建暂存路径越界：$stagedFull"
}
if (Test-Path -LiteralPath $stagedApp) { Remove-Item -LiteralPath $stagedApp -Recurse -Force }
& $venvPython -m PyInstaller --clean --noconfirm --distpath $pyInstallerDist --workpath $pyInstallerWork (Join-Path $project "desktop-app\desktop.spec")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller构建失败 ($LASTEXITCODE)。" }

New-Item -ItemType Directory -Path $finalApp -Force | Out-Null
$internalSource = Join-Path $stagedApp "_internal"
$internalTarget = Join-Path $finalApp "_internal"
if (-not (Test-Path -LiteralPath $internalSource -PathType Container)) { throw "PyInstaller onedir结果缺少_internal目录。" }
$finalFull = [System.IO.Path]::GetFullPath($finalApp).TrimEnd('\') + '\'
$internalFull = [System.IO.Path]::GetFullPath($internalTarget)
if (-not $internalFull.StartsWith($finalFull, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw "替换Python资源目录的目标路径越界：$internalFull"
}
if (Test-Path -LiteralPath $internalTarget) { Remove-Item -LiteralPath $internalTarget -Recurse -Force }
Copy-Item -LiteralPath $internalSource -Destination $internalTarget -Recurse -Force
Copy-Item -LiteralPath (Join-Path $stagedApp "山兔桌面.exe") -Destination (Join-Path $finalApp "山兔桌面.exe") -Force
if (-not (Test-Path -LiteralPath (Join-Path $finalApp "resources\map-runtime\node.exe") -PathType Leaf)) {
  throw "最终应用目录未保留Node运行时。"
}
& $venvPython -m pip freeze | Set-Content -LiteralPath (Join-Path $buildRoot "build-dependencies.txt") -Encoding utf8
Copy-Item -LiteralPath (Join-Path $project "EXE\README.txt") -Destination (Join-Path $finalApp "README.txt") -Force
Write-Output (Join-Path $finalApp "山兔桌面.exe")
