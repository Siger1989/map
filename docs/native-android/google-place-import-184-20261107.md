# Google place import — 0.2.184-test

2026-11-07, W697. Isolated worktree `D:/ShantuEngineResearch/old-engine-20261105`, branch `codex/old-engine-tilt-dual-20261105`; application `com.shantu.oldengine` / 山兔·优化 / code191. The formal app,183 and all issued archives/data remain protected. User explicitly authorized implementation, private packaging and automatic named marker creation from a Google location share; WeChat work is deferred.

## Goal and resulting workflow

Google Maps → share a single place → select 山兔·优化 in Android's share sheet → bounded link expansion if needed → parse an explicit place coordinate → automatically save/select its named marker → 在山兔导航. Navigation uses the existing search quick-navigation/draft/route-confirmation flow and actual location/road services; receiving a share never invents a GPS fix or automatically starts recording/navigation.

The automatic save is limited to a valid Google place. Existing geo/Tencent receiving and manual confirmation remain. Same named coordinates reuse the existing marker; closing the incoming card keeps the saved marker. Failed storage leaves the received place available for an explicit retry and disables navigation until saving succeeds. Cold-start/import/reload/read-failure tests protect existing markers rather than clearing the store.

## Implementation boundaries

- `GooglePlaceLinkResolver.java`: exact HTTPS hosts/path validation, no credentials/nonstandard ports,8192-character bounds, single-location-link extraction. Only `maps.app.goo.gl` and legacy `goo.gl/maps/…` are fetched; Google Maps long URLs are returned without downloading pages. Redirects are manual and validated, at most5 hops,5s connect/read caps and a25s budget checked between operations; no unbounded HTML parsing or browser/JavaScript execution. Java/Android DNS/platform transport timing is not a phone latency guarantee.
- `IncomingPlaces.java` / `NativeBridge.java`: one bounded worker and queue, state/reason/title/retry token, foreground-only bridge access, cancellation on a newer share/dismiss/destroy and discarding stale results. Google text shares with a content-stream attachment remain file imports. Retry is explicit; no hidden retry loop. No marker storage or navigation logic in the receiver.
- `parser.ts`: `google.com/maps`, `www.google.com/maps`, `maps.google.com/maps`, and coordinate-bearing legacy `maps.google.com/?q=…`. A selected `/maps/place/…/data` pair, coordinate place path, coordinate query/search can produce a place. Path name wins; shared title/prefix can supply a name; a coordinate-only place is labeled Google 地点. Viewport `@/ll/center`, route URLs, unrelated tracking parameters, conflicting/multiple destinations and name/Place-ID-only links do not become invented coordinates. Other Google country-domain long URLs are not currently covered.
- `IncomingPlacePrompt.tsx` / `app/page.tsx`: visible reading/failure/retry states, strict parsed Google auto-save through existing `annotations.savePlace`, named marker persistence and duplicate handling. Foreground import focuses the map like an explicit search. 在山兔导航 reuses existing route selection/confirmation and preserves the established navigation-draft checks. No new geocoder or Google API key dependency.
- Hybrid manifest preserves `ACTION_SEND text/plain` and adds exact Google VIEW filters for explicit app choices. These are not verified ownership of Google's domains and do not promise that every Google link click bypasses a browser. Android's share target is the primary entry.

## Verification and delivery gate

The production Java resolver already expanded the user's actual short URL over public HTTPS in1639ms on this computer. The final URL was passed to the production TypeScript parser; exact name and destination coordinates matched the earlier sample evidence. Raw tracking URL and sample details stay in ignored local evidence, not public source or logs. This is a real Java/HTTP/parser result, not an installed Android share result or an OPPO speed measurement.

Targeted Node/component and Android unit checks, TSC, three-size actual-component screenshots, fresh private web/optimized APK, identity/signature/assets/CRC/16KiB checks and private delivery readback are recorded in the release document after they complete. Send the verified immutable APK before installing it, as requested. Phone acceptance remains separate; OPPO Find X8 is not connected.

Known boundaries: Google connectivity is needed to expand short URLs; only explicit-coordinate formats above are accepted; no name/Place-ID geocoding or import of Google's original route polyline. Region routing coverage/permissions remain those of 山兔's existing services. WeChat internal navigation list is not included. No renderer/dependency/material replacement, no public credential-bearing APK, no HarmonyOS native or AOD claim.
