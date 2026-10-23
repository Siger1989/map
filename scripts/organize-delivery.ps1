[CmdletBinding()]
param(
    [string]$ProjectRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$DeliveryRoot = ''
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($DeliveryRoot)) {
    $DeliveryRoot = Join-Path $ProjectRoot '交付包\山兔-2026-10-23'
}

$ProjectRoot = [System.IO.Path]::GetFullPath($ProjectRoot)
$DeliveryRoot = [System.IO.Path]::GetFullPath($DeliveryRoot)

$items = @(
    [pscustomobject]@{ Platform='01-Android-APK'; Class='自用版-含个人图源'; Source='APK/Shantu-0.2.131-test-private.apk'; Name='Shantu-0.2.131-test-private.apk'; Sha256='4c66cfbe5d8ad2bb499890ebfeadad45024dc084cfb2a8a270d669d807ba8b03' },
    [pscustomobject]@{ Platform='01-Android-APK'; Class='公开版-不含个人图源'; Source='APK/Shantu-0.2.131-test-public-standalone.apk'; Name='Shantu-0.2.131-test-public-standalone.apk'; Sha256='171636c8d0f03b53c7958b7e68737c04e8e5df403b9828280469ef94810ae03a' },
    [pscustomobject]@{ Platform='02-Windows-EXE'; Class='自用版-含个人图源'; Source='EXE/山兔桌面-0.2.131-private.exe'; Name='Shantu-0.2.131-windows-x64-private.exe'; Sha256='35a2201fc1802160c68ba799f4942a9cd786e638fcffac5a787a0cbc26de681a' },
    [pscustomobject]@{ Platform='02-Windows-EXE'; Class='公开版-不含个人图源'; Source='EXE/山兔桌面-0.2.131-public.exe'; Name='Shantu-0.2.131-windows-x64-public.exe'; Sha256='b83c22fb41b1373cbe248e4cf83b7476bb705552066189f206b8f6e560f75717' },
    [pscustomobject]@{ Platform='03-macOS-DMG'; Class='自用版-含个人图源'; Source='EXE/Shantu-0.2.132-test-macOS-private.dmg'; Name='Shantu-0.2.132-test-macOS-private.dmg'; Sha256=$null },
    [pscustomobject]@{ Platform='03-macOS-DMG'; Class='公开版-不含个人图源'; Source='EXE/Shantu-0.2.132-test-macOS-public.dmg'; Name='Shantu-0.2.132-test-macOS-public.dmg'; Sha256=$null }
)

function Get-Sha256([string]$Path) {
    return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
}

function Get-TextSha256([string]$Text) {
    $bytes = [System.Text.UTF8Encoding]::new($false).GetBytes($Text)
    $sha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([System.BitConverter]::ToString($sha.ComputeHash($bytes))).Replace('-', '').ToLowerInvariant() }
    finally { $sha.Dispose() }
}

function Assert-Dmg([string]$Path) {
    $file = [System.IO.File]::OpenRead($Path)
    try {
        if ($file.Length -lt 512) { throw "DMG 小于 512 字节：$Path" }
        [void]$file.Seek(-512, [System.IO.SeekOrigin]::End)
        $footer = New-Object byte[] 4
        if ($file.Read($footer, 0, 4) -ne 4 -or [System.Text.Encoding]::ASCII.GetString($footer) -cne 'koly') {
            throw "DMG 尾部 512 字节未发现 koly trailer，拒绝整理：$Path"
        }
    }
    finally { $file.Dispose() }

    $sidecarPath = "$Path.sha256"
    if (Test-Path -LiteralPath $sidecarPath -PathType Leaf) {
        $sidecarText = [System.IO.File]::ReadAllText($sidecarPath)
        $match = [regex]::Match($sidecarText, '(?i)(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])')
        if (-not $match.Success) { throw "SHA-256 sidecar 格式无法识别：$sidecarPath" }
        if ($match.Value.ToLowerInvariant() -ne (Get-Sha256 $Path)) {
            throw "DMG SHA-256 与 sidecar 不一致：$sidecarPath"
        }
    }
}

function Assert-NoUnexpectedExistingFile([string]$Path, [string]$ExpectedHash) {
    if (Test-Path -LiteralPath $Path) {
        if ((Get-Item -LiteralPath $Path).PSIsContainer) {
            throw "目标文件路径已被目录占用：$Path"
        }
        $actual = Get-Sha256 $Path
        if ($actual -ne $ExpectedHash) {
            throw "目标已存在且内容不匹配，拒绝覆盖：$Path"
        }
    }
}

# Validate every source before creating or changing the delivery tree.
foreach ($item in $items) {
    $sourcePath = Join-Path $ProjectRoot $item.Source
    if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) {
        throw "缺少必需产物：$($item.Source)。不会用其他格式或版本代替。"
    }
    $actualHash = Get-Sha256 $sourcePath
    if ($item.Sha256 -and $actualHash -ne $item.Sha256) {
        throw "源文件 SHA-256 与发行记录不符：$($item.Source)"
    }
    if ($item.Platform -eq '03-macOS-DMG') {
        Assert-Dmg $sourcePath
    }
    $item.Sha256 = $actualHash
}

# Preflight all destinations and generated root files before copying anything.
$readmePath = Join-Path $DeliveryRoot 'README-交付说明.md'
$manifestPath = Join-Path $DeliveryRoot 'SHA256SUMS-2026-10-23.txt'
$readme = @'
# 山兔交付包（2026-10-23）

本目录按平台和配置分组。`自用版-含个人图源`保留本机个人图源配置，只供用户本人使用；`公开版-不含个人图源`不含个人图源配置，可按公开测试包用途分发。请勿交换两个分类中的文件。

## 版本与文件

