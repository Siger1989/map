# 0.2.190 private — contour pressure and source failure diagnosis

Issued `0.2.190-test` / code197 / `com.shantu.oldengine`, label 山兔·优化; app source `23213e208608231c16f8a45abaf4fc5305ec16cd`, isolated branch `codex/old-engine-tilt-dual-20261105`, not main. Hybrid React UI + native WorldWind renderer, same certificate/private configuration. Formal app,180–190 packages, registered built-in Tianditu and stored data remain protected. No Filament claim or web-map fallback.

## Reproduced contour problem

User reports continuous flashing after leaving a tilted map still. On the owned API34 x86_64 AVD,189 at synthetic103.35E/29.52N,zoom12,pitch45°,bearing20° settled at20 built/resident tiles with no pending work; four8-second samples stayed unchanged. At82° with the same other camera values, no further gestures were made, yet completed geometry rose36→86→225, queue sequence86→184→320 and actual render frames kept increasing. Resident content stayed around21–24 tiles,103–106MB (about99–101MiB) against a128MiB capacity/96MiB low-water cache, with57–59 pending requests. Maximum-level rejection remained0 and prior budget-refinement count settled at27. SDK cache removal releases active geometry, while renderCut does not pin those items. This demonstrates a repeated generation/eviction workload in this test scene; it is not evidence of an OPPO result or every flashing cause.

The initial proposed SSE multiplier was rejected before delivery: forced geometry refinements would prevent it from merging this workload. The implemented candidate instead suspends budget-deferred far-field requests in the existing priority queue before taking a preparation permit. It preserves focus-containing/near patches, original DEM/contour intervals, two preparation slots, one assembly slot and existing memory limits; loaded geometry is not intentionally dropped. Projected footprint distance and thin horizon patches are considered together, with conservative behavior for failed projection. Pressure increases monotonically and recovery requires a quiet queue plus30seconds below a lower threshold. Returning deferred patches under the focus makes them eligible again. Far-field detail can remain deferred under sustained pressure; this does not reduce base imagery or terrain coverage.

Numeric pressure/source/assembly counters are added to the bounded QA allowlist. The helper build hash uses .NET SHA256 to work under both PowerShell versions; an earlier wrapper failed only at the unavailable Get-FileHash function after signing, and the corrected helper build is separately verified.

## Sources and Ovi comparison

No claim that Jilin detailed imagery has been restored. The original418B file and credential remain unchanged. Earlier detailed requests returned the exact known No Data image; only z0 gave a global overview. This round avoids repeating the same24 probes. Targeted Ghidra analysis of the official Android10.7.3 native library confirms bare `{$y!}` evaluates to `2^z-1-y` in MakeCusMapVarUrl and MakeOMapHttpRequestURLParams, matching Shantu187+. Final issued URLs, headers, matrix and proxy behavior for the external file remain unverified. Static implementation and a live network trace are not interchangeable. No embedded provider credential or proprietary decompiled code is published.

Representative failed sources were retested without the workstation's system proxy, preserving the same URL and credential destination and not following redirects. One Google mirror returned a valid512×512 JPEG directly; Android availability has not been inferred from that result. Other samples still show DNS failure, TLS failure or disconnect before an HTTP response. Causes such as service retirement, account restriction or provider outage remain unconfirmed where no authoritative response identifies them. No third-party key was replaced, forwarded to a new origin or used to bypass authorization.

| Imported sample | Result and remaining boundary |
| --- | --- |
| ArcGIS composite base | Original HTTPS sample TLS failure on both workstation routes; no successful HTTP response, cause unconfirmed |
| ArcGIS/Thunderforest overlay | HTTP disconnect before status, same-host HTTPS TLS failure; endpoint retirement not established |
| Google satellite mix | Direct HTTP200,104855B decoded512×512 JPEG; system-proxy route disconnected, Android/render alignment unverified |
| MemoMaps standard | Original HTTP disconnect on both routes, same-host HTTPS TLS failure; no template/retirement conclusion |
| Thunderforest terrain/contour | Existing exact-path probe fails; direct same-host different-path control also fails, not a complete exact-path direct result |
| Enterprise satellite/custom port | Original endpoint disconnect on both routes; same-host/same-port HTTPS TLS failure |
| MapBox proxy | DNS resolution failure in both observations; not proof of permanent service closure |
| Imported Tianditu variants | Provider403/301012; browser-path403/301007 domain mismatch. Registered built-in control works; keys not substituted |
| Tencent canonical | Original XYZ placeholder vs TMS real image; request adaptation188 + HTTP policy189 already installed-verified, retained |

Native errors now distinguish unresolved domain, TLS connection failure, timeout and generic failure by bounded exception type/cause inspection. No exception message, URL, host or credential enters the user status. Retry/cooldown/cache/success logic is unchanged; a TLS error is not automatically labeled as a handshake error.

