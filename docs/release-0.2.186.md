# 0.2.186-test — contour loading, readable digits and route operations

Isolated branch `codex/old-engine-tilt-dual-20261105`, based on issued185. Target `com.shantu.oldengine` / 山兔·优化 / code193. Private build retains39 map seeds and registered Tianditu. Formal app,185/all historical APKs, signing and existing data remain protected. APK integrity checks and sending precede installed-app validation per the user's delivery order.

## Implementation

- Contours: previously the single global geometry lane also covered suspendable DEM fetching/sampling. A new process-wide preparation pipeline overlaps at most two source tiles, including the wait for the existing single CPU assembly lane; no unbounded source arrays, extra geometry concurrency, simplified terrain, larger vertex limits or reduced contour density. Geometry shared leases, tile priority, cancellation, refinement, seam and admission budgets remain. Numeric stage counters separate source load, assembly waiting and assembly time without URLs/coordinates.
- Digits: actual-density physical font raster (`9 CSS px × pane scale`), renderer scale1, actual font advances,0.65 CSS px contrast halo. Curved placement/readable direction retained. Two cached density delegates include conservative rotated collision extents; no per-frame Paint/Pair allocations. Conservative digit collision can reduce overlapping labels; all lines/elevations remain.
- Latest route recenter correction: route/track 回中 now sends every coordinate to existing `fitCollection` to show the full route. Point/model recenter remains usual zoom16; areas retain185 behavior. Shared entry covers main/dual/menu/collection/native-object double tap. Existing native fit uses a top-down/north-up bounds view, unlike point recenter; actual camera acceptance remains separate.
- Pre-navigation cancel: source shows current plan clears but a matching visible favorite is a separate overlay. Cancel now hides matching favorite display and clears pending plan/preview/selection; every favorite's geometry/content is retained. Storage failure returns failure instead of falsely clearing that visible plan. Old cancelled requests cannot revive it. This explains one source-confirmed visual failure path; it is not proof of the user's exact phone event.
- Visible 删除 added to first-level planned route card, shared by main/dual. Confirmation explains removal of the current plan and preservation of saved favorites/tracks/markers. It does not delete a saved original from the collection. Confirm panel overlays the card without increasing height, supports cancellation/Escape/focus loop, busy guard and failure/retry. Existing delete actions for actual saved objects remain.

## Verification before packaging

| Evidence | Status / boundary |
|---|---|
|67 native tests|PASS:38 terrain/vector,7 pipeline,6 geometry lease,4 process budget,5 refinement,5 seam,2 actual SDK raster tests. First run exposed an existing test fixture cancellation-before-start race; a start barrier corrected that fixture and final67 passed.|
|12 directed Node cases|PASS: route recenter plan, visibility retention, actual useNavigation/useRouteFavorites hooks, stale response rejection, storage failure, confirmation events and existing navigation preview/actions.|
|TSC / fresh private web / optimized|TSC and fresh web PASS; optimized APK pending at this source snapshot.|
|Actual SDK raster comparison|Root inspected native Canvas output at densities1/2/3.2 and two angles. Sharper target-size glyph raster visible; synthetic background is not a map or OPPO test.|
|Actual shared summary + hooks / production dock CSS|390×857,360×780,390×480 browser viewports PASS. Dock163px, delete36px, dialog same card103px, final text12px/16.2px. Cancel confirmation leaves plan; actual cancel/confirm clears plan and hides matching saved overlay while favorite count remains1. Tab cycle verified. First computed text9px was fixed with a local cascade override.|
|Map/phone runtime|Not yet verified; to continue after first delivering immutable APK. No phone speed percentage, battery or full-route native camera acceptance claimed.|

Screenshots: `artifacts/screenshots/186-20261107/`; sanitized evidence: `artifacts/performance/old-engine-186-20261107/summary.json`. Raw logs stay local `.openai`. Layout fixture has synthetic namespaced data; terrain-summary service502 was observed there and is not contour-native performance evidence. No source/provider/license replacement.

## Limits

OPPO Find X8 is not attached. Source-stage latency telemetry and emulator checks cannot prove phone smoothness, glyph clarity at every terrain angle or long-run memory stability. Dual card uses the same tested confirmation component; full installed main/dual workflow remains separate. Google ID-only short shares and original AMap route imports remain unsupported. Offline downloads are unchanged: one package active, up to16 tile workers inside it; no multi-package automatic queue. HarmonyOS native package remains undelivered.

Primary reference: [Android Paint pixel text sizing](https://developer.android.com/reference/android/graphics/Paint), [WorldWind Kotlin upstream](https://github.com/WorldWindEarth/WorldWindKotlin); actual installed SDK Font/TextRenderer and the local curved label renderer were inspected.
