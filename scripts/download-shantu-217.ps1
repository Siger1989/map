[CmdletBinding()]
param(
    [string]$Destination = (Get-Location).Path,
    [string]$PartsDirectory
)

$ErrorActionPreference = 'Stop'
$repository = 'Siger1989/shantu-private-delivery'
$tag = 'v0.2.217-private'
$filename = 'Shantu-0.2.217-oldengine-private.apk'
$expectedHash = '8cca61c208c514532df295c40aaeba32108b2a8676bbb2983b9c5c79b942c187'
$namePattern = [regex]::Escape($filename)
$manifestPattern = "^$namePattern\.parts\.json(?:\.retry[1-9][0-9]*)?$"
$partPattern = "^$namePattern\.part[0-9]{3}(?:\.retry[1-9][0-9]*)?$"
$destinationPath = New-Item -ItemType Directory -Path $Destination -Force
$apk = Join-Path $destinationPath.FullName $filename

if (Test-Path -LiteralPath $apk) {
    if ((Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash -ne $expectedHash) {
        throw "The destination already has a different APK: $apk"
    }
    Write-Output $apk
    return
}

$download = -not $PartsDirectory
if ($download) {
    $assetsJson = gh release view $tag --repo $repository --json assets
    if ($LASTEXITCODE -ne 0) { throw 'Private release unavailable. Sign in with gh auth login and check repository access.' }
    $manifestName = ($assetsJson | ConvertFrom-Json).assets |
        Where-Object { $_.name -match $manifestPattern } | Select-Object -First 1 -ExpandProperty name
    if (-not $manifestName) { throw 'The release has no verified part manifest.' }
    $partsPath = (New-Item -ItemType Directory -Path (Join-Path $destinationPath.FullName 'shantu-217-parts') -Force).FullName
    gh release download $tag --repo $repository --pattern $manifestName --dir $partsPath --skip-existing
    if ($LASTEXITCODE -ne 0) { throw 'Could not download the manifest.' }
    $manifestPath = Join-Path $partsPath $manifestName
} else {
    $partsPath = (Resolve-Path -LiteralPath $PartsDirectory).Path
    $manifestPath = Get-ChildItem -LiteralPath $partsPath -File |
        Where-Object { $_.Name -match $manifestPattern } | Select-Object -First 1 -ExpandProperty FullName
    if (-not $manifestPath) { throw 'No part manifest found in PartsDirectory.' }
}

$manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
if ($manifest.format -ne 1 -or $manifest.filename -cne $filename -or $manifest.sha256 -ne $expectedHash -or
    $manifest.bytes -ne 165949044 -or $manifest.parts.Count -lt 2) { throw 'Unexpected part manifest.' }
$partNames = @($manifest.parts | ForEach-Object { $_.name })
if (($partNames | Sort-Object -Unique).Count -ne $partNames.Count -or
    @($partNames | Where-Object { $_ -notmatch $partPattern }).Count) { throw 'Invalid part names.' }

if ($download) {
    $patterns = foreach ($name in $partNames) { '--pattern'; $name }
    gh release download $tag --repo $repository @patterns --dir $partsPath --skip-existing
    if ($LASTEXITCODE -ne 0) { throw 'Could not download all parts. Re-run the command to resume.' }
}

$pending = Join-Path $destinationPath.FullName ($filename + '.' + [Guid]::NewGuid() + '.pending')
try {
    $output = [IO.File]::Open($pending, [IO.FileMode]::CreateNew)
    try {
        foreach ($entry in $manifest.parts) {
            $file = Get-Item -LiteralPath (Join-Path $partsPath $entry.name)
            if ($file.Length -ne $entry.bytes -or (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash -ne $entry.sha256) {
                throw "Part checksum failed: $($entry.name)"
            }
            $inputStream = [IO.File]::OpenRead($file.FullName)
            try { $inputStream.CopyTo($output) } finally { $inputStream.Dispose() }
        }
    } finally { $output.Dispose() }
    if ((Get-Item -LiteralPath $pending).Length -ne $manifest.bytes -or
        (Get-FileHash -LiteralPath $pending -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Combined APK verification failed.' }
    Move-Item -LiteralPath $pending -Destination $apk
    Write-Output $apk
} finally {
    if (Test-Path -LiteralPath $pending) { Remove-Item -LiteralPath $pending }
}
