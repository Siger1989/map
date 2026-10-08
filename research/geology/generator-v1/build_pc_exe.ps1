param(
  [string]$Python = ""
)

$ErrorActionPreference = "Stop"
$project = (Resolve-Path (Join-Path $PSScriptRoot "../../..")).Path
$tool = (Resolve-Path $PSScriptRoot).Path
$buildRoot = Join-Path $project ".openai\build\pc-industry"
$dist = Join-Path $project "output\pc-industry"
$work = Join-Path $buildRoot "pyinstaller"

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
  throw "No Python interpreter was found. Install Python 3.10+ x64 or pass -Python with its executable path."
}
$runtime = & $Python -c "import struct,sys; print('%d.%d.%d|%d' % (*sys.version_info[:3], struct.calcsize('P')*8))"
if ($LASTEXITCODE -ne 0 -or -not $runtime) { throw "Could not inspect Python runtime: $Python" }
$runtimeParts = $runtime.Trim() -split '\|'
if ([version]$runtimeParts[0] -lt [version]'3.10' -or [int]$runtimeParts[1] -ne 64) {
  throw "Python 3.10+ x64 is required; found $($runtime.Trim()). Pass -Python to select a suitable interpreter."
}
$venv = Join-Path $buildRoot "venv"
if (Test-Path -LiteralPath (Join-Path $venv "Scripts\python.exe")) {
  $existingRuntime = & (Join-Path $venv "Scripts\python.exe") -c "import sys; print('%d.%d' % sys.version_info[:2])"
  if ($LASTEXITCODE -ne 0 -or $existingRuntime.Trim() -ne (($runtimeParts[0] -split '\.')[0..1] -join '.')) {
    $versionTag = ($runtimeParts[0] -split '\.')[0..1] -join ''
    $venv = Join-Path $buildRoot "venv-py$versionTag"
  }
}
New-Item -ItemType Directory -Path $buildRoot,$dist -Force | Out-Null
if (-not (Test-Path -LiteralPath (Join-Path $venv "Scripts\python.exe"))) {
  & $Python -m venv $venv
  if ($LASTEXITCODE -ne 0) { throw "Creating the local build environment failed ($LASTEXITCODE)." }
}
$venvPython = Join-Path $venv "Scripts\python.exe"
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Updating pip failed ($LASTEXITCODE)." }
& $venvPython -m pip install -r (Join-Path $tool "requirements-pc-exe.txt")
if ($LASTEXITCODE -ne 0) { throw "Installing the PC tool build dependencies failed ($LASTEXITCODE)." }
$iconSource = Join-Path $project "public\brand\shantu-logo.png"
$iconPath = Join-Path $buildRoot "shantu.ico"
$iconCode = "import sys; from PIL import Image; Image.open(sys.argv[1]).convert('RGBA').save(sys.argv[2], format='ICO', sizes=[(256,256),(128,128),(64,64),(48,48),(32,32),(16,16)])"
& $venvPython -c $iconCode $iconSource $iconPath
if ($LASTEXITCODE -ne 0) { throw "Converting the original Shantu logo to ICO failed ($LASTEXITCODE)." }
& $venvPython -m PyInstaller --clean --noconfirm --distpath $dist --workpath $work (Join-Path $tool "pc-industry.spec")
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed ($LASTEXITCODE)." }
& $venvPython -m pip freeze | Set-Content -LiteralPath (Join-Path $buildRoot "build-dependencies.txt") -Encoding utf8
Write-Output (Join-Path $dist "山兔地质行业工具.exe")
