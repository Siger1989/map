param(
  [string]$SdkRoot = 'D:\GodotAndroid\sdk',
  [string]$JdkRoot = 'D:\GodotAndroid\jdk-17-portable\jdk-17.0.19+10',
  [switch]$SkipWebBuild
)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$androidRoot = Join-Path $projectRoot 'mobile\android'
$webRoot = Join-Path $projectRoot 'mobile\dist'
$buildRoot = Join-Path $projectRoot 'mobile\.build'
$stage = Join-Path $buildRoot ('apk-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$outputRoot = Join-Path $projectRoot 'APK'
$toolRoot = Join-Path $SdkRoot 'build-tools\35.0.0'
$platformJar = Join-Path $SdkRoot 'platforms\android-35\android.jar'
$javaExe = Join-Path $JdkRoot 'bin\java.exe'
$javacExe = Join-Path $JdkRoot 'bin\javac.exe'
$jarExe = Join-Path $JdkRoot 'bin\jar.exe'
$keytoolExe = Join-Path $JdkRoot 'bin\keytool.exe'
foreach ($tool in @($javaExe, $javacExe, $jarExe, $keytoolExe, $platformJar, (Join-Path $toolRoot 'aapt2.exe'), (Join-Path $toolRoot 'zipalign.exe'))) {
  if (!(Test-Path -LiteralPath $tool)) { throw "Missing build tool: $tool" }
}
function Check-Tool([string]$label) { if ($LASTEXITCODE -ne 0) { throw "$label failed (exit $LASTEXITCODE)" } }
# Android's Windows native tools do not consistently accept non-ASCII absolute paths.
# Relative paths keep the Chinese workspace name out of their command arguments.
function Native-Path([string]$path) {
  if ($path.StartsWith($projectRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { return $path.Substring($projectRoot.Length + 1) }
  return $path
}
Push-Location -LiteralPath $projectRoot
try {
  if (!$SkipWebBuild) { & npm.cmd run build:android:web; Check-Tool 'Web build' }
  if (!(Test-Path -LiteralPath (Join-Path $webRoot 'index.html'))) { throw 'Mobile entry point missing' }
  foreach ($dir in @($stage, $outputRoot, (Join-Path $stage 'classes'), (Join-Path $stage 'dex'), (Join-Path $stage 'generated'), (Join-Path $webRoot 'native'))) {
    New-Item -ItemType Directory -Path $dir -Force | Out-Null
  }
  Copy-Item -LiteralPath (Join-Path $projectRoot 'modules\terrain\ground-coverage.json') -Destination (Join-Path $webRoot 'native\ground-coverage.json')
  $aapt = Join-Path $toolRoot 'aapt2.exe'
  $resources = Join-Path $stage 'resources.zip'
  $baseApk = Join-Path $stage 'base.apk'
  $alignedApk = Join-Path $stage 'aligned.apk'
  & $aapt compile --dir (Native-Path (Join-Path $androidRoot 'res')) -o (Native-Path $resources); Check-Tool 'Resource compilation'
  & $aapt link -o (Native-Path $baseApk) -I $platformJar --manifest (Native-Path (Join-Path $androidRoot 'AndroidManifest.xml')) -A (Native-Path $webRoot) --java (Native-Path (Join-Path $stage 'generated')) --min-sdk-version 26 --target-sdk-version 35 (Native-Path $resources); Check-Tool 'Resource linking'
  # AAPT2 35 on this Windows host emits backslashes in nested asset ZIP names.
  # Android AssetManager resolves POSIX paths; normalize before alignment/signing.
  Add-Type -AssemblyName System.IO.Compression
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $assetArchive = [IO.Compression.ZipFile]::Open($baseApk, [IO.Compression.ZipArchiveMode]::Update)
  try {
    $windowsEntries = @($assetArchive.Entries | Where-Object { $_.FullName.Contains('\') })
    foreach ($entry in $windowsEntries) {
      $normalizedName = $entry.FullName.Replace('\', '/')
      $buffer = New-Object IO.MemoryStream
      $sourceStream = $entry.Open()
      try { $sourceStream.CopyTo($buffer) } finally { $sourceStream.Dispose() }
      $entry.Delete()
      $replacement = $assetArchive.CreateEntry($normalizedName, [IO.Compression.CompressionLevel]::Optimal)
      $targetStream = $replacement.Open()
      try { $buffer.Position = 0; $buffer.CopyTo($targetStream) } finally { $targetStream.Dispose(); $buffer.Dispose() }
    }
  } finally { $assetArchive.Dispose() }
  $javaSources = @(Get-ChildItem -LiteralPath (Join-Path $androidRoot 'src') -Filter '*.java' -Recurse | ForEach-Object { $_.FullName })
  & $javacExe --release 8 -encoding UTF-8 -classpath $platformJar -d (Join-Path $stage 'classes') @javaSources; Check-Tool 'Java compilation'
  $classes = @(Get-ChildItem -LiteralPath (Join-Path $stage 'classes') -Filter '*.class' -Recurse | ForEach-Object { $_.FullName })
  & $javaExe -cp (Join-Path $toolRoot 'lib\d8.jar') com.android.tools.r8.D8 --lib $platformJar --min-api 26 --output (Join-Path $stage 'dex') @classes; Check-Tool 'DEX compilation'
  & $jarExe uf $baseApk -C (Join-Path $stage 'dex') classes.dex; Check-Tool 'DEX packaging'
  & (Join-Path $toolRoot 'zipalign.exe') -p -f 4 (Native-Path $baseApk) (Native-Path $alignedApk); Check-Tool 'APK alignment'

  # A project-local test certificate, separate from any existing game or release keys.
  $keyStore = Join-Path $buildRoot 'guanyun-test.jks'
  if (!(Test-Path -LiteralPath $keyStore)) {
    & $keytoolExe -genkeypair -keystore $keyStore -storepass android -keypass android -alias guanyun-test -keyalg RSA -keysize 2048 -validity 10000 -dname 'CN=Guanyun Local Test' -noprompt
    Check-Tool 'Test signing key'
  }
  [xml]$manifest = Get-Content -LiteralPath (Join-Path $androidRoot 'AndroidManifest.xml') -Raw -Encoding UTF8
  $versionName = $manifest.manifest.GetAttribute('versionName', 'http://schemas.android.com/apk/res/android')
  if ($versionName -notmatch '^[0-9A-Za-z.-]+$') { throw 'Invalid APK version name' }
  $apkName = "Guanyun-$versionName.apk"
  $apk = Join-Path $outputRoot $apkName
  $signer = Join-Path $toolRoot 'lib\apksigner.jar'
  & $javaExe -jar $signer sign --ks $keyStore --ks-key-alias guanyun-test --ks-pass pass:android --key-pass pass:android --out $apk $alignedApk; Check-Tool 'APK signing'
  & $javaExe -jar $signer verify --verbose --print-certs $apk; Check-Tool 'Signature verification'
  & $aapt dump badging (Native-Path $apk); Check-Tool 'Manifest verification'

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $archive = [IO.Compression.ZipFile]::OpenRead($apk)
  try {
    $names = @($archive.Entries | ForEach-Object { $_.FullName })
    if (@($names | Where-Object { $_.Contains('\') }).Count) { throw 'Non-portable APK asset names' }
    foreach ($required in @('AndroidManifest.xml', 'classes.dex', 'assets/index.html', 'assets/native/ground-coverage.json', 'assets/vendor/maplibre/maplibre-gl-worker.mjs')) {
      if ($names -notcontains $required) { throw "APK missing required file: $required" }
    }
    $tileCount = @($names | Where-Object { $_ -match '^assets/terrain/fabdem-v1-2/.+\.png$' }).Count
    if ($tileCount -ne 473) { throw "Terrain tile count mismatch: $tileCount" }
    if (@($names | Where-Object { $_ -match '(^|/)\.env|\.jks$|\.keystore$|node_modules/|\.openai/' }).Count) { throw 'Private build files found in APK' }
    Write-Output "Bundled terrain tiles verified: $tileCount"
  } finally { $archive.Dispose() }
  $hashAlgorithm = [Security.Cryptography.SHA256]::Create()
  $apkStream = [IO.File]::OpenRead($apk)
  try { $digest = [BitConverter]::ToString($hashAlgorithm.ComputeHash($apkStream)).Replace('-', '') }
  finally { $apkStream.Dispose(); $hashAlgorithm.Dispose() }
  [IO.File]::WriteAllText((Join-Path $outputRoot "Guanyun-$versionName.sha256"), "$digest  $apkName`n", (New-Object System.Text.UTF8Encoding($false)))
  Write-Output "APK: $apk"
  Write-Output "Bytes: $((Get-Item -LiteralPath $apk).Length)"
} finally { Pop-Location }
