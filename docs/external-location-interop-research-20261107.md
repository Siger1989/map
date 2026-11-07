# External place interoperability — 2026-11-07

Scope: read-only investigation against issued0.2.183-test/code190 (`com.shantu.oldengine`, source `be49551`), the user's Google sample, and the current official WeChat Android package. This document does not add an integration to the immutable183 APK. No WeChat installation/account access, package impersonation or modification of third-party software.

## What183 actually receives

`mobile-native/hybrid/src/main/AndroidManifest.xml` registers `ACTION_SEND text/plain`, `ACTION_VIEW geo:` and the exact HTTPS Tencent marker path. `MainActivity` forwards incoming text/URI through `IncomingPlaces`; `modules/incomingPlace/parser.ts` accepts only a coordinate-bearing geo URI or a single `https://apis.map.qq.com/uri/v1/marker` URL. Tencent-declared GCJ-02 coordinates are converted through the existing coordinate adapter. Arbitrary names/URLs are not silently geocoded.

`IncomingPlacePrompt` confirms a real parsed place. Its existing navigation callback saves a named marker and sets the route destination before the user confirms the route; simply receiving an untrusted Intent does not write a marker. These capabilities do **not** prove that WeChat's internal navigation chooser dispatches to this receiver.

The user reports that WeChat 地点→导航 still omits 山兔. Treat that exact device behavior as unresolved; the phone's WeChat/Android/ColorOS versions and actual outgoing Intent have not been captured. Registering another generic intent filter alone is not a verified fix. Android distinguishes an implicit system resolver from explicitly targeting an app/component: see [Intents and intent filters](https://developer.android.com/guide/components/intents-filters).

## Google sample

The user's `maps.app.goo.gl` sample was fetched through normal public HTTPS after the web reader could not open it. It returned302 to an official Google Maps place URL, then200. The path provided a place title (Bou Sra) and an explicit destination coordinate pair in `!3d…!4d…`; this is stronger than a map-camera `@lat,lon` center. Raw sample and redirect/tracking URLs remain local in ignored `.openai/183-google-resolve.json`; they are not committed.

183 does not parse Google Maps long URLs, short links or Place IDs. A later implementation can reuse the existing incoming-place/marker/navigation pipeline after bounded native HTTPS short-link expansion and strict host/coordinate validation. Prefer actual place coordinates; never silently treat viewport-only coordinates, a search name, or a Place ID as a resolved destination. Conflicting/multiple place coordinates must be rejected or explicitly disambiguated. Name/Place-ID-only resolution requires an available service and a real result, otherwise show the limitation.

