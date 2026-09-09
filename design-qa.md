# Marker windows 0.2.15 visual QA

final result: passed

Scope: the confirmed summary v2 and editor v3 implemented in the existing map application. This is browser acceptance; Android physical-device touch, keyboard, GPS and performance remain untested.

## Evidence and normalization

Source: docs/visuals/marker-level-one-preview-v2.png and marker-{basic-compact,position-matrix,data-dense}-v3.png. Images are 853x1844; the mock's phone content is cropped at (30,119)-(822,1832) and normalized to 390x844 CSS pixels. Actual screenshots are 390x844; narrow screens are 360x780, and keyboard simulation is 360x430. All screenshots are inspected at 1x density. The generated mock includes illustrative map imagery, tools, weather and sample values; those are not live-data visual requirements.

Full-view plus focused comparison boards were opened and inspected together:
- artifacts/screenshots/marker-compare-0215-summary.png
- artifacts/screenshots/marker-compare-0215-basic.png
- artifacts/screenshots/marker-compare-0215-position.png
- artifacts/screenshots/marker-compare-0215-data.png

Actual captures: artifacts/screenshots/marker-{summary,basic,position,data}-0215-{390,360}.png. Position screenshots use a model for actual XYZ support; summary/basic/data use the saved QA sample pin at 390 and model at 360. Model-only size options at 360 are an intentional object-type difference. Focused regions on the boards inspect the app-owned card, labels, buttons and axis colors, in addition to the full map layout. Source drill icon and runtime sample icon are distinct selections of the existing icon system; no replacement icon system was invented.

## Findings and fixes

- P1, fixed: identical sibling React keys on AnnotationWorkspace and ObjectGizmo caused accumulating duplicate panels during map camera updates. Reproduced in both development and production. Unique namespaced keys fixed it; production DOM confirmed one workspace and one gizmo. Later actual keyboard-controlled gizmo movement and camera zoom kept one workspace.
- P2, fixed: draft position headers repeated for each row. The final layout shares X/Y/Z headings above metre/degree rows, with six independent resets on models.
- P2, fixed: initial data panel exceeded the project's 38dvh/320px editor limit. It now scrolls internally, retaining the top bar. Measured 390 card height320; 360 position width286/height177; no horizontal viewport overflow.
- P2, fixed: reducing the viewport could leave the focused note below the scroll viewport. Resize handling now scrolls the active input into view. Post-fix screenshot artifacts/screenshots/marker-keyboard-0215-360.png shows the note and Save together; card y56..219.39, note y168..212 at 360x430. Save succeeded afterward.

No actionable P0/P1/P2 findings remain within this scope.

## Required fidelity surfaces

- Fonts/typography: retain the application's sans-serif Chinese fallback, compact 13px fields and 16px summary heading. Source mock text is readable at normalized size; runtime text remains readable with truncation for long titles. Numeric units and labels remain distinct.
- Spacing/layout: compact one-row editor header, inline name, adjacent icon/color selectors, paired axis rows, dense properties. Root at top56/left8, clear of right tools and bottom navigation. Runtime 44px action heights intentionally exceed smaller raster mock hit areas. This preserves touch targets; five properties plus notes may require internal scrolling under the height cap.
- Colors/tokens: warm white panel, dark teal primary action, muted borders, red/green/blue axes aligned with the existing gizmo. Focus outlines remain visible.
- Image quality/assets: app and Android use the supplied 1254x1254 rabbit/mountain-road PNG without changing shape. Existing map/marker/gizmo assets are reused; actual imagery/weather replaces illustrative mock content. APK native-logo pixel identity separately checked.
- Copy/content: summary/Basic/Position/Data/Save structure matches the confirmed flow. Runtime shows true coordinates or cached location and actual/missing elevation; no mock temperature or geological field values enter product defaults. Fixtures remain only in isolated local test storage.

## Interaction checks

Storage failure preserves draft and original stored record; restoring storage and retrying succeeds. Unsaved selection change offers save/discard/continue; discard restores prior data. X reset leaves Y20 unchanged. Actual gizmo keyboard movement changed X to2m; Z ring keyboard movement changed rotation to6.01 degrees; reset restored the respective field. Delete cancellation, complete details, navigation and Return to marker were checked. Production after the key fix has one card/gizmo. App console checked with no errors at final interaction checkpoint.

341 logic tests and final types pass. Temporary QA entry files were removed before final builds. Final extra regression keeps a draft visible when an external window deletes its source; it uses the same window layout.

## Follow-up polish and limits

P3: raster-reference spacing is slightly denser; retain current touch dimensions and scroll cap. Native soft-keyboard timing, real pinch/touch gestures, installation, GPS and performance still need device testing. Browser viewport emulation is not native keyboard/device acceptance.
# 导航选点、地点箭头与搜索框 · 0.2.16（2026-09-09）

- 390×844、360×780：导航选点状态面板持续可见；选点提示、取消、当前起终点或途经点可达；地图拖动不关闭。标记点击填入名称，空白地图保留自由选点，取消/Escape保留地址；关闭后标记摘要/编辑正常。
- 长路线10行地址切换首尾：360视口面板y56..352.4，提示y106..157；起点y157..202、终点滚动后y298..343，可达且无横向溢出。普通地点箭头尖端对应地图锚点，名称容器与箭头分离，未改模型顶部投影。
- 两尺寸顶部真实成都搜索结果实色rgb(247,248,243)、backdrop-filter=none；明确分隔线、两行名称/地址，不透底图。路线搜索结果同步用不透明底。
- 关键截图：artifacts/screenshots/navigation-pick-390-0216.png、navigation-pick-360-0216.png、navigation-search-390-0216.png、navigation-search-360-0216.png。已目视核对；未进行Android真机触控验收。
