# 标记编辑三页预览 v2（2026-09-09）

## 最新用户要求与状态

用户要求先讨论每项功能，再看效果。位置编辑以既有3D控制器为主，面板用于对应轴的数值微调，界面密集紧凑。资料页允许更大，以紧凑属性排布减少滚动。

用户进一步反馈位置初稿过大、空隙太多，明确**平移和旋转不必切换，应同时列出各轴对应数值**。本轮据此重做位置页。当前以下三页仍是等待确认的生成式预览，未实施应用代码。

| 预览 | 设计内容 |
| --- | --- |
| [基本页](marker-basic-compact-v2.png) | 名称、图标、颜色；移除底部说明，保持小面板。 |
| [位置页最新修订](marker-position-matrix-v2.png) | 保留现有3D控制器作为主要操作；面板只列X/Y/Z三列、位移m/旋转°两行。删除模式切换、步长、冗长说明、单独撤销/定位栏及大号坐标折叠行。 |
| [资料页](marker-data-dense-v2.png) | 更大的资料面板，属性名和值同行，五行属性与备注同时可见；字段自由编辑，没有固定值下拉框。内容已注明排布示例。 |

- X红、Y绿、Z蓝沿用现有 `modules/objectTransform/gizmoHandles.ts` 的轴色。面板同色列与地图轴对应，位移与旋转分别标米和度。
- 地图控制器与数值表应双向同步；本稿只是视觉与交互目标，尚未实现或测试同步。
- 源码目前普通pin只提供X/Y拖动，Z变换不会写入pin的中心海拔；模型具有XYZ/旋转/缩放能力。预览展示完整三轴候选布局，后续实施需按对象类型确认哪些轴可用；不能把图视为普通地点的Z拖动已实现。
- 位移0.00是拟议的本次编辑相对偏移，旋转0.0是角度读数示例。Z调整对象高度不应混同重写地形海拔。保存/放弃细节仍待确认。
- 用户允许资料页比位置/基本页更大；旧38dvh/320px限制仍用于一般编辑面板，资料页放大是本次明确要求下的专项方案，后续须检查右侧工具和底部导航避让。
- 图片已目视核对控件、文字、字段对应、无模式切换和可见内容；没有以生成图片宣称实际CSS尺寸、触控区域、键盘避让或真机检查通过。
- 使用内置 image_gen；地图及周边控件是生成式参考，真实应用数据与当前页面未修改。没有业务删除、新版本APK或部署。

## 提示词：基本页

```text
Create one proposed mobile UI design preview for the 山兔 outdoor mapping app using the supplied reference image. Preserve the same single portrait presentation and exact phone viewport aspect ratio 390:844. At the top outside the viewport use a clear title as specified below and subtitle "效果预览 · 尚未实施". Preserve the screenshot-derived satellite map, top search bar, right vertical map controls, bottom navigation, lower-right camera control and selected "验证采样点" map label. The imagery is a background reference, not an opportunity to invent geographic details. Use the same warm white surfaces, dark charcoal/teal text, muted teal primary action, thin borders and small 8–10px corners. Realistic compact mobile UI with good legibility, no unnecessary tall empty areas, no duplicate panels, no scrollers inside scrollers. Exactly ONE phone per image, no variants or screen collages. This is a design proposal, not code implementation or verified touch behavior. Use crisp accurate Simplified Chinese.
Common editor header: a left back chevron with comfortable touch target, title "编辑标记", right primary action "保存". Common second row is "基本" / "位置" / "资料", with only the current group active. Do not restore the first-level summary card or its delete/nav/details row beneath the editor. Values used for local-axis offsets below are explanatory zeroed preview values, NOT measured changes. Keep all scene content outside the specified panel modifications as similar to the input as practical. Do not add promotional text or unrequested functionality.
SPECIFIC VIEW: basic editor, compact refinement of the reference.
Presentation title "基本 · 名称与样式".
Replace the reference editor with a shorter compact panel at x≈8,y≈60,width≈304,height≈210–230 CSS px. Avoid changing the map scale.
Header and group-navigation rows as described. 基本 active.
After the tabs, use ONE inline row with left label "名称" and an editable field containing "验证采样点", comfortable 44px high.
Next use two compact aligned selectors side by side. Left label "图标" with the drilling-point icon + "钻孔" + chevron; right label "颜色" with a warm amber swatch + "琥珀" + chevron. Closed selectors, no galleries. Arrange their small labels neatly, preferably inline or closely above, without large vertical gaps.
No footer paragraph or helper sentence taking space, no large note block, no deletion, coordinates, model controls or metadata table in this group. The basic card must be genuinely compact, all fields visible with no scrolling. Preserve every existing main app control outside it. Only this screen.
```

