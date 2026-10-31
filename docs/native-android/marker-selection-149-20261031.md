# 0.2.149 Native Marker Selection and Zoom Presentation

**Status as of 2026-10-31:** source, targeted tests, APK build and package integrity checks pass. On MuMu3 run3, all five native input assertions passed: taps selected A, B, C, rapid alternation selected B, and a blank tap cleared selection. The 43-point zoom sweep and five camera poses ran, but visual review found a transition gap at zoom 9.16: the marker is absent in label mode and reappears at zoom 9.4. This is a visual failure pending the new image fallback and retest; the 149 APK is not a visually qualified release. Physical-phone acceptance is unverified. The private APK has not been delivered in this chat.

## Scope

This update addresses marker selection at native WorldWind rendering zooms: rectangle picks that include objects not actually hit, stale tap replies, selection that remained stuck after tapping empty map, distant selected labels, and marker size changes around zoom thresholds. React and TypeScript remain the UI and business layer; this does not replace the map host or change annotation data formats.

## Changes

- Native WorldWind pick results now include only objects marked `isOnTop` and exclude terrain. The expanded touch rectangle is treated as a candidate area; a separate exact GPU point pick remains authoritative when it returns one unambiguous object. When multiple rectangle candidates remain, saved-array order no longer chooses an arbitrary marker.
- Native tap replies are accepted only for the latest uncancelled gesture. A tap that identifies no object clears stale selection when no active pick, edit, draw, measurement or navigation workflow owns the interaction. Existing drafts remain intact while their actual edit task is active.
- Marker labels no longer stay expanded just because an item is selected at a distant zoom. The native badge combines icon, frame and name into one placemark image and one screen anchor. Labels appear from raw zoom 9, icon badges from zoom 8 to 9, and compact dots below zoom 8. Hysteresis around the thresholds reduces repeated texture rebuilds. CSS scale and bounded density buckets control bitmap sizing.
- GPU selection and the CSS-sized touch fallback keep separate result sets so the broader touch target does not override an exact hit.

## Source and Targeted Verification

The current source changes are in `NativeRenderedPickResults.kt`, `NativeMapController.kt`, `NativeMarkerPresentation.kt`, `NativeMarkerPresentationState.kt`, `NativeModelRenderer.kt`, `NativeTerrainMap.tsx`, `tapSemantics.ts`, `interaction.ts`, `markerScale.ts`, and the related tests.

- 51 targeted Node tests across 7 files: PASS, 0 failures, 0 skips.
- 28 Kotlin JVM tests across 5 suites: PASS, 0 failures, 0 errors, 0 skips.
- TypeScript, private React build, optimized Android build and APK integrity checks: PASS.
- APK: `0.2.149-test`, versionCode 156, package `com.guanyun.weather.shantu.preview`, 165,152,212 bytes, SHA-256 `3f681197d80507cd2fccc118ee8bb5c44267a6fffa398f37ef3a120890a9f4cd`.
- Original signing certificate `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`, launcher alias and package identity are preserved. The APK has 2,165 ZIP entries with CRC passing, 1,925 fresh React assets matched, 39 private map sources with private configuration matching, four 64-bit native libraries and 16 KiB ELF alignment. The 473 FABDEM and 23 repair tiles are present.

The APK is at `APK/Shantu-0.2.149-test-private.apk`; the fixed local entry `APK/山兔手机.apk` matches it. The versioned copy is `交付包/山兔-0.2.149-test-2026-10-31/01-Android-APK/Shantu-0.2.149-test-private.apk`. Versions 148 and 147 remain unchanged; the original 142 bytes remain preserved. See `verification-149-20261031.json` for the package integrity record.

## Runtime Acceptance

GoogleShantuHybrid35 installed the actual 149 package and reached native map readiness. Repeated SystemUI/launcher ANRs made continuous zoom and touch observations invalid; those runs are not counted as a pass or as evidence of a map defect. Follow-up moved to the existing MuMu test instance 3 with its data preserved. Actual 149/code156 launched normally there with terrain and imagery visible in `.openai/native149-gpu/mumu-map.png`.

The run3 native regression report is `.openai/native149-gpu/run3/report.json`; the zoom contact sheet is `.openai/native149-gpu/zoom-contact.png`. It contains 53 actions: five selection assertions, 43 zoom samples spanning raw zoom 2 through 22 and five camera poses. The five input assertions passed, the original annotation count remained 1, final annotation count remained 1, and all temporary QA IDs were removed (`remainingQaIds: 0`).

Visual review found a **FAIL** at raw zoom 9.16: the sweep reports `label`, but marker A is missing in the contact sheet frame; at the next 9.4 sample the label appears. This exposes an image transition gap even though the native input assertions passed. The 149 zoom sweep is therefore **NOT visually accepted**. Root's visual agent is working on a new image fallback for candidate 150; no 150 APK has been built or verified.

The separate limited pan/zoom flicker sample performed six pan swipes, two zoom-ins and two zoom-outs over 39.525 seconds, producing 398 encoded frames in `.openai/native149-gpu/map-motion.mp4`. Frame review found no broad white/black flash above the 70% threshold in that sample. This does not report FPS, cover the whole map or marker overlays, or prove all flicker is fixed. The five camera poses were exercised but have not been visually qualified.

The `verification-149-20261031.json` now records run3 input PASS and zoom visual FAIL. Source changed after the 149 final tests: the yellow floating navigation control was removed and endpoints moved into the existing upper-left selection cards; TypeScript passes, but these edits are **not in the 149 APK**. The image-fallback correction remains in progress and there is no 150 build.

Physical-device behavior, including OPPO Find X8 touch feel and rendering, remains **UNVERIFIED**. Full main/dual-map visual and feature-parity acceptance is also unverified.

## Private Delivery

The local private APK candidate is built and integrity-checked, but **private chat delivery is NOT_DELIVERED**: no attachment ID or private download URL exists. The Windows tool environment lacks the Library helper files and hosted-apps/connector access needed by the coordinator-reported large-file route. Do not publish the APK, expose private map credentials, or treat a local path as a chat download.

## Next Steps

1. Keep MuMu3's data and the run3 artifacts intact.
2. Complete the image fallback in the post-149 source, then build and verify candidate 150; the source edits do not validate 150.
3. Re-run the zoom transition around 9.16/9.4 and the full native marker matrix against the actual candidate package. Require the marker to remain visible through mode changes before changing the visual gate.
4. Keep phone acceptance and private chat delivery marked unverified/not delivered until their own evidence exists.
