# 地点标记一级摘要卡 · 效果预览 v2

- 在 [v1](marker-level-one-preview-v1.png) 基础上，按用户要求在一级标题栏增加小号“删除”入口，放在关闭按钮左侧。
- 保持名称、位置、海拔，以及导航/编辑/详情的原布局，首层仍无需滚动。
- 小号删除图标和文字使用浅红色；未来实现时保留至少44×44 CSS像素点击区域，并与关闭按钮保持间隔。图片本身不证明实际触控尺寸已验收。
- 当前仍为一级正常状态效果图，没有进入二级，也没有执行或实现删除。删除确认方式沿用现有确认原则，未因“快速删除”要求而取消确认。
- 生成方式：内置 image_gen 编辑v1。保留v1，最终v2为 [marker-level-one-preview-v2.png](marker-level-one-preview-v2.png)。
- 已目视核对：新增“删除”在标题栏；关闭独立；底部三个操作完整；卡片无滚动区。整个一级视觉仍等待用户确认。
- 本轮仅图片与说明更新，无业务代码、安装包或用户数据变更。

## 编辑提示词

```text
Use case: precise-object-edit / ui-mockup.
Edit the supplied image, which is the current first-level 山兔 marker summary-card design preview. Make ONLY ONE scoped UI revision: add a visually small quick-delete action to the first-level card. Preserve every other aspect of the image exactly, including title "一级 · 标记摘要卡", subtitle "效果预览 · 尚未实施", phone viewport proportions, map image, card placement and size, metadata, lower three actions, and all app chrome.

In the first-level white summary card's top title row, add a compact subtle red trash-can icon followed by the exact small text "删除", positioned immediately to the LEFT of the existing X close control. The delete label should be noticeably smaller and lighter-weight than the bold marker name "验证采样点". Use muted brick red, not a giant red warning button. A clean small outline trash icon, ~15–16 CSS px, and ~12–13 CSS px text. Despite its small visible content, give the delete action an implied minimum 44 × 44 CSS px touch area and enough spacing from the close X for reliable mobile touch. Keep the X close control separately visible at the far right. Keep the drilling-point icon and name aligned on the left; adjust only the title-row spacing as needed, truncating the name only if genuinely necessary. Do not shrink the overall screenshot or enlarge the card to accommodate this action.

The card must still show exactly:
Header: existing drilling-point icon + "验证采样点" on left, new compact "删除" action + existing X on right.
Metadata: "成都 · 黄田坝街道" and "海拔 545 m".
Bottom row: "导航" / "编辑" / "详情", same order, size and appearance as the original.
The card remains compact and all content is visible without scrolling.

Do not remove any existing first-level button. Do not add a fourth bottom-row button. Do not show a deletion confirmation dialog in this normal-state preview. Do not proceed to a second-level editor or details UI. Do not add explanatory callouts, arrows, another phone, alternative design versions or new facts. Do not change the map, bottom navigation, right-side tools, app icon or title. Keep the existing crisp typography, warm white surface and muted teal styling. This is a visual preview only, not implementation.
```
