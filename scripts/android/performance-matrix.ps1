param(
    [string]$Adb = 'adb',
    [string]$Serial,
    [string]$Package = 'com.guanyun.weather.shantu.preview',
    [string]$OutputDirectory,
    [string[]]$Scenario = @('all'),
    [string]$FixtureRoot,
    [ValidateRange(0, 3600)][int]$WindowSeconds = 0,
    [switch]$Capture
)

$ErrorActionPreference = 'Stop'
$Scenario = @($Scenario | ForEach-Object { $_ -split ',' } | ForEach-Object { $_.Trim() } | Where-Object { $_ })
$matrix = @(
    [pscustomobject]@{ id='single-2d'; title='单图 2D 稳定浏览'; fixture='single-map-2d'; taskBranch='idle browse'; fixtureGap='无已核验fixture文件；需QA专用单图状态JSON'; input='同一固定视区轻拖 20 秒，停手等待 10 秒'; zoom='固定 z10'; mode='2D'; maps=1 },
    [pscustomobject]@{ id='single-3d'; title='单图 3D 稳定浏览'; fixture='single-map-3d'; taskBranch='idle browse'; fixtureGap='无已核验fixture文件；需QA专用单图状态JSON'; input='同一固定视区轻拖 20 秒，停手等待 10 秒'; zoom='固定 z10、倾角 55°'; mode='3D'; maps=1 },
    [pscustomobject]@{ id='dual-same-2d'; title='同源双图 2D'; fixture='dual-same-source-2d'; taskBranch='comparison browse'; fixtureGap='无已核验fixture文件；需QA专用同源双图状态JSON'; input='主图拖动 20 秒，副图保持同步'; zoom='固定 z10'; mode='2D'; maps=2 },
    [pscustomobject]@{ id='dual-same-3d'; title='同源双图 3D'; fixture='dual-same-source-3d'; taskBranch='comparison browse'; fixtureGap='无已核验fixture文件；需QA专用同源双图状态JSON'; input='主图拖动 20 秒，副图保持同步'; zoom='固定 z10、倾角 55°'; mode='3D'; maps=2 },
    [pscustomobject]@{ id='dual-diff-2d'; title='异源双图 2D'; fixture='dual-different-sources-2d'; taskBranch='comparison browse'; fixtureGap='无已核验fixture文件；需QA专用异源双图状态JSON'; input='主图拖动 20 秒，副图保持同步'; zoom='固定 z10'; mode='2D'; maps=2 },
    [pscustomobject]@{ id='dual-diff-3d'; title='异源双图 3D'; fixture='dual-different-sources-3d'; taskBranch='comparison browse'; fixtureGap='无已核验fixture文件；需QA专用异源双图状态JSON'; input='主图拖动 20 秒，副图保持同步'; zoom='固定 z10、倾角 55°'; mode='3D'; maps=2 },
    [pscustomobject]@{ id='zoom-ladder'; title='逐级缩放'; fixture='zoom-ladder-6-9-12-15'; taskBranch='idle browse at each zoom'; fixtureGap='无已核验fixture文件；需QA专用相机梯级JSON'; input='同一路径依次 z6→9→12→15，每级停留 10 秒，再逐级缩回'; zoom='6/9/12/15'; mode='2D then 3D repeat'; maps=1,2 },
    [pscustomobject]@{ id='drawing-edit'; title='绘制与编辑'; fixture='qa-owned-empty-draft-and-line'; taskBranch='trackOverlay.drawing / trackOverlay.editing'; fixtureGap='无QA空草稿/可编辑线fixture生成器；禁止借用用户草稿'; input='仅在 QA 空草稿中画 20 秒，再拖动一个 QA 节点 10 秒'; zoom='固定 z12'; mode='3D'; maps=1 },
    [pscustomobject]@{ id='navigation-display'; title='路线展示（非导航）'; fixture='qa-synthetic-route-no-guidance'; taskBranch='routeOverlay.route with navigationProgress absent'; fixtureGap='无已核验合成路线fixture；当前场景只测路线展示'; input='显示预置 QA 路线并拖动浏览 20 秒；不启动导航或GPS'; zoom='固定 z12'; mode='3D'; maps=1 },
    [pscustomobject]@{ id='navigation-active'; title='真实导航态分支（QA合成进度）'; fixture='qa-navigation-progress-renderstate'; taskBranch='routeOverlay.route + finite navigationProgress; guiding UI branch'; fixtureGap='无navigationProgress QA fixture/安全初始化器；无GPS输入fixture；仅可测UI/renderState分支，不代表真实定位导航验收'; input='维持导航态QA进度，在固定视区拖动 20 秒；不得启动真实定位'; zoom='固定 z12'; mode='3D'; maps=1; gps='NONE' },
    [pscustomobject]@{ id='recording-active'; title='轨迹记录中实时任务'; fixture='qa-live-recording-phase-recording'; taskBranch='trackOverlay.saved[id=live-recording] + phase=recording'; fixtureGap='无QA recording fixture/无GPS样本注入器；不得启动真实轨迹服务或触碰用户记录'; input='记录中QA renderState下拖动 20 秒；不请求位置权限'; zoom='固定 z12'; mode='3D'; maps=1; gps='NONE' },
    [pscustomobject]@{ id='recording-paused'; title='轨迹记录暂停实时任务'; fixture='qa-live-recording-phase-paused'; taskBranch='trackOverlay.saved[id=live-recording] + phase=paused'; fixtureGap='无QA paused recording fixture；不得改动用户暂停草稿'; input='暂停态QA renderState下拖动 20 秒，不恢复记录'; zoom='固定 z12'; mode='3D'; maps=1; gps='NONE' },
    [pscustomobject]@{ id='measurement-active'; title='测量交互任务'; fixture='qa-measurement-picking'; taskBranch='interaction.measurementPicking'; fixtureGap='无QA测量fixture；不得重用或保存用户测量结果'; input='保持测量工具激活并执行固定测量交互 20 秒'; zoom='固定 z12'; mode='3D'; maps=1 },
    [pscustomobject]@{ id='section-profile-active'; title='剖面采样与曲线展示'; fixture='qa-section-enabled-profile'; taskBranch='renderState.section.enabled + sampled sectionProfile'; fixtureGap='无section/profile QA fixture；需本地QA采样数据，不能假定DEM可用'; input='打开预置剖面并在地图上拖动 20 秒'; zoom='固定 z12'; mode='3D'; maps=1 },
    [pscustomobject]@{ id='dense-markers'; title='密集标记'; fixture='qa-dense-markers-100'; taskBranch='annotation collection'; fixtureGap='无密集标记QA fixture生成器；禁止扩增用户标记'; input='固定密集标记视区拖动 20 秒，之后点选 10 秒'; zoom='固定 z12'; mode='2D then 3D'; maps=1,2 },
    [pscustomobject]@{ id='panels'; title='开关与面板'; fixture='qa-panel-toggle-state'; taskBranch='panel/tool state transitions'; fixtureGap='无已核验panel QA fixture；需要定义不会保存用户设置的临时开关路径'; input='固定节奏开关图层/标记/导航展示面板 30 秒，不改设置后保存'; zoom='固定 z10'; mode='2D'; maps=1 },
    [pscustomobject]@{ id='dual-exit-restore'; title='退出双图并恢复单图'; fixture='dual-exit-restore-start-state'; taskBranch='comparison task exit -> idle browse'; fixtureGap='无已核验双图恢复fixture；需记录进入/退出后的实际renderState'; input='双图拖动 15 秒，退出双图，确认单图恢复后再拖动 15 秒'; zoom='固定 z10'; mode='2D'; maps=2 }
)

