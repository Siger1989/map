# 0.2.192 private — map photo preview size

Target `0.2.192-test` / code199 / `com.shantu.oldengine` from the current old-engine checkout/branch. User reports marker photo previews remain small and should be slightly larger than marker logos. This patch fixes the photo drawn on the map. The191 editor-card enlargements remain;191 and earlier immutable APKs are preserved. User chose phone UI self-testing for this delivery round; no visual/phone PASS is inferred from compilation.

## Cause and implementation

`NativePhotoLayer` produced a44-physical-pixel bitmap with a32-pixel image interior and used an optional photo `pixelScale` defaulting to1. The host's safe photo DTO does not pass that field, while ordinary markers use the viewport's authoritative CSS-to-native scale. At scale3.22 the old interior is about9.9 CSSpx, visibly smaller than the40 CSSpx normal marker. Increasing editor-card CSS could not fix this native-map output.

The map photo now uses a64-logical-pixel canvas,56px photo frame and52px actual photograph. Its image factory renders at the same bounded1–4x density bucket as marker logos and applies `cssScale / density` to the placemark, retaining the intended logical size at scale1/2.8/3.22. `NativeMapController.setBridgeMarkerCssScale` also updates photos after a viewport change; both primary and comparison maps use this controller path. Photo eye-distance scaling is explicitly disabled, while terrain depth testing, ground clamping, photo pick IDs/names, group counts and annotation glyph badges remain. Web `trip-photo-marker` uses a64px box and56px border-box image for matching geometry.

Changed production files are `NativePhotoLayer.kt`, its one-line controller scale hookup, and `modules/photos/photos.css`; product identity is bumped for the test APK. No original photo/preview Blob, import encoding, stored metadata, marker logo size, coordinate or grouping policy is changed. A focused `NativePhotoLayerTest` exercises the actual bitmap factory and placemarks rather than a replacement implementation.

## Validation and boundaries

TSC and7 directed Node cases (photo wire, import compatibility, marker scaling) pass. The final fresh private web build is7.23s. Native bitmap/density/pick/depth and existing marker-presentation tests plus optimized build/integrity results are recorded below when complete. Build intermediates reuse `.openai/candidate-stage-191`; they are scratch outputs, not the immutable191 APK. Package identity/version and every bundled current web asset must match192 before copying a new exclusive192 delivery file.

The browser-use setting remains disabled, so no alternate browser automation is used. New390×857/360×780 visual layout, native hardware photo appearance/tap feel and phone upgrade retention are unverified. Native graphic unit tests are not phone screenshots. Registered Tianditu,39 private sources and existing signature remain required. The phone's custom “增强” source was not read/reset; actual phone preservation/backup is not claimed. Existing unrelated Jilin preparation drafts remain separate.

The lockscreen compass's GPS/declination dependency identified after191 remains unresolved and outside this photo-only patch. Accounts/friends/cloud remain deferred; no social SDK or backend is enabled. HarmonyOS6.1 native HAP remains undelivered. Save drafts/end recording and overwrite-install 山兔·优化; do not uninstall or clear data.


Final source checks:7/7 Node, TSC exit0, fresh private web7.23s and7/7 hybrid native cases (4 real NATIVE bitmap/photo cases,3 marker-presentation cases) PASS, no skipped cases. Bitmap tests inspect the actual52px photo content,56px non-transparent frame, high-DPI resolution, group/annotation badges and scale-change metadata; this is not a phone screenshot. Logs `.openai/192-{photo-node,tsc,web-build-final,native-tests}.log`. Two initial test-compilation attempts used the SDK protected list and Java getter spelling for a Kotlin property; only test access changed to public `getRenderable`/`count`, with failed logs retained. Production Kotlin/Java compiled before these corrections. No production code was changed to accommodate a failed assertion.
