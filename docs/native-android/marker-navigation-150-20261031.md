# 0.2.150 Native Marker Regression — Failed Candidate

**Status:** `0.2.150-test` / versionCode 157 is **FAIL / UNQUALIFIED** after root-reported native regression. The report reference is `.openai/native150-gpu/report.json`; its contents were not inspected in this documentation task. 150 remains a versioned private APK and did not replace the fixed APK entry. The next fix is being prepared in 151.

## Package record

- Package: `com.guanyun.weather.shantu.preview`
- Versioned copy: `APK/Shantu-0.2.150-test-private.apk`
- Size: 165,150,292 bytes
- SHA-256: `a047a80781603e473d77359fc51ab113f5aaf2c4cf362eef35d1fd38be7f2f42`
- Fixed `APK/山兔手机.apk` remains 149/code156 with SHA-256 `3f681197d80507cd2fccc118ee8bb5c44267a6fffa398f37ef3a120890a9f4cd`.

## Source/build checks

51 Node tests, 30 Kotlin tests across five suites, TSC, private React assets and the optimized Android build passed. They do not override runtime failures.

The 150 source used a WorldWind SDK `getTexture` fallback in `NativeMarkerPlacemark`. Root reports that a simulation displayed a white 24 px square, and the SDK default placeholder source was confirmed. That fallback can expose the SDK placeholder and is not visually accepted.

## Native regression summary

Root reports 75 actions in `.openai/native150-gpu/report.json`: A/B/C picks, blank clear and refocus passed, while rapid alternation expected marker B but selected A. Rapid native selection is **FAIL**. The simulator also showed the 24 px white square; native marker presentation is **FAIL**.

The selected-object DOM card showed the correct name and navigation buttons, with the button array correct. The helper’s `hasStartFlags=false` is an encoding issue in the helper output; it is not evidence that the production card lacks the buttons. This React/DOM observation does not erase the independent native rapid-pick failure.

## React UI evidence, limited scope

The earlier isolated Playwright run of the actual React source passed at 390×857 and 360×780 for selection-card bounds, same-row start/end buttons, route-panel/input bounds, corresponding test-name fields and return/reselect. No route calculation was invoked. The browser had no native bridge and rendered MapLibre; this is not APK or WorldWind GPU acceptance. Screenshots remain under `artifacts/screenshots/marker150-*`.

## 151 source fix under verification

The 151 source skips drawing the SDK default placeholder when no usable texture is available while retaining the existing ready-texture fallback. It also changes host generic cancellation so an unrelated gesture cannot cancel GPU, DEM or section jobs. These changes are source-only until the optimized build completes and must be retested on the actual 151 package.

151/code158 has 51 Node tests, 31 Kotlin tests across five suites, TSC and private React build passing; optimized Android build is **IN_PROGRESS**. There is no verified 151 APK path, size or hash yet. Do not reuse the 150 package identity/hash as 151 evidence.

## Delivery and device status

Physical-phone acceptance remains **UNVERIFIED**. The current chat private attachment is **NOT_DELIVERED**; no attachment ID or private download link exists. The 150 package was not promoted to the fixed APK path or publicly released.