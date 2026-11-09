# 0.2.191 private — standalone feedback fixes

Target `0.2.191-test` / code198 / `com.shantu.oldengine`, label 山兔·优化, from `D:/ShantuEngineResearch/old-engine-20261105` on `codex/old-engine-tilt-dual-20261105`. Existing React UI and native map architecture remain. User explicitly deferred accounts/friends/cloud sharing and requested the standalone APK. After browser control became disabled, the user chose “先出测试包，界面我来验”; this is a test candidate, not completed visual or phone acceptance.

## Included changes

- 2D joystick input keeps pitch0 until the user explicitly selects3D, in primary and comparison maps. Manual bearing changes remain available.
- Route editing separates selected real nodes from selected line positions; entering, adding, clearing, undoing and box-selecting synchronize that state. Native tap and drag share projected nearest-node selection, editable-route filtering and stable tie resolution. A fresh gesture no longer inherits the preceding drag's600ms trailing-click guard. A selected line position explains that a node must be added before it can be dragged.
- Marker photo thumbnails and photo detail previews are larger. JPEG/PNG/WebP dimensions bound decoding allocations, metadata/hash and image work overlap, a pending preview appears before storage completes, and image/canvas resources are released. Existing HEIC/AVIF compatibility and original-hash rules remain. No measured phone speedup is claimed.
- Foreground compass polling resumes immediately on visibility/pageshow. Native registration state is tracked across pause/resume; floating compass uses only fresh3-second samples and retries a registration with no sample after1.5s, at most3 times. Real sensors and screen-off recovery time are unverified.
- Floating-map entry remains under Tools; regular whole-row switches show active colors. Floating/lockscreen outdoor3D contour processing and its option are retired, preserving other switches. Shared controls, panel headers and safer map-panel insets are used on the touched surfaces. Ordinary main-map3D and independent contours remain.
- Source health tests representative current-view tiles without changing camera, distinguishes access refusal, DNS/TLS errors, timeout, missing coverage and invalid responses where the transport provides evidence. A browser CORS failure stays unknown. OVMAP composite tests explicitly identify base-layer-only scope. Saved-source/comparison alternatives provide view-preserving selection. Tests are bounded and cancellable; they do not guarantee all regions or restore Jilin service authorization.

## Deferred and protected

Social UI/client/cloud functions/config/import helper/tests and the CloudBase SDK manifest addition were removed from the active app and preserved in ignored `.openai/deferred-social-20261109/` with checksums. No cloud environment, email provider, account or backend was deployed. APK must contain no social entry or bundled CloudBase SDK.

Registered private Tianditu,39 private seeds, signature, storage identifiers, prior190 and formal/180–189 artifacts remain protected. The phone's custom “增强” source was not read, reset or migrated; its actual upgrade retention and backup are unverified. No real GPS or phone data is injected/cleared. Existing unrelated local Jilin preparation work stays separate.

## Validation record

Final check results, artifact hash, source commit and download are recorded below after build. First137 Node run:136 passed; the only failed assertion still required the cancelled friends entry. It is corrected to the final standalone contract and rerun. Earlier190/current-source evidence remains in [feedback record](preview-feedback-20261109.md); screenshots from the mistaken165 directory do not count toward this candidate.

Current browser control returned “Local browser use is disabled in Work settings”; screenshot/click validation stopped. User elected to test the UI on the phone.390×857/360×780/short-screen matrix, actual node dragging/highlight, photo import time, sensor recovery, native floating permissions and long-term stability are not claimed PASS. HarmonyOS6.1 native HAP is undelivered.

Save drafts/end recording, then overwrite-install 山兔·优化; do not uninstall or clear data. Formal 山兔 is separate. Only deliver the private APK locally and to the approved private delivery repository; no private key/config originals or APK enter the public source repository.


Final source checks:140/140 Node,8/8 hybrid native tests (3 compass sample/recovery,2 retired terrain payload,3 source-probe scenarios), TSC exit0 and fresh private web35.45s PASS. Logs: `.openai/191-{standalone-node-final,tsc,web-build,native-tests}.log`. Native source/tests compile in the delivery hybrid module. Initial137/136 run remains preserved; final140 rerun passes after the standalone assertion correction. No emulator or phone was started. The first attempt to read build logs used the wrong relative directory; only those reads failed, the optimized Gradle command uses the checked correct absolute stage.
