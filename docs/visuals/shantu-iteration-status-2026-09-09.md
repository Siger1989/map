# 山兔版本迭代全景 · 2026-09-09

本图汇总截至 2026-09-09 的版本交付记录，当前应用版本为 **0.2.14-test**。这次制作说明图片，没有修改应用业务、版本号、安装包或用户数据。

## 数据来源与状态

- 源码基线：`6318221d266e944748514e6bf1ee3f75cf11a67e`。
- 本地记录：[CURRENT_STATE.md](../../CURRENT_STATE.md)。
- 发行说明：[0.2.11](../release-0.2.11-standalone.md)、[0.2.12](../release-0.2.12.md)、[0.2.13](../release-0.2.13.md)、[0.2.14](../release-0.2.14.md)。
- 本次通过 GitHub API 核对 [v0.2.14-test](https://github.com/Siger1989/map/releases/tag/v0.2.14-test)：`draft=false`、`prerelease=true`，APK、SHA256 与安装说明三项资产均为 uploaded。
- APK 55,219,775 字节（十进制约 55.2 MB）。332 项逻辑测试及浏览器等验证来自该版本交付记录，**没有在本次重新执行这些测试**。
- 待办：地点标记层级与紧凑布局；Android 真机触控、GPS 实走与性能验收；HarmonyOS 6.1 原生工程、工具链、签名、分发与安装验证。
- 0.2.11 独立版与 0.2.12—0.2.14 原系列包名不同，数据不自动迁移。

## 图片说明

采用内置 `image_gen` 生成，再用该工具调整背景和文字对比度。图中地图、路线网络与界面层级均为功能示意，**不是应用实际界面截图**。本机没有从 Git 同步到 0.2.12—0.2.14 的忽略目录截图，因此没有把旧截图冒充新版界面。

最终图片：[shantu-iteration-status-2026-09-09.png](shantu-iteration-status-2026-09-09.png)，1024×1536。已目视核对四版顺序、0.2.14当前标识、332项记录、安装包大小与平台待办；图底完整、白底深色文字可读。没有新增或删除业务功能，没有重跑业务测试或重复打包；六个鸿蒙未跟踪草稿逐一核对原SHA256一致。

## 初始生成提示词

```text
Use case: infographic-diagram.
Create ONE polished, highly readable Simplified Chinese product update infographic for the real outdoor mapping app 山兔, based strictly on the facts below. This is a finished illustrated status report, not an app redesign. Portrait tall poster, roughly 2:3 aspect ratio, preferably 2400 x 3600 pixels or higher. Crisp Chinese typography. Generous readable text size, clear baseline grid and excellent line breaks. The user requested 清爽、详细、图文并茂.

STYLE: bright clean white and barely tinted mist gray background; dark charcoal text; muted teal and sage green as the main informative colors; amber only for pending work; subtle contour-line terrain texture confined to header illustration. Refined editorial information design, flat illustrated maps, small meaningful mini diagrams, thin borders, modest radii, light shadows, abundant breathing room. No decorative emoji, no mascots, no clutter, no huge gradients, no dark background. Make the illustrations substantial, roughly 40% of the poster. Every status must be explicit in words, not color alone. Text must render verbatim and accurately in simplified Chinese. No invented numbers, percentages, capabilities, device approvals, dates or statistics.

COMPOSITION:
Top 15%: elegant title and small illustrated isometric folded terrain map with a teal route, two pins, gentle contour lines and sun/cloud symbol. This is a function illustration, not a screenshot. Exact main title: "山兔 · 版本迭代全景"
Subtitle: "地图 · 天气 · 户外轨迹工作台"
Date label: "截至 2026.09.09"
Prominent current release capsule: "当前版本 0.2.14-test"
Beside it: "Android 测试版已发布"
Small key facts row: "安装包约 55.2 MB"  /  "332 项逻辑测试通过"  /  "源码已同步 GitHub"

Next 20%: header "01  最近四版，如何走到现在"
A spacious vertical or horizontal four-stop timeline with miniature function diagrams, version tags and two short lines for each stop. Dates unobtrusive. Do not depict percentages or imply all platforms complete.
"0.2.11 · 信息与分享"    "09.08"
"标记坐标、海拔与地址；收藏批量管理"
"路线照片 ZIP、Excel、二维码；12 种免 Key 图源"
Illustration: map pin, photo print, folder and small spreadsheet (no fake QR codes).
"0.2.12 · 路线连成网络"    "09.08"
"节点增删、拉分叉、连接路线"
"起终点可交换；相连分叉导航；恢复彩色文件夹"
Illustration: connected route nodes and a colored folder.
"0.2.13 · 绕路更顺手"    "09.08"
"分叉接回旧节点形成闭环；节点工具直接操作"
"原路与绕路备选分色；双进度轨道；里程不重复"
Illustration: straight original teal path and orange detour reconnecting at two explicit common nodes, original skipped segment dashed.
"0.2.14 · 操作层级统一"    "09.09 · 当前"
"路线四级窗口；编辑暂存、保存与放弃"
"跨线组合；导航方案联动；紧凑天气小卡"
Illustration: connected four labeled panels, understated current highlight.

Middle 37%: header "02  现在能做什么"
Six illustrated feature panels in an aligned 2-column x 3-row grid, each with a real informative mini schematic and exactly the following titles / concise explanatory text. Diagrams must explain features instead of generic icons alone. The first panel can be slightly wider if helpful but preserve flow.
Panel 1 title "路线操作，各归其位"
Mini flow schematic: "路线卡" branches to "导航" "编辑" "详情"; route card also has "添加标记". Show these as information architecture, not screenshot mockups.
Copy: "一级卡：导航 / 添加标记 / 编辑 / 详情"
"导航准备、底部编辑、只读详情分开"
Panel 2 title "节点与分叉，直接编辑"
Mini diagram: a selected route vertex moved to another position via arrow, branch joins existing old vertex.
Copy: "增删、拖动节点；准星定点拉分叉"
"接回旧节点闭环，支持撤销"
Panel 3 title "组合新路线，保留来源"
Mini diagram: source A route and source B route lead to a new combined C route, source A/B faint but visible with tiny photo/pin attached.
Copy: "跨线保存为新组合；来源路线收起保留"
"照片与标记保留；返回可保存或放弃"
Panel 4 title "一套方案，多处同步"
Mini diagram: original/alternative selector linked to small map, progress rail, elevation profile. Start green 起, end red 终.
Copy: "原路 / 备选同步地图、进度、导航与统计"
"起终点缩略图、海拔曲线与六项统计"
Panel 5 title "天气与进度，少挡地图"
Mini diagram: substantial small map viewport with one narrow progress rail on left and small weather card beside it; avoid invented weather measurements.
Copy: "细进度轨道上移；拖动查看沿途位置"
"左侧小卡显示里程、预计到达与天气"
Panel 6 title "资料与分享，继续保留"
Mini diagram: route with associated photos and pins exported into ZIP / GPX / KML / Excel document stack.
Copy: "路线详情关联照片、沿途标记与组成"
"路线 ZIP、照片、GPX / KML、Excel 分享"

Next 15%: header "03  已验证与下一步"
Two equally legible columns with explicit statuses; avoid implying browser tests = actual phone tests.
Left title "已完成验证"
"✓ 332 项逻辑测试、类型检查与双端构建"
"✓ APK 签名、完整性及资源检查"
"✓ 390 × 844 / 360 × 780 浏览器检查"
Small explanatory text directly under: "以上为版本交付记录，非本次重新测试"
Right title "仍需推进"
"待设计：地点标记层级与紧凑布局"
"待真机：触控、GPS 实走与性能验收"
"未交付：HarmonyOS 6.1 原生安装包"
Small explanatory text directly under: "鸿蒙原生仍缺工程、工具链、签名与分发验证"

Bottom 13% or the space remaining: concise calm full-width installation note and documentation footer, sufficient room, nothing clipped.
Title "安装与数据"
"Android 8.0+ ｜ 原系列可覆盖升级"
"与 0.2.11 独立版并存，数据不自动迁移"
Footer lines in readable smaller text:
"功能示意，非实际界面截图"
"资料：CURRENT_STATE.md 与 0.2.11—0.2.14 发行记录"
"GitHub：Siger1989/map ｜ 当前源码：6318221"

Constraints:
This is a status summary of actual existing work, not a proposed UI. Do not invent official product screenshots. The timeline must be in ascending version order. Clearly distinguish publicly released Android test build from pending actual device validation and undelivered native HarmonyOS. No percentage progress bars. No claim of globally available terrain enhancement. No claim of commercial readiness or universal device compatibility. No scannable/fake QR code. No watermarks. Do not duplicate sections or omit the bottom pending section. Use exactly the provided facts; you may arrange typography and diagrams elegantly but do not alter the wording or make new feature claims.
```

## 最终背景与文字清晰度调整提示词

```text
Use case: text-localization and lighting refinement of an infographic. Edit the provided Chinese 山兔 version status poster. Keep its exact existing content, layout, timeline 0.2.11 → 0.2.12 → 0.2.13 → 0.2.14, six informative illustration panels, every factual status and all numeric data. Make ONE specific visual refinement: clean high-key editorial WHITE BACKGROUND with maximum text clarity. Remove all large dark teal gradients, diffuse foggy shadows, blurry dark bands, and smoky textures, especially behind the top title, timeline labels, section dividers and the bottom verification panels. Dark charcoal text on white/light backgrounds throughout. Keep small green/amber status colors and the appealing terrain/route illustrations, but shadows must be tiny and subtle. The title "山兔 · 版本迭代全景" must be strong, crisp, easy to read. Main body text should be clear simplified Chinese, avoid warping or decorative thin strokes. Maintain the full content without cropping or truncating, retain the entire bottom section including "待设计", "待真机", "未交付" and the note "功能示意，非实际界面截图". Remove the two non-factual handwritten decorative slogans at upper right ("去山野 看更大的世界") and lower right ("山不止于眼前 地图连接远方"), leaving whitespace or minimal contours. Preserve all the actual update descriptions. Preserve current release 0.2.14-test, date 2026.09.09, 332 tests, 55.2 MB, Android 8.0+, 390×844 / 360×780, HarmonyOS 6.1 native UNDELIVERED, and source revision 6318221. Final poster portrait 2:3; render very high resolution for zooming and sharing, ideally 2400x3600 or above. No new invented slogan, facts, percentages or badges. This is a final polished detailed status report, not an app redesign.
```
