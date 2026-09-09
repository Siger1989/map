# 标记编辑三页预览 v3：统一压缩与逐数值回正

用户最新要求：其他页也减少空隙、缩小窗口；位置页的每个数值带独立回正，并进一步压缩顶部的重复结构。此前v2保留为讨论历史，本次以v3为当前候选。

## 三张当前候选

- [位置：两行数值，各自回正](marker-position-matrix-v3.png)。X红/Y绿/Z蓝三列，位移m和旋转°两行同时可见；每个数值右侧一个独立回正图标，共六个。既有3D控制器仍为主要操作，不增加平移/旋转模式切换。
- [基本：名称与样式](marker-basic-compact-v3.png)。名称标签与输入同行，图标与颜色两个收起的选择器并排；删除独立标签行和说明空白。
- [资料：密集属性](marker-data-dense-v3.png)。五行示例属性和备注直接可见，属性名和值均自由编辑。缩短备注区，减少行间空白，资料窗仍可比基本/位置稍大。

三页统一将顶部合成**返回 / 基本 / 位置 / 资料 / 保存**一行，去掉重复的“编辑标记”标题与独立页签排。该压缩方式为最新效果提案，等待用户确认。

## 回正语义与实施边界

- 每个回正只作用于对应字段/轴，不批量归零其余数值。
- 位移按本次编辑起点定义相对偏移，回正该轴即恢复该轴的零偏移；不是把经纬度改为0。
- 旋转该轴回正为0°。位移和旋转的单位必须保留，不混用米与度。
- 当前效果图展示完整XYZ候选数值；现有普通pin仅开放X/Y拖动，模型有完整三轴能力。未来要按对象类型定义Z/旋转可用性，不能从本图宣称普通点三轴已实现。
- 用户要求保留既有控制器作为主要交互，本稿只改面板组织与数值微调入口。避免另造一套控制器。
- 保存/放弃及与地图预览同步仍需要实现前讨论，本次没有将当前即时保存的代码改成草稿机制。
- 密集排布主要通过删除重复结构、压紧边距实现；实际输入框、回正按钮触控区域与键盘避让需在真实页面测量，不能根据生成图宣称44px触控或真机验收通过。

## 制作与验证

内置image_gen以上轮图片和用户批注为参考生成。已目视核对：三页均为单行顶部；位置有6个独立回正图标、两行三列以及相同轴色；基本两行主要内容；资料五个自由文本属性行、删除入口和备注，无误用下拉箭头。图片均保存为项目文件。

仅新增视觉预览与说明、更新交接文档。无业务代码修改/删除、无用户数据变更、无新APK或部署。右侧手机比例应用保留。用户尚未最终确认这些编辑页面，不自动进入下一层或开始代码实现。

## 位置页提示词