function New-OutputPath {
    if ($OutputDirectory) { return [IO.Path]::GetFullPath($OutputDirectory) }
    $repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
    return Join-Path $repo ('.openai\performance-matrix\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
}

function Invoke-AdbReadOnly([string[]]$Arguments, [string]$LogPath, [switch]$AllowFailure) {
    $display = "$Adb -s $Serial " + ($Arguments -join ' ')
    if (-not $Capture) { return [pscustomobject]@{ command=$display; status='DRY_RUN'; log=$LogPath; output='' } }
    $output = & $Adb -s $Serial @Arguments 2>&1
    $exitCode = $LASTEXITCODE
    $text = ($output | Out-String).TrimEnd()
    $text | Out-File -LiteralPath $LogPath -Encoding utf8
    if ($exitCode -ne 0 -and -not $AllowFailure) { throw "adb read-only command failed ($exitCode): $display; see $LogPath" }
    return [pscustomobject]@{ command=$display; status=if ($exitCode -eq 0) { 'CAPTURED' } else { 'UNAVAILABLE' }; exitCode=$exitCode; log=$LogPath; output=$text }
}

function Read-TargetProcessSnapshot([string]$CaseLog, [string]$Label) {
    $pidResult = Invoke-AdbReadOnly @('shell','pidof',$Package) (Join-Path $CaseLog "proc-$Label-pid.log") -AllowFailure
    $script:commands += $pidResult
    $pidToken = $pidResult.output -split '\s+' | Where-Object { $_ -match '^\d+$' } | Select-Object -First 1
    if (-not $pidToken) { return [pscustomobject]@{ status='PID_UNAVAILABLE'; reason='target process not running or pidof denied'; pid=$null; processStartTicks=$null; userCpuTicks=$null; systemCpuTicks=$null; deviceUptimeSeconds=$null } }

    $pidValue = [long]$pidToken
    $statResult = Invoke-AdbReadOnly @('shell','cat',"/proc/$pidValue/stat") (Join-Path $CaseLog "proc-$Label-stat.log") -AllowFailure
    $uptimeResult = Invoke-AdbReadOnly @('shell','cat','/proc/uptime') (Join-Path $CaseLog "proc-$Label-uptime.log") -AllowFailure
    $script:commands += @($statResult, $uptimeResult)

    $statText = $statResult.output.Trim()
    $closeParen = $statText.LastIndexOf(')')
    $tail = if ($closeParen -ge 0 -and $closeParen + 1 -lt $statText.Length) { $statText.Substring($closeParen + 1).Trim() } else { '' }
    $fields = @($tail -split '\s+')
    $uptimeMatch = [regex]::Match($uptimeResult.output, '^\s*(?<seconds>\d+(?:\.\d+)?)')
    $statOk = $statResult.status -eq 'CAPTURED' -and $fields.Count -gt 19
    $uptimeOk = $uptimeResult.status -eq 'CAPTURED' -and $uptimeMatch.Success
    if (-not $statOk) {
        $denied = $statResult.output -match '(?i)permission denied|operation not permitted|access denied'
        return [pscustomobject]@{ status=if ($denied) { 'PROC_STAT_PERMISSION_DENIED' } else { 'PROC_STAT_UNAVAILABLE' }; reason='Android shell could not read target /proc/PID/stat'; pid=$pidValue; processStartTicks=$null; userCpuTicks=$null; systemCpuTicks=$null; deviceUptimeSeconds=if ($uptimeOk) { [double]::Parse($uptimeMatch.Groups['seconds'].Value,[Globalization.CultureInfo]::InvariantCulture) } else { $null } }
    }
    if (-not $uptimeOk) { return [pscustomobject]@{ status='UPTIME_UNAVAILABLE'; reason='Android shell could not read /proc/uptime'; pid=$pidValue; processStartTicks=[long]$fields[19]; userCpuTicks=[long]$fields[11]; systemCpuTicks=[long]$fields[12]; deviceUptimeSeconds=$null } }
    return [pscustomobject]@{ status='CAPTURED'; reason=$null; pid=$pidValue; processStartTicks=[long]$fields[19]; userCpuTicks=[long]$fields[11]; systemCpuTicks=[long]$fields[12]; deviceUptimeSeconds=[double]::Parse($uptimeMatch.Groups['seconds'].Value,[Globalization.CultureInfo]::InvariantCulture) }
}

function Compare-TargetProcessWindow($Before, $After) {
    if ($Before.status -ne 'CAPTURED' -or $After.status -ne 'CAPTURED') { return [pscustomobject]@{ comparable=$false; reason="process/uptime snapshot unavailable: $($Before.status)/$($After.status)" } }
    if ($Before.pid -ne $After.pid -or $Before.processStartTicks -ne $After.processStartTicks) { return [pscustomobject]@{ comparable=$false; reason='target PID changed or process restarted during input window' } }
    $elapsed = $After.deviceUptimeSeconds - $Before.deviceUptimeSeconds
    if ($elapsed -le 0) { return [pscustomobject]@{ comparable=$false; reason='device uptime did not increase' } }
    $userTicks = $After.userCpuTicks - $Before.userCpuTicks
    $systemTicks = $After.systemCpuTicks - $Before.systemCpuTicks
    if ($userTicks -lt 0 -or $systemTicks -lt 0) { return [pscustomobject]@{ comparable=$false; reason='process CPU counters regressed' } }
    return [pscustomobject]@{ comparable=$true; reason=$null; pid=$Before.pid; processStartTicks=$Before.processStartTicks; windowUptimeSeconds=[math]::Round($elapsed,3); userCpuTicks=$userTicks; systemCpuTicks=$systemTicks; totalCpuTicks=$userTicks+$systemTicks; improvementPercent=$null }
}

if ($Capture -and [string]::IsNullOrWhiteSpace($Serial)) { throw '-Serial is required with -Capture.' }
$selected = if ($Scenario -contains 'all') { @($matrix) } else {
    $unknown = @($Scenario | Where-Object { $_ -notin $matrix.id })
    if ($unknown.Count) { throw "Unknown scenario id(s): $($unknown -join ', ')" }
    @($matrix | Where-Object { $_.id -in $Scenario })
}
$root = New-OutputPath
$reportPath = Join-Path $root 'matrix-report.json'
if (Test-Path -LiteralPath $reportPath) { throw "Refusing to overwrite existing report: $reportPath" }
if (Test-Path -LiteralPath $root) {
    $existingItems = @(Get-ChildItem -LiteralPath $root -Force)
    if ($existingItems.Count -gt 0) { throw "Refusing to write into a non-empty output directory: $root" }
} else { New-Item -ItemType Directory -Path $root -Force | Out-Null }

$fixtures = foreach ($case in $selected) {
    $path = if ($FixtureRoot) { Join-Path $FixtureRoot ($case.fixture + '.json') } else { $null }
    [pscustomobject]@{ id=$case.id; required=$case.fixture; expectedFile=if ($path) { $path } else { $null }; available=[bool]($path -and (Test-Path -LiteralPath $path)); readiness='NOT_VERIFIED' }
}

$commands = @()
$processAccess = [pscustomobject]@{ status='NOT_TESTED'; reason=if ($Capture) { 'access probe runs per scenario against the already-running target; this runner never starts it' } else { 'dry-run does not query Android /proc permissions' } }
if ($Capture) {
    $commands += Invoke-AdbReadOnly @('get-state') (Join-Path $root 'device-state.log')
    $commands += Invoke-AdbReadOnly @('shell','getprop','ro.build.version.release') (Join-Path $root 'android-release.log')
    $commands += Invoke-AdbReadOnly @('shell','getprop','ro.build.version.sdk') (Join-Path $root 'android-sdk.log')
    $commands += Invoke-AdbReadOnly @('shell','getprop','ro.product.manufacturer') (Join-Path $root 'manufacturer.log')
    $commands += Invoke-AdbReadOnly @('shell','getprop','ro.product.model') (Join-Path $root 'model.log')
    $commands += Invoke-AdbReadOnly @('shell','getprop','ro.product.cpu.abi') (Join-Path $root 'primary-abi.log')
    $commands += Invoke-AdbReadOnly @('shell','getprop','ro.build.version.release_or_codename') (Join-Path $root 'android-codename.log')
    $commands += Invoke-AdbReadOnly @('shell','getprop','ro.product.device') (Join-Path $root 'device-name.log')
    $commands += Invoke-AdbReadOnly @('shell','dumpsys','package',$Package) (Join-Path $root 'package-info.log')
    $commands += Invoke-AdbReadOnly @('shell','pm','path',$Package) (Join-Path $root 'package-path.log')
    $packagePathLine = Get-Content -LiteralPath (Join-Path $root 'package-path.log') | Where-Object { $_ -match '^package:' } | Select-Object -First 1
    if (-not $packagePathLine) { throw "Package APK path was not reported for $Package; see package-path.log" }
    $apkPath = ($packagePathLine -replace '^package:','').Trim()
    if ($apkPath -notmatch '^/data/app/[^\s]+\.apk$') { throw 'Unexpected package APK path format; refusing to hash an unvalidated path.' }
    $commands += Invoke-AdbReadOnly @('shell','sha256sum',$apkPath) (Join-Path $root 'package-hash.log')
}

$scenarioResults = foreach ($case in $selected) {
    $safeId = $case.id -replace '[^a-zA-Z0-9_-]','_'
    $caseLog = Join-Path $root $safeId
    New-Item -ItemType Directory -Path $caseLog -Force | Out-Null
    $before = $null; $after = $null; $window = $null; $processBefore = $null; $processAfter = $null; $processWindow = $null
    if ($Capture) {
        $before = @(
            Invoke-AdbReadOnly @('shell','dumpsys','cpuinfo') (Join-Path $caseLog 'cpu-before.log')
            Invoke-AdbReadOnly @('shell','dumpsys','meminfo',$Package) (Join-Path $caseLog 'mem-before.log')
            Invoke-AdbReadOnly @('shell','dumpsys','gfxinfo',$Package,'framestats') (Join-Path $caseLog 'gfxinfo-before.log')
            Invoke-AdbReadOnly @('shell','ps','-A') (Join-Path $caseLog 'process-list-before.log')
        )
        Write-Host "准备场景：$($case.title)。Fixture: $($case.fixture)。$($case.input)"
        if ($WindowSeconds -eq 0) { [void](Read-Host '准备好开始场景时按 Enter；随后请操作者自行在设备上执行动作') }
        $processBefore = Read-TargetProcessSnapshot $caseLog 'before'
        $started = [DateTimeOffset]::Now
        if ($WindowSeconds -gt 0) {
            Write-Host "固定窗口已开始，持续 $WindowSeconds 秒；runner 不发送触控。"
            Start-Sleep -Seconds $WindowSeconds
        } else {
            [void](Read-Host '场景动作完成后按 Enter；runner 不发送触控')
        }
        $processAfter = Read-TargetProcessSnapshot $caseLog 'after'
        $ended = [DateTimeOffset]::Now
        $window = [pscustomobject]@{ start=$started.ToString('o'); end=$ended.ToString('o'); durationMs=[math]::Round(($ended-$started).TotalMilliseconds); operatorControlled=$true }
        $processWindow = Compare-TargetProcessWindow $processBefore $processAfter
        if (-not $processBefore.status.StartsWith('CAPTURED') -or -not $processAfter.status.StartsWith('CAPTURED')) { $processAccess.status='UNAVAILABLE'; $processAccess.reason='At least one target /proc/PID/stat or /proc/uptime read failed; see per-window proc logs.' }
        elseif ($processAccess.status -eq 'NOT_TESTED') { $processAccess.status='READABLE'; $processAccess.reason='Target /proc/PID/stat and /proc/uptime were readable for at least one input window.' }
        $after = @(
            Invoke-AdbReadOnly @('shell','dumpsys','cpuinfo') (Join-Path $caseLog 'cpu-after.log')
            Invoke-AdbReadOnly @('shell','dumpsys','meminfo',$Package) (Join-Path $caseLog 'mem-after.log')
            Invoke-AdbReadOnly @('shell','dumpsys','gfxinfo',$Package,'framestats') (Join-Path $caseLog 'gfxinfo-after.log')
            Invoke-AdbReadOnly @('shell','ps','-A') (Join-Path $caseLog 'process-list-after.log')
        )
    }
    $fixture = $fixtures | Where-Object id -eq $case.id
    [pscustomobject]@{
        id=$case.id; title=$case.title; maps=$case.maps; mode=$case.mode; zoom=$case.zoom
        taskBranch=$case.taskBranch; inputWindow=$case.input; requiredFixture=$case.fixture; fixturePath=$fixture.expectedFile
        fixturePresent=$fixture.available; fixtureGap=$case.fixtureGap; gpsBehavior=if ($case.gps) { $case.gps } else { 'NOT_APPLICABLE' }
        readiness='NOT_RUN'; result='NOT_RUN'
        windowPolicy=if ($WindowSeconds -gt 0) { "FIXED_SECONDS:$WindowSeconds" } else { 'MANUAL_ENTER_BOUNDARIES' }
        window=$window; samplesBefore=$before; samplesAfter=$after
        targetProcessBefore=$processBefore; targetProcessAfter=$processAfter; targetProcessWindow=$processWindow
        metrics=@('cpuinfo snapshot (system attribution only; instantaneous, not per-process elapsed CPU)','target PID /proc/PID/stat user/system jiffies with /proc/uptime window; comparable only when PID and process starttime match','ps -A raw process list before/after for app and WebView renderer attribution review; not interpreted as app-only or whole-device gain','meminfo package snapshot','gfxinfo framestats (Window/HWUI only; NOT map FPS)','WebView/page timing is not collected by this runner; do not treat gfxinfo as WebView or map FPS','Native163PerfProbe SDK/WorldWind actualFrameCount and cache counters require a separate opted-in QA probe session; NOT captured by this runner','SDK prepare timings are unavailable from the optimized Native163PerfProbe hook; do not derive from gfxinfo or actualFrameCount','Actual map FPS is NOT captured or inferred by this runner; comparative improvement percent is not produced')
    }
}

$report = [pscustomobject]@{
    schema='shantu-performance-matrix/v1'; createdAt=[DateTimeOffset]::Now.ToString('o')
    mode=if ($Capture) { 'READ_ONLY_CAPTURE' } else { 'DRY_RUN' }
    device=if ($Capture) { [pscustomobject]@{ serial=$Serial; package=$Package } } else { [pscustomobject]@{ serial=$Serial; package=$Package } }
    outputDirectory=$root; commands=$commands; fixtures=$fixtures; scenarios=$scenarioResults; targetProcAccess=$processAccess
    acceptance='No scenario is PASS unless a reviewer separately checks fixture integrity, required manual window, application state and metric availability. This runner never establishes functional or visual acceptance.'
}
$json = $report | ConvertTo-Json -Depth 10
$encoding = [Text.UTF8Encoding]::new($true)
$bytes = $encoding.GetBytes($json)
$stream = [IO.File]::Open($reportPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try { $stream.Write($bytes, 0, $bytes.Length) } finally { $stream.Dispose() }
Write-Output "Report: $reportPath"
Write-Output "Mode: $($report.mode); scenarios: $($selected.Count); all results NOT_RUN."
