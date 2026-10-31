# Native marker regression helper

This Java Instrumentation helper targets the existing private release package
`com.guanyun.weather.shantu.preview`. It does not build or modify that application APK and
does not use WebView debugging/CDP. The helper's package/class/environment names retain the
historical `qa149` / `Native149Instrumentation` identifier; that legacy tooling name is not
the version of the target application.

## Modes

- `inspect`: read-only activity, map, camera, source ID, annotation-count, selection-ID, and
  visible-control inspection.
- `native-regression`: temporarily appends three UUID-based QA pins through the target app's
  real WebView storage events; waits for the actual native screenshot to show all three pin
  colors; sends touchscreen MotionEvents; checks actual GPU pick IDs and selected IDs;
  exercises rapid alternation, blank clearing, camera zoom thresholds, and poses.
- `native-regression -e pickOnly true`: runs the pick/clear flow and skips zoom/pose sweeps.
- `native-regression -e followUp true`: runs the UI follow-up flow, including real MotionEvent
  taps on the selection card's start/end buttons, verifies the route input values, returns to
  the map, reselects QA-A, and captures five camera poses. It skips rapid alternation and the
  full zoom sweep. It never requests route calculation or search.

The QA records use unique IDs, are appended without replacing existing annotation records,
and only this run's IDs are removed. Before removal, a QA selection is cleared using the
visible “完成调整” button through its DOM rectangle and a real touchscreen event. The original
camera is restored in `finally`. If the process is force-stopped, inspect the `qa149-*` IDs in
`guanyun.annotations.v1` before any manual cleanup; do not clear application data.

Evidence screenshots and a JSON report are written to the target application's app-specific
external pictures directory. They include actual camera/selection snapshots, picker results,
timings, and rendered-pin color counts. These helper outputs are diagnostic evidence; review
the native screenshots before making a visual acceptance claim. No map-source URLs, API keys,
or credentials are read or emitted.

## Build the helper only

From the repository root:

```powershell
powershell -NoProfile -File 'scripts\android\native-marker-regression\build.ps1'
```

The script uses configurable `-JdkRoot`, `-SdkRoot`, and `-ProjectRoot` parameters. If
`-ProjectRoot` is omitted, it searches parent directories for `mobile-native`. It compiles
with UTF-8/JDK 17/Android 35, signs the helper with the existing local test keystore, verifies
it, and prints its SHA-256. The private keystore is not part of this helper directory; provide
the locally held signing password through the legacy `QA149_KEYSTORE_PASSWORD` environment
variable without printing it. Build output stays beneath this directory.

## Install and run after reviewing the helper APK

Replace `<serial>` with the device serial and `<generated-build-folder>` with the generated
folder name printed by the helper build (for example, `build-<generated-id>`):

```powershell
adb -s <serial> install -r 'scripts\android\native-marker-regression\<generated-build-folder>\Native149Instrumentation.apk'
adb -s <serial> shell am instrument -w -e mode inspect com.shantu.qa149/com.shantu.qa149.Native149Instrumentation
adb -s <serial> shell am instrument -w -e mode native-regression com.shantu.qa149/com.shantu.qa149.Native149Instrumentation
adb -s <serial> shell am instrument -w -e mode native-regression -e pickOnly true com.shantu.qa149/com.shantu.qa149.Native149Instrumentation
adb -s <serial> shell am instrument -w -e mode native-regression -e followUp true com.shantu.qa149/com.shantu.qa149.Native149Instrumentation
```

Instrumentation output is returned under `qa149_json`. Pull only the reported target-app
evidence directory when needed; it is separate from this source tree.
