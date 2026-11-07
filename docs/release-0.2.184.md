# 0.2.184-test — Google place sharing

Target `com.shantu.oldengine` / 山兔·优化 / code191, isolated branch `codex/old-engine-tilt-dual-20261105`. User authorized Google-only place sharing, automatic named markers, existing 山兔 navigation and a private installable package. Formal166,183 and existing data/signing/private Tianditu remain protected. WeChat is deferred.

Implementation and boundaries: [Google place import](native-android/google-place-import-184-20261107.md).

Current status: implementation merged in the isolated working tree; targeted compilation/checks and private packaging are in progress. No184 APK has been issued yet. Exact artifact identity, checks, delivery and subsequent APK runtime results are appended only after completion.

Pre-package checks:38 targeted Node cases and12 fresh Robolectric cases PASS; TSC and fresh private web build PASS. Actual Java short-link expansion plus TypeScript name/coordinate parsing matched the user sample; raw sample URLs remain ignored. Actual shared-component Playwright checks at390×857,360×780,390×480 passed saved/loading/failure/retry/invalid states and the exact navigation callback. Saved card155.375px high,298/268px wide,14px font and44px buttons; no outer clipping or ordinary content scroll. Root reviewed saved screenshots at all3 sizes and failure state. The QA map/share bridge/navigation callback are synthetic and explicitly labeled; this does not replace installed APK/system share/phone acceptance.

Native checks cover exact URL hosts/paths/credentials/ports/length, relative and cross-domain redirects, loops/hop limits, retryable HTTP/timeouts, same-token retry, replacement/dismiss/close stale-result suppression, Google+document file precedence and title selection. JS/component checks cover parser ambiguity/viewport/tracking/route rejection, original geo/Tencent behavior, real named-marker storage/duplicate handling, storage errors and preservation of an existing marker, remount without duplicate writes, and existing quick-navigation/draft behavior. No full-project or unrelated renderer/performance acceptance is claimed.