```text
Use case: precise-object-edit / compact mobile UI.
Edit the supplied FULL phone design preview in place, preserving the map, app chrome, bottom navigation, right-side controls, selected map label, full phone proportions 390:844, colors, typography and every function unless specifically changed below. The external presentation title and subtitle "效果预览 · 尚未实施" stay visible. One single full phone image, no variants or comparison collage. This is a design proposal only.
The user says ALL editor groups waste too much space, especially in the header. Make the panel noticeably tighter and shorter, removing redundant structure, not making all text microscopic. Preserve warm white surface, thin borders, restrained dark teal and 8px corners. Panel remains upper-left below search, ~304 CSS px wide, clear of right map tools.
ESSENTIAL SHARED CHANGE:
Replace the old two separate rows (back + "编辑标记" + save, then Basic/Position/Data tabs) with exactly ONE compact unified top bar:
back chevron | "基本" | "位置" | "资料" | "保存"
Remove the redundant internal title "编辑标记" entirely. Keep "保存" as a small dark-teal primary action at right. Each group label is compact and readable; active group has a subtle teal underline or text. This bar should be about 44 CSS px high, with narrow gaps and no oversized padding. Keep the back control and save independently accessible. DO NOT add another header, title, subtitle, tab row or decorative divider block inside the panel.
The content begins immediately below this unified bar with just 3–4px gap. Panel padding 6–8px, gaps 3–4px. No nested card shadows. End the panel immediately after the essential last row. Preserve usable text and touch targets; density must come from removing blank space and duplicate UI.
Do not add extra explanatory captions or rendered annotations. If additional reference images contain user red arrows, they are feedback only and must not appear in the result.
POSITION VIEW:
External title remains "位置 · 控制器与数值微调". "位置" active in the unified top bar.
Keep the existing two-row XYZ numerical table, but tighten the blank space above its colored column labels and between its rows. Column header X red #ef5652, Y green #5fdf79, Z blue #598fff. Keep left row labels "位移 m" and "旋转 °". Values in position row "0.00", "0.00", "0.00"; in rotation row "0.0", "0.0", "0.0". Colors match the map controller.
NEW REQUIRED FUNCTION: Every one of the SIX numeric fields includes its OWN small counterclockwise circular-arrow RESET icon on the RIGHT side INSIDE that field. Exactly SIX reset icons: X/Y/Z position and X/Y/Z rotation, one per cell. None may be missing. Keep the number on the left/center and the thin reset icon at the right. Use the cell's axis color or dark neutral for the icon; do not render a giant full-height reset button. Give sufficient separation from the digits to make them readable. Do not replace the unit or numeric value with an icon. No separate global reset row or toolbar.
The reset affects only that individual field/axis. Position reset restores zero offset from the current edit's starting point; rotation reset returns the chosen axis to zero degrees. Do not write these implementation explanations in the app or change values.
Desired whole panel height only ~155–170 CSS px, not a large card. Single header ~44px + colored column labels ~16px + two compact comfortable value rows, minimal outer padding. It should look visibly reduced from the provided image.
Keep the map's familiar integrated XYZ translation/rotation controller with arrows and thin rings, below the panel and unobstructed. No move/rotate switch, step selector, coordinates drawer, helper text or footer. The numeric panel is only a dense fine-adjustment surface.
User feedback reference images show where the excessive header blank space used to be. Remove that waste, never copy the red arrows.
```

## 基本页提示词

```text
Use case: precise-object-edit / compact mobile UI.
Edit the supplied FULL phone design preview in place, preserving the map, app chrome, bottom navigation, right-side controls, selected map label, full phone proportions 390:844, colors, typography and every function unless specifically changed below. The external presentation title and subtitle "效果预览 · 尚未实施" stay visible. One single full phone image, no variants or comparison collage. This is a design proposal only.
The user says ALL editor groups waste too much space, especially in the header. Make the panel noticeably tighter and shorter, removing redundant structure, not making all text microscopic. Preserve warm white surface, thin borders, restrained dark teal and 8px corners. Panel remains upper-left below search, ~304 CSS px wide, clear of right map tools.
ESSENTIAL SHARED CHANGE:
Replace the old two separate rows (back + "编辑标记" + save, then Basic/Position/Data tabs) with exactly ONE compact unified top bar:
back chevron | "基本" | "位置" | "资料" | "保存"
Remove the redundant internal title "编辑标记" entirely. Keep "保存" as a small dark-teal primary action at right. Each group label is compact and readable; active group has a subtle teal underline or text. This bar should be about 44 CSS px high, with narrow gaps and no oversized padding. Keep the back control and save independently accessible. DO NOT add another header, title, subtitle, tab row or decorative divider block inside the panel.
The content begins immediately below this unified bar with just 3–4px gap. Panel padding 6–8px, gaps 3–4px. No nested card shadows. End the panel immediately after the essential last row. Preserve usable text and touch targets; density must come from removing blank space and duplicate UI.
Do not add extra explanatory captions or rendered annotations. If additional reference images contain user red arrows, they are feedback only and must not appear in the result.
BASIC VIEW:
External title remains "基本 · 名称与样式"; 基本 active in the unified top bar.
Use ONLY TWO compact content rows:
Row 1: small inline label "名称" on the left, then a single-line editable field "验证采样点" filling the rest of the width. Label and input on the SAME ROW, not a separate label row.
Row 2: two equal compact closed selectors side by side. Left shows drilling icon, "钻孔", small chevron. Right shows warm amber color swatch, "琥珀", small chevron. Small inline labels "图标" and "颜色" may appear inside/at the leading edge of each selector, but DO NOT add separate label rows above them. Clear spacing so text does not collide.
Desired entire panel ~135–150 CSS px tall, only the unified top bar and those two content rows plus minimal padding. No notes, unused footer space, nested cards or extra title. Keep both selectors closed. The map is dominant. All words and existing functions remain legible.
```

