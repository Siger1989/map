# A / TheTrail 紧凑 UI 验证

Date: 2026-09-07

## Source visual truth

- Source: https://dribbble.com/shots/26674669-TheTrail-Travel-App-Hiking-Mobile-Dashboard
- Viewed image: https://cdn.dribbble.com/userupload/45391052/file/b05f6bab0b26c8595b0bd0a328940c16.jpg
- Local capture: `artifacts/screenshots/reference-thetrail.png`, 1280×720 pixels, browser viewport 1280×720 CSS pixels; the source is a three-phone presentation board. Its device-frame sizes are not production viewport requirements.
- User-selected adaptation: compact Chinese map workspace, small text, maximum map area, existing green camera. Intentional differences: no oversized discovery cards, photo map substitute, fake device chrome, TheTrail logo, or blue recoloring of real terrain.

## Implementation evidence

- `artifacts/screenshots/ui-a-preview.png`: 598×628 pixels / CSS viewport, real mountain map, route panel and original camera.
- `artifacts/screenshots/ui-a-layers-final.png`: 1280×720 pixels / CSS viewport, compact layer rows, blue expanded layer control.
- `artifacts/screenshots/ui-a-annotations.png`: 1280×720, corrected annotation controls.
- `artifacts/screenshots/ui-a-photos.png`: 1280×720, photo import empty state.
- Full-view comparison: source board and final layer screenshot emitted and inspected together. Both show light floating surfaces, compact dark text and blue accents over terrain. The implementation deliberately reduces panels to task controls rather than copying source marketing proportions.
- Focused comparison: inspected panel headings, field rows, layer switches, selected navigation and original camera in full-resolution captures; no raster asset replacement was introduced.
- Density: normal captures are compared at CSS size. `ui-a-route-390.png` is rejected as visual acceptance evidence: the image is 390×844 but content is compressed into roughly 191×414 while DOM viewport is 390×844. No upscaling or cropping was used to pretend it passed. Temporary overrides were reset and original tab confirmed 598×628.

## Fidelity surfaces

- Typography: system Segoe UI / Microsoft YaHei fallback retained for Chinese. Typical labels and titles 12–13px, numeric summary 14–18px, weather temperature 28px. No attempt to claim matching the reference's unverified font family. Wrapping and truncation reviewed; route inputs measured 13px.
- Layout: single compact heading, route modes directly below it, one scrolling content region; 16px panel radii and 18px chrome radii. Layer rows measured approximately 45px including separator; switching targets remain 44px. 390 layer panel 304×320; 360 route panel roughly 286×343 with a via point.
- Colors: blue #2452e8, foreground #1c2940, muted #59677d, light panel rgba(248,250,255,.97). Blue is inferred from the source direction, not claimed as an exact pixel sample. Opaque-enough surfaces keep labels readable on terrain. User object colors and green camera retained.
- Assets: real map and existing Lucide controls remain. No new raster assets, CSS imitation artwork or replacement logos. No screenshot assets shipped in the app.
- Copy: existing Chinese actions retained; long layer descriptions move to an expandable section. Satellite capture date remains next to an enabled satellite row; source information remains accessible.

## Interaction and responsive checks

- PASS: route ⇄ track header navigation, add via point, existing input and sorting handles remain; Escape closes panel.
- PASS: terrain slider disappears when terrain off; weather opacity appears with clouds and disappears after disabling; settings restored. Source explanation expands, compact source entry opens source management.
- PASS: collections empty state, annotation browse, trip photo empty state and tool navigation render.
- PASS: 390×844 and 360×780 document scrollWidth equals viewport width; right tools and camera remain outside route panel. 360 annotation buttons measured 44px high. Last width refinement gives the annotation panel the same compact width formula as other panels.
- PASS: inspected browser error log returned no errors (last 5 requested); no claim about network availability or all-time console history.
- PASS: TypeScript, 217 existing tests, web and Android web-resource builds. Existing bundling warnings remain.
- BLOCKED: reliable full-size screenshots at the required phone sizes and real-device touch acceptance. Normal screenshots cannot substitute for those.

## Findings and iteration history

1. [P1, resolved] Annotation buttons inherited dark text over old dark backgrounds. Added scoped light button/card styling. Post-fix `ui-a-annotations.png` shows dark text on light controls; measured rgb(28,41,64) over rgb(234,240,249).
2. [P2, resolved] Expanded layer entry kept its old dark-green background with blue text. Added explicit expanded/pressed state rules. Post-fix `ui-a-layers-final.png` shows white icon/label on blue.
3. [P2, verification gap] Phone-size screenshot compositor reports the correct viewport but captures scaled content. Fresh tab and documented viewport/reset APIs did not fix capture. Stopped retrying the same diagnostic; normal viewport restored. This is a testing blocker, not a confirmed app overflow.

## Implementation checklist / remaining work

- Implement selected compact visual direction: done.
- Preserve camera and existing business logic: done; no rendering or storage changes.
- Fix observed contrast issues: done.
- Build and commit source with current limitations: done in this delivery flow.
- Recheck 390×844 and 360×780 on a functioning capture surface or phone: pending.
- Static APK flicker diagnosis and new APK release: separate follow-up, not claimed complete here.

final result: blocked
