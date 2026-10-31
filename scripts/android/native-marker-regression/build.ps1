param(
    [string]$JdkRoot = 'D:\GodotAndroid\jdk-17-portable\jdk-17.0.19+10',
    [string]$SdkRoot = 'D:\GodotAndroid\sdk',
    [string]$ProjectRoot = ''
)
$ErrorActionPreference = 'Stop'

$jdk = (Resolve-Path -LiteralPath $JdkRoot).Path
$sdk = (Resolve-Path -LiteralPath $SdkRoot).Path
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
    $projectCandidate = Get-Item -LiteralPath $PSScriptRoot
    while ($projectCandidate -and -not (Test-Path -LiteralPath (Join-Path $projectCandidate.FullName 'mobile-native'))) {
        $projectCandidate = $projectCandidate.Parent
    }
    if (-not $projectCandidate) { throw 'Cannot locate the project root; pass -ProjectRoot explicitly.' }
    $project = $projectCandidate.FullName
} else {
    $project = (Resolve-Path -LiteralPath $ProjectRoot).Path
}
$helperRoot = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$androidJar = Join-Path $sdk 'platforms\android-35\android.jar'
$buildTools = Join-Path $sdk 'build-tools\35.0.0'
$keyStore = Join-Path $project 'mobile\.build\guanyun-test.jks'
$aapt = Join-Path $buildTools 'aapt.exe'
$d8 = Join-Path $buildTools 'd8.bat'
$zipalign = Join-Path $buildTools 'zipalign.exe'
$apksigner = Join-Path $buildTools 'apksigner.bat'
$jar = Join-Path $jdk 'bin\jar.exe'
$javac = Join-Path $jdk 'bin\javac.exe'

foreach ($path in @($androidJar, $keyStore, $aapt, $d8, $zipalign, $apksigner, $jar, $javac)) {
    if (-not (Test-Path -LiteralPath $path)) { throw "Required tool or signing file missing: $path" }
}

$buildRoot = Join-Path $helperRoot ("build-" + [guid]::NewGuid().ToString('N'))
$classes = Join-Path $buildRoot 'classes'
$dex = Join-Path $buildRoot 'dex'
New-Item -ItemType Directory -Force -Path $classes, $dex | Out-Null

$env:JAVA_HOME = $jdk
$env:PATH = "$jdk\bin;$env:PATH"
& $javac -encoding UTF-8 -source 8 -target 8 -classpath $androidJar -d $classes (Join-Path $helperRoot 'src\com\shantu\qa149\Native149Instrumentation.java')
if ($LASTEXITCODE -ne 0) { throw 'javac failed' }

$classFiles = @(Get-ChildItem -LiteralPath $classes -Recurse -Filter '*.class' | ForEach-Object { $_.FullName })
& $d8 --min-api 23 --lib $androidJar --output $dex @classFiles
if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }

$baseApk = Join-Path $buildRoot 'base.apk'
$alignedApk = Join-Path $buildRoot 'aligned.apk'
$signedApk = Join-Path $buildRoot 'Native149Instrumentation.apk'
& $aapt package -f -M (Join-Path $helperRoot 'AndroidManifest.xml') -I $androidJar -F $baseApk
if ($LASTEXITCODE -ne 0) { throw 'aapt failed' }
& $jar uf $baseApk -C $dex 'classes.dex'
if ($LASTEXITCODE -ne 0) { throw 'adding classes.dex failed' }
& $zipalign -f -p 4 $baseApk $alignedApk
if ($LASTEXITCODE -ne 0) { throw 'zipalign failed' }

if (-not $env:QA149_KEYSTORE_PASSWORD) { throw 'Provide the existing signing password through QA149_KEYSTORE_PASSWORD' }
try {
    & $apksigner sign --ks $keyStore --ks-key-alias guanyun-test `
        --ks-pass 'env:QA149_KEYSTORE_PASSWORD' --key-pass 'env:QA149_KEYSTORE_PASSWORD' `
        --out $signedApk $alignedApk
    if ($LASTEXITCODE -ne 0) { throw 'apksigner failed' }
} finally {
    Remove-Item Env:QA149_KEYSTORE_PASSWORD -ErrorAction SilentlyContinue
}

& $apksigner verify --verbose $signedApk
if ($LASTEXITCODE -ne 0) { throw 'signed instrumentation APK verification failed' }
Get-FileHash -LiteralPath $signedApk -Algorithm SHA256 | Select-Object Algorithm, Hash
Write-Output "INSTRUMENTATION_APK=$signedApk"
