# 0.2.182-test — visible cache routes and understandable task pages

2026-11-07, W697. Target `com.shantu.oldengine`, 山兔·优化, code189. Isolated workspace/branch and original signing/data identity unchanged. The issued 181 package is immutable; 180/formal166 and their backups remain. This update retains the 181 navigation/marker/photo/editor work and registered Tianditu/39 private seeds.

## User report and confirmed cause

The phone screenshots show a favorites cache category with a folder count, then a small cache page dominated by a large migration/export paragraph and a disabled cache-only switch. That UI did not expose individual route tasks on the first screen.

Source confirms the folder was only a shortcut, while the package page placed its unconditional legacy-export banner and cache-only switch before the package rows. `canExportLegacyOfflineArchive()` detects an API, not an obsolete installed version; its presence did not prove the user needed migration. The same JS imported-package index drives both the folder count and package rows. `availableTrip` does not remove missing-source rows; the layout could hide them below content. Do not blame an unverified old phone version or assert metadata loss merely from these screenshots.

## Changes

- **收藏 → 地图缓存** directly lists the existing cached routes, source, phase and real `OfflineProgress` counts/bytes. Running/planning/waiting tasks sort first; paused/failed and legacy partial tasks precede completed packages. Search matches route/source/status. A `phase`-less legacy record with downloaded tiles says 未完成，可继续, not 尚未开始.
- Selecting 查看缓存任务 opens the existing management page and focuses that package ID. 管理全部缓存 remains. Cache tab storage key/order, original package index, URL manifests and tile data are unchanged.
- Management title includes the package count. Task rows come first, with title/source, actual progress, pause/resume, integrity check, delete confirmation, 查看地图 and 使用此包离线浏览. Partial packages remain usable when their source exists and downloaded tiles are available. Missing-source rows remain visible with a clear reason; they are not silently removed or relabeled complete.
- The old-version/new-application banner is gone. **缓存备份与迁入** is a closed details item at the end of the same scrollable list; it consumes no fixed first-screen footer. Expanding scrolls the complete backup item into view. The existing native ZIP export callback remains, including the empty-package case. This is an optional backup action, not a prerequisite for browsing existing caches.
- Percent display uses floor consistently with favorites and the map progress prompt, avoiding 100% before all resources are present.
- Offline browsing invokes the existing host callback to select the package's actual source/display and fit its bounds. Merely changing the offline flags would retain a different current source; both viewing actions use the real source-selection workflow.

## Validation before issue

- TSC PASS; 18 focused cache/collection/task tests PASS, 0 failures. Actual component tests cover two package rows with export capability present, missing source, source->Next, task focus/actions, legacy field compatibility, empty state and native export callback.
- Playwright used real `ControlDock`, `WorkbenchPanel`, `RouteCachePanel` and shared theme CSS with isolated synthetic data (not a mock production map or real GPS). At 390×857 and360×780 both favorites cache rows were wholly inside the visible list. At390×480 the list scrolls; host header/back remain fixed.
- Row click opened the correct missing-source task and preserved its true partial counts; its unavailable map/continue buttons stayed disabled. In all three sizes the backup item expanded and its horizontal export button was fully inside the actual scroll viewport. Empty-package backup also remained reachable.
- Evidence: `.openai/182-browser-checks-final.log`, `.openai/182-node-final.log`, `output/playwright/182-*.png` and copied `artifacts/screenshots/feedback-182-20261107/`. All layout data and names are synthetic.
- Android photo/renderer/native download code was not changed in182. The 181 source checks, 127 Node and2 Robolectric photo results remain baseline evidence, not newly run182 phone tests. 181's actual emulator native download tests succeeded at Bing14/19 (one JPEG each, verify/read/own-task cleanup); those do not prove this populated phone list was accepted.

## Limits and next evidence

The existing native snapshot API reports one active job, not a complete native task catalog. If an old native job has no matching JS index/manifest, its URLs/source cannot safely be reconstructed from counters; this update does not manufacture such a package or silently migrate/delete it. Source missing/restricted services and actual large-route connectivity remain explicit constraints.

New APK build/integrity/issue/runtime results are appended when actually available. Per current instruction, send the verified package before running it. OPPO Find X8 is not connected, so actual phone list/scroll/touch acceptance remains pending. No physical-device GPS/HEIC/AVIF, exact WeChat internal chooser, HarmonyOS native or AOD claim is added.
