# 0.2.151 Native Marker and Route Endpoint Regression — Passed Scope

**Status:** Candidate 0.2.151-test / versionCode 158 passed the native marker core regression and the actual native route endpoint button follow-up. These results cover the tested marker and route selection paths only. Main/dual-map full-feature acceptance and physical-phone acceptance remain unverified.

## Package/build record

- Package `com.guanyun.weather.shantu.preview`, version `0.2.151-test`, code 158.
- Versioned APK: `APK/Shantu-0.2.151-test-private.apk`.
- Fixed APK: `APK/山兔手机.apk`.
- Both: 165,150,292 bytes, SHA-256 `60f77e35fd7f4c4d39c6f076ac98409dd9a4d5ca8eec3fd0decb6008e6692689`; read-only verification confirms matching bytes/hash.
- 51 Node tests, 31 Kotlin tests across 5 suites, TypeScript, private React build and optimized APK build: PASS.
- Root is finalizing package signature/resource/private-config audit metadata separately.

## Source correction

The marker renderer skips the WorldWind SDK default placeholder when there is no usable texture while retaining an already ready fallback texture. Host generic cancellation no longer lets an unrelated gesture cancel GPU, DEM or section tasks.

## Native core evidence

`.openai/native151-gpu/report.json` contains 78 steps. A/B/C, blank clear, refocus, and three rapid alternation rounds passed; each rapid round expected and selected B. Sixty-four zoom samples across integer levels 2–22 in both directions plus thresholds all report a focused marker. Five poses were captured. Original annotation count stayed 1, final count stayed 1, and QA IDs were removed.

Root reviewed 69 zoom/pose PNGs (64 zoom plus five poses); every frame had non-zero central red-A pixels. At zoom 9.16 a fallback icon was visible and the label appeared at 9.4, without the isolated text gap found in 149. The tested 151 init/zoom frames showed no 24 px white SDK placeholder.

## Actual native endpoint UI follow-up

`.openai/native151-gpu/followup-ui-final-report.json` records 18 steps with `trueFollowUp`:

- A real MotionEvent activated “设为起点”; the route start input became `QA-PIN-A`.
- After closing, clearing selection and reselecting, “设为终点” set the end input to `QA-PIN-A`.
- Close/clear/reselect repeated successfully; five camera poses completed.
- A real touch on “完成调整” cleared selection. Final selected ID is empty, QA IDs remaining are zero and original annotation count remains 1.

Root reviewed `.openai/native151-gpu/followup-final/followup-ui-final.mp4` and its screenshots. The earlier `replicate-full.txt` had a helper boolean-string encoding issue and is not used as this UI-action evidence.

## Traceability note

The report JSON is hosted under `.openai/native151-gpu`, while the reusable QA tool/package/class retains legacy `qa149` / `native149` names. Root confirmed `com.shantu.qa149` and its device evidence folder naming are tool identifiers reused across candidate builds, not the application version. The actual installed target was app versionCode 158, verified by root’s package badge, install and dumpsys evidence. Reproduction helpers are under `scripts/android/native-marker-regression/`.

## Historical failure and scope boundaries

150 remains **FAIL / UNQUALIFIED**: rapid selection expected B but selected A, and a 24 px white SDK placeholder appeared. The 151 results do not alter that history.

Main/dual-map full-feature acceptance and OPPO Find X8 or other physical-phone behavior remain **UNVERIFIED**. Private chat delivery is **NOT_DELIVERED**; there is no attachment ID/private download URL. Do not publish the APK or private map configuration.