## 提示词：位置初稿（被本轮反馈替代）

```text
Create one proposed mobile UI design preview for the 山兔 outdoor mapping app using the supplied reference image. Preserve the same single portrait presentation and exact phone viewport aspect ratio 390:844. At the top outside the viewport use a clear title as specified below and subtitle "效果预览 · 尚未实施". Preserve the screenshot-derived satellite map, top search bar, right vertical map controls, bottom navigation, lower-right camera control and selected "验证采样点" map label. The imagery is a background reference, not an opportunity to invent geographic details. Use the same warm white surfaces, dark charcoal/teal text, muted teal primary action, thin borders and small 8–10px corners. Realistic compact mobile UI with good legibility, no unnecessary tall empty areas, no duplicate panels, no scrollers inside scrollers. Exactly ONE phone per image, no variants or screen collages. This is a design proposal, not code implementation or verified touch behavior. Use crisp accurate Simplified Chinese.
Common editor header: a left back chevron with comfortable touch target, title "编辑标记", right primary action "保存". Common second row is "基本" / "位置" / "资料", with only the current group active. Do not restore the first-level summary card or its delete/nav/details row beneath the editor. Values used for local-axis offsets below are explanatory zeroed preview values, NOT measured changes. Keep all scene content outside the specified panel modifications as similar to the input as practical. Do not add promotional text or unrequested functionality.
SPECIFIC VIEW: position editor with a live-looking map controller and a compact numerical adjustment panel. This is the user's requested spatial-control concept.
Presentation title "位置 · 控制器与数值微调".
Panel at x≈8,y≈60,width≈304,height≈255–280 CSS px, avoiding right map toolbar. 位置 tab active. All panel controls visible without scrolling. No second floating object toolbar at bottom.
Immediately after tabs add a compact two-option segmented row: "平移 · m" active and "旋转 · °" inactive. The distinction is explicit: translation uses metres, rotation uses degrees. Show only the active translation values, not two full sets of fields.
Below, show EXACTLY three aligned numeric adjustment fields in ONE horizontal row, generous input height:
X label/edge in RED #ef5652 with value "0.00"
Y label/edge in GREEN #5fdf79 with value "0.00"
Z label/edge in BLUE #598fff with value "0.00"
Use neutral input backgrounds and colored small axis tags/edge strokes rather than large colored surfaces. Their digits remain dark and highly readable. All are relative movement offsets in metres from the beginning of the proposed edit; add the concise line "相对本次起点 · 米". They are not longitude, latitude or rotation angles.
Below add a single dense row with "步长" and a closed selector "0.10 m", plus quiet "撤销" and "回到标记" actions, cleanly distributed. Give each its own sufficient touch region without huge padding.
At the bottom a single CLOSED disclosure row "经纬度与海拔" with chevron, so absolute coordinate input is available on demand and not filling the current view.
Outside the panel, on the map at the selected marker's existing position, show ONE restrained compact XYZ translation controller anchored precisely on "验证采样点". Red X arrow points right, green Y arrow diagonally upper-left, blue Z arrow straight up. Three clearly separated colored lines and arrowheads, each explicitly labeled X/Y/Z; no overlap with the numeric panel or right tools. The axes must use the exact SAME red/green/blue as the three fields. Keep arrow extent restrained, about 60–80 CSS px from the marker, preserving map visibility. No 3D rotation rings, enormous handles, extra bottom panel or mysterious axes elsewhere. Highlight X subtly to indicate the chosen axis while leaving Y/Z visible. The data table and controller are matching views of the same proposed edit.
Current app only has X/Y translation for ordinary pins; this XYZ controller is an expressly proposed extension in a mockup, not a claim of existing behavior. Z means vertical position of the OBJECT, never rewriting terrain elevation. This distinction is for you to render correctly; do not dump technical warnings inside the app.
Use precise simplified Chinese labels and no extra controls or verbose instruction paragraphs. Only this normal position state.
```