The first86-case rerun exposed two existing transport-accounting races: response futures could resume `fetch` before the worker released its active permit. The worker now performs timing/state/permit cleanup before completing the response future. Both original assertions remain, without sleeps or relaxed conditions. The failed combined test/build log is retained; final86 cases passed and no artifact was delivered from the failed run.

## Delivery and installed validation

Issued APK165378621B, SHA256 `39bc685c882f673926ae03cae549a6fec78e03b26d53cefffe03b6c13c0aa7ca`. The immutable download was sent before runtime testing. TSC, fresh private web25.93s/1925 assets, final86 directed native cases and optimized build3m32s PASS. Original certificate,39 private seeds/registered Tianditu, CRC/unique entries,16KiB ZIP and64-bit ELF checks PASS; eight native libraries match189, unchanged legacy32-bit libraries are not a full32-bit16KiB claim. Pulled installed base APK matched the issued hash. Twelve final checks confirm formal and180–190 APK hashes unchanged; original OVMAP and ignored backup still match. Phone custom “增强” was neither read nor reset, and its phone backup/upgrade preservation is not claimed.

| Installed state | Result | Evidence boundary |
| --- | --- | --- |
| Single map, same82° scene | PASS:45 batches/source loads65, active preparation/assembly0, five samples unchanged, actual frames414 stopped | Map crop pixel-identical across33.781s; contours remain visible |
| Physical short pan | Camera changed, no new generation needed in nearby cached footprint | Not used alone as new-tile recovery proof |
| Focus moved to103.55E/29.52N at82° | PASS:45→57 batches,65→77 source loads, then five stable samples/active0 | Sixth sample was taken after return45 and is excluded, retained locally |
| Return45° | PASS:58 batches/source loads78, four samples stable/active0 | Budget-deferred far work can remain queued |
| Both maps at same82° fixture | PASS: camera payloads equal;77 cumulative batches/source loads149 stable over six samples; both actual frame counters stopped | Upper/lower crops pixel-identical across25.672s; primary layer queue and process-wide counters observed |
| Real secondary-map touch | PASS: native touch/render events and primary programmatic frames, primary adopts secondary camera | Not full touch or phone performance acceptance |
| Exit comparison | PASS: settled snapshot has one map, no compare-exit control, annotations0 | Immediate two-map post-click snapshot not counted as final |

The first dual attempt changed only the primary fixture, leaving the secondary at45°, and is excluded from same-angle acceptance. Gesture/gizmo attempts did not produce a sustained requested80° pose, so they are not counted as that acceptance. The final82° stress fixture sent the same pose through the installed trusted camera bridge to both existing map IDs, then checked both emitted camera payloads and actual screenshots. No GPS was injected. This does not prove every UI gesture reaches or retains82°. Pressure lowering requires an empty registered queue plus30s below the lower threshold during frame observations; there is no timer promise while idle. Far deferred entries do not consume a preparation/assembly slot.

Initial installation preceded the Android package service and failed; retry after boot readiness succeeded. SystemUI ANR was handled with Wait, not attributed to the target app. One malformed QA swipe used wrong coordinate field names and was rejected on a system-owned region; corrected native touch succeeded. Playwright CLI attach failed because WebView lacks Browser.setDownloadBehavior; scoped DevTools access to this owned WebView was used instead. These tool failures are not product PASS results. Final crash buffer was empty; this bounded session does not prove long-term stability.

[Private190 release](https://github.com/Siger1989/shantu-private-delivery/releases/tag/v0.2.190-private): PRIVATE checked before/after upload, all five server digests and full downloads matched, APK CRC PASS, anonymous HEAD404. APK/integrity/install/manifest attachments remain immutable initial-delivery snapshots; this document and mutable release notes carry subsequent findings. Sanitized numeric evidence: [190 summary](../artifacts/performance/contour-source-190-20261108/summary.json). Raw screenshots, credentials, provider imagery and decompiled code stay local/ignored.

Official Ovi Windows10.7.5 installer and embedded executable signatures were verified. Windows installation remains incomplete: capture timed out/input geometry unavailable and user manual operation deferred; its configured installer remains available. Running SDK/MuMu serially then allowed the owned clean MuMu4 API32 ARM bridge to install and launch the original official ARM APK. It stopped at the first Android privacy agreement, distinct approval pending, and is now stopped. Existing MuMu0–3 were not changed. No live same-file Ovi rendering or HTTP capture is claimed; no login, GPS grant, purchase, CA installation, certificate bypass or APK modification occurred. See [Jilin research](ovmap-jilin-research-20261108.md).

Owned QA helper, ADB forwards23458/23459 and SDK AVD are stopped; MuMu4 is stopped. Preexisting private preview remains running. No user data or source configuration was cleared. OPPO Find X8, phone FPS/memory/loading speed, long sessions, all sources/regions and full390/360 UI matrix remain unverified. HarmonyOS native HAP is undelivered. Marker-back/2D-lock pending feedback is outside this patch. Save drafts/end recording, then overwrite-install 山兔·优化; do not uninstall or clear data. Formal 山兔 is separate.
