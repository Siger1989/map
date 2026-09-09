# 地点标记一级摘要卡 · 效果预览 v1

- 用户已确认：一级为名称、简短位置、海拔及“导航 / 编辑 / 详情”，首层无需滚动。
- 用户进一步要求：**每次先给当前层级的效果图，确认这一层后再进入下一层**。此图等待用户确认；不开始二级设计或业务实现。
- 生成方式：内置 image_gen，以本次 390×844 手机预览截图为参考。图中的卡片为拟议方案，整体为生成式视觉预览，不是已经运行的新界面；地图与其他控件的生成细节不作为实现规格。
- 本图仅评审上方白色摘要卡：名称与关闭、位置与海拔、三个常驻按钮；不显示滚动条、表单页签或三维操作参数。
- [效果预览](marker-level-one-preview-v1.png)
- [层级讨论记录](../marker-ui-hierarchy-2026-09-09.md)
- 没有修改应用业务、安装包或数据，没有执行新一轮业务测试。

## 生成提示词

```text
Use case: ui-mockup / compositing.
Input image 1 is a CURRENT REAL screenshot of the 山兔 outdoor map app at exactly 390 × 844 CSS pixels. Use it as the only reference for the existing app, map, palette and typography.
Create ONE finished design preview image for ONLY the first-level marker SUMMARY CARD, according to the user-approved hierarchy. No alternative versions, no second-level editor, no details page, no side-by-side variants. The user will confirm this first level before further design. The design is proposed, not implemented.

DELIVERY COMPOSITION:
A clean portrait presentation image on white. At the top, a small understated title "一级 · 标记摘要卡", below it the small note "效果预览 · 尚未实施". Beneath this, ONE large flat app viewport at the exact 390:844 aspect ratio. Make the app viewport fill nearly the entire available height and as much width as allowed by this aspect ratio. It should be large and readable. No perspective, no physical phone bezel, no tilted screen, no duplicate enlarged screenshot, no caption diagram, no decorative background. If the output canvas is 1024 × 1536, make the viewport about 620 × 1342 centered, leaving a modest title margin. The user needs to see actual mobile spacing.

KEEP FROM THE REFERENCE:
Preserve the satellite map location and imagery as shown, including its current imperfect detail. Preserve the existing top search header, right-edge vertical map tools, lower-right circular camera control, bottom navigation and bottom-left weather tile. Do NOT invent buildings or roads. Keep the selected map pin label for "验证采样点" in its current geographic screen position. Keep the map-first proportions and the current understated pale ivory / muted teal interface style. Do not create a new app-wide visual design.

REMOVE ONLY THE OLD SELECTED-OBJECT EDITING UI:
Remove the lower-left old object toolbar/panel (with 验证采样点, 详情, X/Y rotation fields, 撤销, 归正, 回到对象) completely, replacing it with the underlying map appearance.
Remove the red and green X/Y transform axes and the associated transform handles/arrows from the selected marker.
This preview is an ordinary point SUMMARY VIEW, so no rotation controls, no coordinate inputs, no selection dropdown, no edit tabs, no sliders or keyboard.

ADD THE NEW FIRST-LEVEL SUMMARY CARD:
Place a small compact card in the UPPER-LEFT just below the search bar, matching the reference app's existing popup location, at approximately x=8, y=60 within the 390×844 viewport. Its width must be about 304 CSS px, leaving the right map toolbar completely unobstructed. Height about 148–160 CSS px; substantially shorter than the current bulky 320px form. Subtle warm-white opaque surface, thin quiet border, gentle small shadow, 8–10px corner radius. About 10–12px internal padding. All content fits without any scrolling, overflow, bottom clipping or hidden actions. No vertical scrollbars.
Hierarchy inside the card, top to bottom:
1. A single title row: on the left the same drilling-point icon concept seen on the existing label, then exact title "验证采样点" in readable dark text. On the far right a simple X close icon with a generous 44×44 CSS px touch target. No generic "标记与模型" title above it, no back-to-list link, no dropdown, no secondary toolbar. This IS the title.
2. One compact metadata row: left exact text "成都 · 黄田坝街道"; right exact text "海拔 545 m". Muted but readable, not tiny. This is a summary only; DO NOT add full coordinates, full administrative address, description, attributes or notes.
3. One fixed row of exactly THREE equally sized action buttons in this exact left-to-right order:
"导航" — navigation arrow icon
"编辑" — pencil icon
"详情" — document/info icon
Buttons minimum 44px CSS height, with distinct padded hit areas, icon + label arranged cleanly; "导航" may be a calm dark teal/green filled primary action with white text, while 编辑 and 详情 are light neutral bordered buttons with dark text. Use the existing visual language and restrained contrast. These three actions must be entirely visible at once, no horizontal scrolling and no extra overflow menu.

IMPORTANT:
Only these exact card words: "验证采样点", "成都 · 黄田坝街道", "海拔 545 m", "导航", "编辑", "详情". No invented values, no coordinates, no extra instructional text in the app.
The close X is not a fourth action in the button row.
The map pin and summary card must not accidentally imply they are the same physical object; the card is a fixed app panel at upper left, no giant speech-bubble tail.
The rest of the viewport remains spacious map canvas. This image must make it immediately clear that a user can read the summary and press an action without scrolling.
Render all Simplified Chinese perfectly, crisp typography, proportionally correct mobile controls, excellent legibility. No watermarks. No implementation claims. Only this first-level design preview.
```
