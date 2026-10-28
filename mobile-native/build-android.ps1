param(
    [string]$JdkRoot = $(if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'D:\GodotAndroid\jdk-17-portable\jdk-17.0.19+10' }),
    [string]$SdkRoot = $(if ($env:ANDROID_HOME) { $env:ANDROID_HOME } elseif ($env:ANDROID_SDK_ROOT) { $env:ANDROID_SDK_ROOT } else { 'D:\GodotAndroid\sdk' }),
    [string]$Task = 'assembleDebug',
    [string]$BuildStage = (Join-Path ([IO.Path]::GetPathRoot($PSScriptRoot)) 'ShantuNativeTools\mobile-native-build')
)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath (Join-Path $JdkRoot 'bin\java.exe'))) { throw 'JDK 17 was not found at JdkRoot.' }
if (-not (Test-Path -LiteralPath (Join-Path $SdkRoot 'platform-tools\adb.exe'))) { throw 'Android SDK was not found at SdkRoot.' }
$env:JAVA_HOME = (Resolve-Path -LiteralPath $JdkRoot).Path
$env:ANDROID_HOME = (Resolve-Path -LiteralPath $SdkRoot).Path
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
Set-Location $PSScriptRoot
& '.\gradlew.bat' $Task "-PbuildStage=$BuildStage" --no-daemon --console=plain
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