Google documents place search and directions parameters in [Maps URLs](https://developers.google.com/maps/documentation/urls/get-started). Registering a Google HTTPS filter does not make 山兔 the verified owner of Google's domains; use the Android share target as the reliable intended entry, and test web-link defaults separately ([Android App Links](https://developer.android.com/training/app-links/create-deeplinks)).

An emulator `ACTION_SEND` test for the sample was automatically rejected before execution. It was not retried through another mechanism. Source/HTTP evidence is not an Android system-share acceptance result.

## Amap route links

Existing outgoing `modules/routeShare/data.ts` uses `https://uri.amap.com/navigation` with endpoints/mode; this asks Amap to calculate a route. Incoming Amap place/route links are not parsed in183. The [official URI route parameters](https://lbs.amap.com/api/uri-api/guide/travel/route) specify endpoints, an optional via point and routing options, not a full road polyline. Endpoint/waypoint extraction followed by 山兔 replanning must be labeled as replanning, not importing Amap's identical route geometry. Actual GPX/KML/track files can preserve geometry through the existing file-import path. No user Amap route sample has been provided for verification.

## WeChat static investigation

The [official WeChat website](https://weixin.qq.com/) supplied Android8.0.80/code3220, published2026-10-28. Its official CDN package was downloaded into a separate research directory,286319384 bytes, SHA256 `9d9b6c516e8e07e437c81485fde21fe13ce4f61b37d19e793fff40c71be39c0e`. `aapt2` independently confirms version/code and targetSdk34. This is the current official sample, not proof that the user's phone runs that version. Local cached REA6.8.0 used pinned JADX headless0.7.1 (JAR SHA256 `6e5eacf500b64292bfb73c49797c1958f6ee44646e43e868039ae7feb573ff75`). No third-party decompiled source or APK belongs in the project repository.

The initial name search found only `PoiNavigationAppSheetView$initView$7`, a nested scrolling class; the outer unmangled name was not found. It was not used to infer the provider filter. Root then mapped actual DEX method code, checked instruction boundaries and followed location menu construction `com.tencent.mm.plugin.location.ui.impl.e3.onCreateMMMenu` to `zi3.j.d`, and selection `f3.onMMMenuItemSelected` to `zi3.j.g`. A separate list-returning method `zi3.j.e(LocationInfo, boolean, boolean)` was investigated rather than assuming its two loops appended other apps.

**Confirmed filter:** REA/JADX returned the complete method body for `zi3.j.e` (`bodyStatus=available`, `fellBack=false`, reported1974 bytes); root personally read the local readable transcript of both branches and cross-checked the DEX string/invoke references. It builds a five-package list (Baidu, Amap, Google, Sogou, Tencent), queries `ACTION_VIEW geo:…` with `MATCH_DEFAULT_ONLY`, then returns only queried activities whose package is in that list. One Boolean changes Tencent ordering; the other selects ordered-map construction versus direct iteration. **Both branches filter to that list; neither appends arbitrary other geo handlers.** The real 山兔 package `com.shantu.oldengine` is absent. This is actual method/control-flow evidence, not merely a list of strings in the APK.

**Confirmed dispatch constraint:** `zi3.j.g(LocationInfo, LocationInfo, String, boolean, boolean)` also returned an available, non-fallback JADX body (reported3612 bytes). Root reviewed its local transcript and DEX invoke references: it chooses provider-specific intents for those five package names; an unsupported name leaves the Intent null, and `startActivity` is guarded by a non-null check. Adding a display-only candidate would therefore not create a generic dispatch fallback in this method. Local `*-normalized-result.json` texts are formatted readable transcriptions of REA's returned body (whitespace adjusted and a duplicate-block warning comment omitted), not raw byte-for-byte engine-output archives; APK and engine hashes bind the analysis input. This remains static analysis, not a captured WeChat phone session.

Root also read the **issued183 APK's** compiled manifest: `NativeReactActivity` is exported and has a separate VIEW/DEFAULT/BROWSABLE/geo filter. Thus the declared receiver is present in that artifact. It does not prove which APK the phone is running, system resolver visibility, or a WeChat navigation appearance result. The current official WeChat manifest includes map-package queries and a bare VIEW query; no package-visibility root cause is established from those declarations. Adding another generic 山兔 filter cannot override the confirmed WeChat method's explicit package test.

For this verified code path, direct appearance requires WeChat to support 山兔's genuine package; it cannot be completed unilaterally by modifying 山兔. No public provider-registration route was found in the targeted official-document search; lack of a search result does not prove no partner integration exists. The user screenshot includes a car-map entry not in this method's five-package list, so do not claim that the phone uses exactly this version/method without version/runtime evidence. The phone report remains unresolved, with a concrete third-party constraint now identified.

The independent alternative is a shared/copyable **coordinate-bearing location link → 山兔 import → named marker → route confirmation/navigation**. This needs Google/Tencent/Amap format/short-link work and real share testing;183 supports only the formats described above. A plain address/name is not an exact coordinate, and an unknown source's bare geo coordinates must not silently acquire a guessed coordinate datum. No new interoperability APK or speculative manifest patch was produced by this investigation.

Local-only evidence: `D:/ShantuEngineResearch/wechat-interop-20261107/zi3-j-e-normalized-result.json`, `zi3-j-g-normalized-result.json`, `wechat-navigation-static-evidence.json`, `method-refs-zi3_j.json`, `method-refs.json`, `manifest-tree.txt`, plus ignored `.openai/183-manifest-tree.txt`. Third-party method transcriptions/APK and tracking URLs remain out of Git.

## Acceptance required for later implementation

- Actual Android `ACTION_SEND` and warm/cold `ACTION_VIEW`, cancelled import and marker persistence, duplicate imports and source-CRS handling.
- User Google short URL plus explicit long place URL; offline/timeout/loop/host-change/ambiguous and viewport-only cases. No arbitrary URL fetching or invented destination.
- WeChat internal chooser appearance is a separate actual-WeChat test; a system share test or manifest match does not substitute for it.
- Amap place vs route: clearly show imported destination/waypoints, recalculation and unavailable original geometry.
- OPPO Find X8 remains disconnected. No physical-phone acceptance or updated interoperability APK has been produced by this investigation.