## 提示词：位置紧凑数值矩阵修订

```text
Use case: precise-object-edit / ui-mockup.
Input image 1 is the full current proposed "位置 · 控制器与数值微调" screen. Input image 2 is the user's annotated crop with red arrows pointing out the unwanted translation/rotation switch and whitespace. The second image is FEEDBACK ONLY: never copy its annotation arrows, cropping or black margins into the result.

USER CORRECTION:
The numeric window is too large. The existing 3D map controller is the primary control. This window should ONLY show corresponding numerical readouts/fine adjustment inputs. Translation and rotation must be visible SIMULTANEOUSLY, with NO mode switch. Remove vertical gaps and waste.

MAKE ONE REVISED FULL PHONE PREVIEW:
Keep the same portrait presentation, 390:844 phone viewport, top title "位置 · 控制器与数值微调", subtitle "效果预览 · 尚未实施", underlying app, map backdrop, top search bar, right map controls and bottom navigation. Keep the selected marker and its map-centred 3D controller below the numerical panel, unobstructed. Do not produce multiple phones or a cropped screen.

REPLACE ONLY THE EDITOR PANEL WITH A MUCH SHORTER NUMERIC PANEL:
Place it at the same upper-left position below the app search bar, width about 304 CSS px, target height about 195–215 CSS px (roughly one quarter of the 844px viewport). It must be visibly much shorter than the original tall panel. Tight 6–8px outer padding and 3–5px internal gaps, compact rows, no large blank strips, no inner rounded cards.
Retain one compact header: back chevron on left, "编辑标记", right "保存" button.
Retain one compact group row: "基本" / "位置" / "资料", with 位置 active and no wide vertical gaps between the header, tabs and the matrix.
Then show ONLY a dense aligned numerical matrix. All fields simultaneously visible.
Matrix column headers from left to right: a narrow blank row-name column, then "X" in RED #ef5652, "Y" in GREEN #5fdf79, "Z" in BLUE #598fff.
Matrix first row: short left label "位移 m", three editable numeric fields "0.00" | "0.00" | "0.00".
Matrix second row: short left label "旋转 °", three editable numeric fields "0.0" | "0.0" | "0.0".
Use matching thin colored accents for ALL X cells in red, ALL Y cells in green and ALL Z cells in blue. Dark numerical text on neutral warm-white input backgrounds. No big colored blocks, no axis pills wasting extra width. The two data rows should be snug and aligned on the same three-column grid. Preserve comfortable touch areas for numerical fields while removing empty padding; no tiny unreadable numbers.
The height must come from these essential rows only. End the card immediately below the rotation row. NO footer.

REMOVE THESE ELEMENTS ENTIRELY:
- The "平移 · m" / "旋转 · °" segmented toggle.
- The separate "相对本次起点 · 米" explanation line.
- The step-size dropdown and "步长".
- "撤销" and "回到标记" from THIS numeric panel (those belong to the map controller).
- The large "经纬度与海拔" disclosure row.
- Any helper paragraph, extra title row, extra scrollbar or oversized spacing.
Do not move these removed controls into a new floating panel in this preview.

MAP CONTROLLER:
Retain a single familiar direct-manipulation 3D controller at the selected marker. Color coordinates consistently: X red, Y green, Z blue. The map's controller should visually support the existing integrated translation and rotation convention simultaneously, using compact axis arrows and thin restrained rotation arcs/rings; do not add move/rotate mode switches anywhere. Keep the controller within a compact region around the selected marker and out of the panel/right toolbar. Do not let it cover the numeric fields or create huge loops across the map. The actual direct controls, rather than this matrix, remain the primary interaction.
The numbers shown are zeroed proposed edit offsets and angular readouts, not new measurements. Do not print this technical note in the product UI.

The final screen should look noticeably denser and simpler, with most of the viewport remaining map. Perfect Simplified Chinese labels. No user red annotation arrows in output. No new functionality, diagrams, marketing text or implementation claims. Only this revised position page.
```

## 提示词：资料页