## 资料页提示词

```text
Use case: precise-object-edit / compact mobile UI.
Edit the supplied FULL phone design preview in place, preserving the map, app chrome, bottom navigation, right-side controls, selected map label, full phone proportions 390:844, colors, typography and every function unless specifically changed below. The external presentation title and subtitle "效果预览 · 尚未实施" stay visible. One single full phone image, no variants or comparison collage. This is a design proposal only.
The user says ALL editor groups waste too much space, especially in the header. Make the panel noticeably tighter and shorter, removing redundant structure, not making all text microscopic. Preserve warm white surface, thin borders, restrained dark teal and 8px corners. Panel remains upper-left below search, ~304 CSS px wide, clear of right map tools.
ESSENTIAL SHARED CHANGE:
Replace the old two separate rows (back + "编辑标记" + save, then Basic/Position/Data tabs) with exactly ONE compact unified top bar:
back chevron | "基本" | "位置" | "资料" | "保存"
Remove the redundant internal title "编辑标记" entirely. Keep "保存" as a small dark-teal primary action at right. Each group label is compact and readable; active group has a subtle teal underline or text. This bar should be about 44 CSS px high, with narrow gaps and no oversized padding. Keep the back control and save independently accessible. DO NOT add another header, title, subtitle, tab row or decorative divider block inside the panel.
The content begins immediately below this unified bar with just 3–4px gap. Panel padding 6–8px, gaps 3–4px. No nested card shadows. End the panel immediately after the essential last row. Preserve usable text and touch targets; density must come from removing blank space and duplicate UI.
Do not add extra explanatory captions or rendered annotations. If additional reference images contain user red arrows, they are feedback only and must not appear in the result.
DATA VIEW:
External title remains "资料 · 属性一眼看全", subtitle and outside note "属性内容为排布示例" remain. 资料 active in the unified top bar.
Keep the current five-row FREE TEXT editable attribute table, but remove all extra vertical air between header, table heading, rows and notes. DO NOT use dropdown chevrons on any property/value field.
Immediately under the single unified top bar, one tight heading row "自定义属性 · 5" on the left and "+ 添加" on the right. Small and compact, no giant button or extra explanatory line.
Then five closely aligned editable rows with property-name/value fields and a small trash icon at far right of each:
"编号" | "A-001"
"类型" | "采样点"
"岩性" | "砂岩"
"状态" | "待复核"
"来源" | "手动填写"
Use thin quiet input borders and minimal row separators, no big rounded outer cards per row, no empty spacer rows. The property-name column remains narrower than content; names and contents on the same row. Preserve comfortable editing targets and clear letters.
At bottom one single compact row with inline label "备注" and input placeholder "补充说明…", about one line high with subtle indication it can accept longer text. Remove the tall empty two-line textarea.
Target panel height about 330–355 CSS px, noticeably smaller than the current image while still letting all five attributes and notes be visible without scrolling. Data panel can be larger than the basic/position panel, but no waste, no fullscreen backdrop and no overlap with right/bottom map controls. Do not add reset icons to attributes: per-number reset belongs only to the position screen.
```
