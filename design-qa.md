# Route windows 0.2.14 visual QA

final result: passed

Scope: browser implementation and the requested route-window layouts. Android physical-device touch, GPS walking and performance acceptance remain untested.

## Evidence and normalization

- Confirmed source boards: exec-f5644e8d-0018-4fb4-bf47-d5c050b4bf20.png (navigation/editor), exec-f76af2d7-c837-4cd4-8dd0-1f322ffc7898.png (card/details), under the conversation generated_images folder. Later user screenshots and instructions explicitly supersede the larger card, rail placement, navigation mini-map and precision drawing interactions.
- Compared source and implementation together in artifacts/screenshots/compare-navigation-edit-0214.png and compare-card-details-0214.png, then compared the reported weather obstruction with both new sizes in compare-weather-preview-0214.png.
- Implementation runs the real app in an isolated localhost:9192 iframe at 360×780 and 390×844 CSS pixels. The outer natural viewport is 1280×720; iframe presentation scale is 0.82. Raw screenshots and DOM crop rectangles are retained alongside content crops. Comparison boards normalize image height for hierarchy review, not pixel-perfect scores. Reference boards include a phone frame and fictional route content; real fixture data, actual map imagery, absent photos and forecast/elevation loading states differ intentionally.
- Focused screenshots inspected: route-delete-0214-360.png, route-details-delete-0214-390.png, route-branch-precision-0214-360.png, route-branch-closed-0214-360.png, weather-preview-0214-360.png, weather-preview-0214-390.png. Earlier full navigation/elevation/reverse and both-size card/editor screenshots remain in the same folder.

## Findings and fixes

| Priority | Finding | Fix and evidence | Result |
| --- | --- | --- | --- |
| P1 | Different route clicks switched menu sets and hid navigation | Stable first card has navigation/marker/edit/details; map and favorites entry plus back/share/marker return checked; green position preserved | PASS |
| P1 | New branch used direct map clicks instead of established precision gesture | Reuses TrackDrawing and DrawingGestureBridge; screen finger at y218 produces the offset node at y182 in the 0.82-scale capture; next release snaps an old node and ends the branch; undo reopens it | PASS |
| P1 | Selected plan could differ from navigation geometry or reverse | Original/alternative distances and direction checked in UI; preferred-path, fixed destination and connected-only tests pass | PASS |
| P1 | Save failure could exit editing | Atomic edit commit; incomplete branch stays in editor; failure/conflict tests and UI error state checked | PASS |
| P2 | First card and wide progress lanes obstructed map | Compact one-row information, 6px visual lanes sharing 44px touch area; rail under search, dynamic clearance above bottom card; one progress component | PASS |
| P2 | Editor camera control overlapped bottom dock; sliders too short | ResizeObserver clearance; measured 16px gap and 44px slider targets at360; parameters remain visible | PASS |
| P2 | Start/end could not be located on map | Real route mini-map with green start/red end; same field colors, swapped markers and alternative shape | PASS |
| P2 | Dragging weather rail left a large centered card | Card moved beside the rail (x56,y90), width164, height124 at360 /123 at390; actual drag updates 99% to44% without moving the card; close/retry44px, no horizontal overflow | PASS |
| P2 | No deletion entry in details | Bottom deletion entry, route-name confirmation and cancellation/back; shares fixed header with back/share; photos/markers/source records not deleted | PASS |

## Verification boundary

332 logic tests, TypeScript, web build, APK build and independent asset/signature checks passed. Map imagery and live forecast/elevation may be unavailable with network/API failures; the UI shows unavailable/— rather than fabricated values. Loading and missing states were checked in the last pass; successful profile/reverse states were checked earlier in this implementation.

CUA connection briefly failed, then recovered after the preview server was restored; the last three changes were subsequently captured and exercised. No user route was deleted to test the deletion UI. Neither the user's9191 archive nor their active route was cleared or forcibly refreshed. No open P0/P1/P2 visual findings remain within this browser scope.
