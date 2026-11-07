# 186 contour loading and label clarity

Scope: isolated old-engine checkout, based on issued185 (`f38e220`); formal app, existing data, registered Tianditu, old APKs and all contour intervals/source samples remain protected. Target:186/code193, `com.shantu.oldengine`. No new engine or web map fallback.

Confirmed source findings:

- `NativeContourLayer.loadTileContent` currently holds the single process assembly permit while awaiting `loadSamples`, including local DEM reads, public fallback network and resampling. A slow fetch blocks another ready tile's assembly, including the other pane.
- Contour digits use a7.5 physical-pixel font texture with a subsequent CSS/native density enlargement. This preserves nominal size but enlarges an already small bitmap. Existing curved-path orientation is retained.

Implementation: bounded two-tile preparation pipeline, with the existing single geometry assembly lane and all tile/vertex/admission budgets; actual-density glyph rasterization at9CSS pixels and a thinner contrast halo, retaining curved placement and two density delegates. No DEM decimation or reduced contour density.

Verification plan: cancellation/null/failure/queue bounds and blocked-source behavior; existing geometry/shared lease/refinement/seam tests; real native text renderer bitmap comparison at density1/2/3.2; fresh private optimized APK and integrity checks, then send immutable package before installed-app runtime checks. Numeric stage telemetry has no URLs or coordinates. Synthetic scheduling tests are not phone speed benchmarks. OPPO Find X8 is not connected; phone acceptance remains unverified.

Status: implementation in progress. No186 APK issued yet.185 remains the current issued package. Same-scene installed-app measurements and visual checks must be recorded separately.

Primary references: [WorldWind Kotlin upstream](https://github.com/WorldWindEarth/WorldWindKotlin), [Android Paint text rasterization and pixel sizes](https://developer.android.com/reference/android/graphics/Paint). Local installed SDK and patched curved-label source were inspected before choosing changes; no SDK/license replacement.