| 平台 | 自用版 | 公开版 | 版本说明 |
| --- | --- | --- | --- |
| Android APK | `Shantu-0.2.131-test-private.apk` | `Shantu-0.2.131-test-public-standalone.apk` | 两包均为 0.2.131-test，Android versionCode 138。公开包不含个人图源；自用包含用户已配置图源。 |
| Windows EXE | `Shantu-0.2.131-windows-x64-private.exe` | `Shantu-0.2.131-windows-x64-public.exe` | 两包均为 0.2.131-test。自用包含个人图源；公开包不含。 |
| macOS DMG | `Shantu-0.2.132-test-macOS-private.dmg` | `Shantu-0.2.132-test-macOS-public.dmg` | 两包均为 0.2.132-test。Mac 包比 Android/Windows 新一个版本；DMG 内含 `Shantu.app` 启动器和 Applications 快捷方式，地图仍通过本地浏览器显示，不是原生地图窗口。 |

英文版本化文件名沿用发行产物名称，便于核对发行记录和校验值。

## 安装与首次运行

- **Android：** 将对应 APK 传到手机并打开安装。若系统提示未知来源，按 Android 设置允许该文件管理器安装应用；已有同包名应用应使用同一签名包覆盖安装。公开包和自用包配置不同，切换时请先确认所选分类。
- **Windows：** 运行对应 EXE。需要 WebView2 Runtime；行业 PNG 导出使用系统 Edge 或 Chrome，无需另装 Python 或 Node。首次运行若有 Windows 安全提示，按本机策略确认发布来源后再继续。
- **macOS：** 打开 DMG，将 `Shantu.app` 拖到 Applications，再从 Applications 双击启动。该 `.app` 是启动器；地图仍在浏览器窗口中显示本机服务，不是原生地图窗口。启动后保留打开的 Terminal 服务窗口，关闭该窗口会停止服务。地图数据保存在所用浏览器的本机存储中，复制 DMG 不会迁移数据。Gatekeeper 的实际提示和设备运行状态待主审挂载并运行 DMG 后确认；此整理脚本只检查 DMG trailer 与哈希，不执行挂载或启动。

跨设备前请在应用内导出存档/完整工程并在另一设备导入。浏览器数据不会因复制 DMG 自动迁移。各平台的 GPS、后台记录、触控和系统分享能力按平台实现，不能由本交付清单推断为已在真实设备验收。

## 验证

`SHA256SUMS-2026-10-23.txt`列出本目录全部六个安装产物的 SHA-256。脚本会在复制前校验 0.2.131 源文件哈希及 Mac DMG 尾部 512 字节中的 `koly` trailer；若旁边存在 `.sha256` sidecar，也会比对哈希。复制后再次校验文件哈希。脚本本身不挂载或运行 macOS DMG。源码记录：`docs/release-0.2.131.md`、`docs/release-0.2.132-macos.md`。
'@

if (Test-Path -LiteralPath $DeliveryRoot -PathType Leaf) {
    throw "交付根路径已被普通文件占用：$DeliveryRoot"
}

if (Test-Path -LiteralPath $DeliveryRoot -PathType Container) {
    if (Test-Path -LiteralPath $readmePath -PathType Leaf) {
        if ((Get-Sha256 $readmePath) -ne (Get-TextSha256 $readme)) {
            throw "交付说明已存在且内容不匹配，拒绝覆盖：$readmePath"
        }
    }
}

$manifestLines = @($items | ForEach-Object { "{0}  {1}/{2}/{3}" -f $_.Sha256, $_.Platform, $_.Class, $_.Name })
$manifest = ($manifestLines -join "`r`n") + "`r`n"
if (Test-Path -LiteralPath $manifestPath -PathType Leaf) {
    $existingManifest = [System.IO.File]::ReadAllText($manifestPath)
    if ($existingManifest -cne $manifest) {
        throw "校验清单已存在且内容不匹配，拒绝覆盖：$manifestPath"
    }
}

foreach ($item in $items) {
    $targetDir = Join-Path (Join-Path (Join-Path $DeliveryRoot $item.Platform) $item.Class) ''
    $directoryCursor = $targetDir
    while ($directoryCursor -and $directoryCursor.StartsWith($DeliveryRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
        if (Test-Path -LiteralPath $directoryCursor -PathType Leaf) {
            throw "目标目录路径已被普通文件占用：$directoryCursor"
        }
        if ($directoryCursor -eq $DeliveryRoot) { break }
        $directoryCursor = Split-Path -Parent $directoryCursor
    }
    $targetPath = Join-Path $targetDir $item.Name
    Assert-NoUnexpectedExistingFile $targetPath $item.Sha256
}

foreach ($item in $items) {
    $sourcePath = Join-Path $ProjectRoot $item.Source
    $targetDir = Join-Path (Join-Path $DeliveryRoot $item.Platform) $item.Class
    New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
    $targetPath = Join-Path $targetDir $item.Name
    if (-not (Test-Path -LiteralPath $targetPath -PathType Leaf)) {
        Copy-Item -LiteralPath $sourcePath -Destination $targetPath
    }
    if ((Get-Sha256 $targetPath) -ne $item.Sha256) {
        throw "复制后 SHA-256 不匹配：$targetPath"
    }
}

New-Item -ItemType Directory -Path $DeliveryRoot -Force | Out-Null
if (-not (Test-Path -LiteralPath $readmePath -PathType Leaf)) {
    [System.IO.File]::WriteAllText($readmePath, $readme, [System.Text.UTF8Encoding]::new($false))
}
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
    [System.IO.File]::WriteAllText($manifestPath, $manifest, [System.Text.UTF8Encoding]::new($false))
}

Write-Output "整理完成：$DeliveryRoot"
Write-Output "六个产物均已按源哈希复制并复核。校验清单：$manifestPath"
