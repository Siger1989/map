# 地点标记二级编辑 · 基本页效果预览 v1

- 用户已明确确认[一级摘要卡v2](marker-level-one-preview-v2.png)，包括标题栏小号删除，并要求继续下一层。
- 依照逐层先看图再确认的顺序，本次只制作**二级“编辑”的框架与默认基本页**，不同时推进导航准备、详情或位置/资料的展开内容。
- [效果预览](marker-level-two-edit-v1.png)采用内置 image_gen，以上一级已确认图为参考；为拟议界面，不是已实现截图。
- 编辑框架：顶部返回和保存；基本/位置/资料三个分组，每次只显示一组。
- 基本页：名称、图标选择器、颜色选择器；选择器保持收起，首屏内容完整可见，地图仍为主要区域。
- “保存后生效”是待确认的交互提案。当前应用仍为直接保存，尚未实施暂存、保存或放弃；拟议的返回有改动时提示保存/放弃/继续。
- 已目视核对标题、三个分组、名称与两个选择器、保存入口、无滚动条和无一级叠加。图片不证明实际触控尺寸、响应式或真机行为已经通过。
- 当前等待用户确认二级框架与基本页。未修改应用代码、安装包或用户数据；右侧仍保留390×844应用预览。

## 生成提示词

```text
Use case: ui-mockup / compositing.
The input image is the user-approved FIRST-LEVEL marker summary card preview for the existing 山兔 outdoor map app. Create exactly ONE follow-up preview for the SECOND-LEVEL EDITOR, showing only the default "基本" group. This is a sequential design review: do not make alternatives, do not show other states side by side, and do not proceed into the third-level icon picker, position editor, or detailed attributes screen.

PRESERVE:
Keep the same portrait presentation, phone viewport aspect ratio 390:844, app screenshot scale, satellite map backdrop, current selected marker label "验证采样点", app search header, right map tools, bottom navigation and lower-right camera control exactly as in the input. Use the same warm-white surface, restrained dark-teal accent, typography, small corner radii, subtle border and shadow. Preserve the map-first experience. Avoid an app-wide redesign or invented basemap details.

OUTSIDE THE APP:
Change only the presentation title at top from "一级 · 标记摘要卡" to exact "二级 · 编辑标记".
Keep subtitle "效果预览 · 尚未实施".

REPLACE THE FIRST-LEVEL CARD:
Remove the existing first-level summary card contents completely, including its delete action, close X, metadata, navigation/edit/details buttons. Replace it at the SAME UPPER-LEFT position below search with a compact editing panel. Do not stack the editor over a visible old card; only one app panel at a time.
Within the 390×844 viewport the new editing panel is about 304 CSS px wide and 280–300 CSS px tall, never more than 320px. Its right edge must stay clear of the right-side map tools. All fields in this basic group must fit with no vertical or horizontal scrolling. No giant blank space.

EDITOR CONTENT AND ORDER:
1) Header row, min 44px high:
On the left a back chevron with a 44px hit area, then the dark bold title "编辑标记".
On the far right one compact filled muted dark-teal primary button labeled "保存", with white text and comfortable minimum 44px hit height.
Do not also add a close X, a delete button, a dropdown or a second save footer. Back returns to the selected marker's summary; save is the one commit action.

2) One horizontal group-navigation row with exactly three equally weighted labels:
"基本"  "位置"  "资料"
"基本" is selected using restrained teal text and a very light tint or fine underline.
Other two are neutral. Each has a comfortable 44px touch area. No tab contents for 位置 or 资料 are visible.

3) Basic content, compact vertically spaced:
Label "名称"
A full-width single-line editable field containing the exact value "验证采样点", with 44px height, light neutral fill, quiet border. Keep content legible and aligned.
Below this, two aligned columns labeled "图标" and "颜色".
Under 图标: one light outlined selector, ~120×44 CSS px, showing the drilling-point icon, the exact text "钻孔", and a small downward chevron. This selector is closed; DO NOT show a full icon gallery.
Under 颜色: a compact selector with a warm amber color swatch (matching the selected marker's existing amber accent), the exact short text "琥珀", and a small downward chevron. The selector is also closed; DO NOT show a separate popup or a long palette.
Use sufficient white space between the two columns, but do not waste a whole screen. Both closed selectors have 44px touch height.
A single quiet small helper line below the fields: "保存后生效"
This communicates proposed staged editing, rather than the current app's direct autosave. It is a design proposal, not an implementation claim.

Only display these editor words:
"编辑标记" "保存" "基本" "位置" "资料" "名称" "验证采样点" "图标" "钻孔" "颜色" "琥珀" "保存后生效".

DO NOT INCLUDE:
No coordinate or altitude fields in 基本.
No full address, notes, custom attribute table, surface/underground selector, dimension/rotation fields, edit gizmo, export or deletion in this view.
No scrollbars, nested cards, duplicate generic panel header, persistent selected-object dropdown, or keyboard covering content.
No explanatory arrows, caption lists, status dashboard, red warnings, extra phone, app screen collage or next-step wireframes.
Keep the underlying map and selected label visible over most of the phone viewport.

Make the single editor preview crisp and convincing as a mobile app interface, with accurate Simplified Chinese, clear touch targets and restrained density. The goal is to compare one compact editor to the previously cluttered editor, with only the current group's fields visible. Do not fake that it has already been implemented. Preserve the "效果预览 · 尚未实施" subtitle.
```