```text
Create one proposed mobile UI design preview for the 山兔 outdoor mapping app using the supplied reference image. Preserve the same single portrait presentation and exact phone viewport aspect ratio 390:844. At the top outside the viewport use a clear title as specified below and subtitle "效果预览 · 尚未实施". Preserve the screenshot-derived satellite map, top search bar, right vertical map controls, bottom navigation, lower-right camera control and selected "验证采样点" map label. The imagery is a background reference, not an opportunity to invent geographic details. Use the same warm white surfaces, dark charcoal/teal text, muted teal primary action, thin borders and small 8–10px corners. Realistic compact mobile UI with good legibility, no unnecessary tall empty areas, no duplicate panels, no scrollers inside scrollers. Exactly ONE phone per image, no variants or screen collages. This is a design proposal, not code implementation or verified touch behavior. Use crisp accurate Simplified Chinese.
Common editor header: a left back chevron with comfortable touch target, title "编辑标记", right primary action "保存". Common second row is "基本" / "位置" / "资料", with only the current group active. Do not restore the first-level summary card or its delete/nav/details row beneath the editor. Values used for local-axis offsets below are explanatory zeroed preview values, NOT measured changes. Keep all scene content outside the specified panel modifications as similar to the input as practical. Do not add promotional text or unrequested functionality.
SPECIFIC VIEW: compact dense custom data editor, allowed a somewhat larger panel than other groups so more attributes are visible at a glance.
Presentation title "资料 · 属性一眼看全".
Outside the phone, under the normal preview subtitle, add a very small tasteful note "属性内容为排布示例". The attribute values below are synthetic examples solely to demonstrate layout.
Use one panel at x≈8,y≈60,width≈304,height≈410–435 CSS px. This may be taller than the basic/position cards but must stay clear of the right toolbar and not reach the bottom navigation or camera control. A large useful part of the map stays visible. Not a fullscreen page or massive modal backdrop. No dimming veil over the map.
Header and tabs as described, 资料 active.
Below the tabs, a single compact header row "自定义属性 · 5" on the left, "+ 添加" on the right. The add action must be obvious and easy to tap. Do not put a huge primary add button on a whole extra row.
Then a dense, clean inline editable table of five rows. Two main columns: property name on the left (~32% width), property content on the right (~68% minus deletion target). Thin subtle dividers; each actual editable row about 44 CSS px high. Do not make each attribute a tall rounded card. No duplicated field captions on every row. A small muted trash icon at the right edge of every row, with sufficient touch hit area. All five rows must be simultaneously visible.
Exact example rows, in this order:
"编号" | "A-001"
"类型" | "采样点"
"岩性" | "砂岩"
"状态" | "待复核"
"来源" | "手动填写"
All fields look editable without heavy borders. Property names and values aligned to a clear grid, not stacked one above the other. No empty reserved attribute rows.
At the bottom, one compact inline row: "备注" and a low multiline input with placeholder "补充说明…", roughly one to two lines tall. Keep it visible in the initial view. A larger text editor may open later, but do not show any extra popup in this image.
No full administrative address, coordinate fields, elevation chart, file export, model dimensions, rotation values or help paragraphs in this data editor.
No scrollbars in this particular five-row preview; the real future implementation can scroll for much larger datasets, but don't falsely add a giant empty area. Prioritize readable real content density over shrinking text or touch targets. Only this one data screen.
```

## 提示词：资料自由文本修订

```text
Edit only the custom-attribute fields in the supplied "资料 · 属性一眼看全" mobile UI preview. Keep the entire composition, map, title, header, tabs, panel bounds, all five rows, row labels and values, trash icons, add button and notes field unchanged.
The five custom attributes must be FREE TEXT EDITING, not fixed dropdown choices. Remove the downward dropdown chevron from the right end of each of the five value fields ("A-001", "采样点", "砂岩", "待复核", "手动填写"). Preserve the same light outlined text input shapes and their values. Make each property-name label on the left ("编号", "类型", "岩性", "状态", "来源") also appear quietly editable, using only a very subtle pale underline or light field outline, without changing row heights or adding controls. The right-side trash icons remain separate. Keep all five rows and notes simultaneously visible, no scrollbars, no extra dropdown menus or added text. Do not change anything else. This is a small semantic correction to a design preview, not a redesign.
```
