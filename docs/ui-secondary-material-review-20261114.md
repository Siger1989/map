# 次级界面材质统一复核（2026-11-13 至 14）

## 范围与配置

- 用户已调好主要颜色，本轮补齐漏用共享材质的界面、选中态文字、色块形状和退出位置。沿用当前控制器参数，不将测试颜色写成用户默认。
- 实际工作树 `D:\ShantuEngineResearch\old-engine-20261105`，分支 `codex/old-engine-tilt-dual-20261105`；不是旧的 `D:\天气系统`。
- 私人预览 `http://127.0.0.1:9174/phone-preview.html`，API 3108，保留内置私人天地图。既有 APK 仍为 0.2.202-test/code209/com.shantu.oldengine，本轮没有新 APK、升版、提交或推送。
- 用户浏览器的精确 session 调色无法从隔离 QA 会话取得。QA 仅通过控制器设置近似的深橄榄玻璃/金黄前景：窗口 `#333b29`、透明度65%，控件 `#302d16`、透明度15%，文字 `#ffce47`，主色/选中 `#e7b92c`，主按钮文字 `#3d2b16`。不是最终配色定稿。
- QA 正式 `shantu.appearance.v1` 前后不变；没有清理业务存档。快捷图源测试临时收藏的两项已通过 UI 移回原状态。

## 已修复及根因

| 问题 | 根因及处理 | 关键文件 |
| --- | --- | --- |
| 搜索记录仍白底、第一条截断 | `.suggestion-surface` 的 `!important` 盖过外框；直接修真实绘制层，内层透明。旧高度仍用40px行，现按36px标题、44px历史操作与45px含分隔行计算 | `modules/input/suggestions.css`、`modules/appearance/roundedSpring.css`、`modules/controls/PlaceSearch.tsx` |
| 图源、收藏和其他子窗残留白底 | 子容器、body portal 与双图独立宿主未完整接入；补图源收藏菜单、我的图源分组/公共库、收藏排序/管理/新文件夹/分享、颜色窗、双图属性、剖面列表、行业导入卡片、外观页样本 | `roundedSpring.css`、`mapComparison.css` |
| 金色文字压在金色选中底 | 选中态继承普通前景；根据当前填充、透明度和候选文字计算可读前景，保留用户存储值 | `mobile/phonePreviewMaterialContrast.js`、`phonePreviewMaterial.js`、`modules/appearance/theme.ts` |
| 3D暗、继续记录灰、指南底板白 | 各自仍用旧颜色或实色 SVG 底板；3D用玻璃文字，快捷记录用主按钮配色，罗盘底板 fill none | `roundedSpring.css`、`modules/controls/CameraGizmo.tsx` |
| 底栏与记录按钮太圆/太宽 | 底栏仅将绘制底板两边各收4px、圆角减4px，命中区域不缩；记录控件圆角减3px | `roundedSpring.css` |
| 记录颜色为大方块 | 原生 color 控件的内部 swatch 不等于 CSS 外框；替换为既有 `TrackColorPicker`，18×18真实色块，点击打开共享颜色窗 | `modules/outdoor/RecordingCompactSettings.tsx` |
| 退出画线时左侧按钮从高处落下 | 退出动画期间的 inert 绘制面板仍抬高父级安全占位；底部 clearance 和左侧锚点均排除 inert 面板 | `modules/controls/homeMap.css` |
| 悬浮小地图设置有多余滚动 | 默认200px上限不足；只对该设置页放宽至320px并受视口约束，内容保留 auto，展开说明或矮屏真实溢出仍可滚动 | `modules/guidance/floatingNavigation.css` |
| 控制器选不准次级窗口 | 为 portal、双图属性、剖面、收藏菜单/排序补共享类别；当前图源与 radio 选中状态加入检测 | `mobile/phonePreviewMaterialTargets.js`、`phonePreviewMaterialGroups.js` |

地图栅格、原生羽化、GPS、导航业务、图层数据、真实轨迹/标记颜色、行业图表画布和收藏目录语义色不在本轮更改范围。

## 实际浏览器验收

截图对照入口：`artifacts/screenshots/glass-material-20261113/review.html`，共50张、支持筛选及点击放大。所有图均来自实际预览，不是生成式设计图。旧的 before-fix 截图保留作追溯，不纳入最终对照页。

| 场景 | 证据/结果 | 状态 |
| --- | --- | --- |
| 搜索记录390/360、聚焦输入 | painted host `rgba(51,59,41,.35)`，内层透明；360右边界294px，没有横向越界；短历史窗137px，历史区scroll/client均95px，第一条完整；输入圆角12px。清除/删除按钮不执行 | PASS |
| 路线模式与下一步提示、收藏全部、图源选中 | 金底文字 `rgb(61,43,22)`；普通文字仍金色，色值与透明度草稿不改写 | PASS |
| 底栏与记录控件 | 390底栏命中74.8×44px，选中底板内收4px；记录控件15px圆角（QA输入18px） | PASS |
| 记录设置390/360、颜色窗开关 | 色块18×18、隐藏原生 input 外观；关闭后业务颜色不变；360设置内容242/242px无横溢出 | PASS |
| 画线、预设颜色、自定义颜色、返回 | 窗口玻璃、色块保留，关闭返回颜色值不变 | PASS |
| 画线退出正常/减少动态效果 | 正常35个采样，快捷记录bottom恒116px、锁定恒176px，top变化分别6px/0；减少动态效果33采样均0位移 | PASS |
| 悬浮小地图390/360 | 默认内容高度180/202px，scroll=client，控件完整；360展开说明348/252px可滚 | PASS |
| 悬浮小地图390×480展开说明 | 内容326/252px，overflow auto，未用hidden遮掉内容 | PASS |
| 主图图层、地形/影像/道路参数、图源内置/我的/公共/导入 | 实际打开、返回和截图；最后补掉我的图源分组与公共库实色内板 | PASS（所列状态） |
| 双图上下图源、图层、地形/道路、画线属性与方向 | 当前图源深字金底；属性窗玻璃；方向按钮已核对实际级联，旧 `.glass` 不再盖成白底 | PASS（所列状态） |
| 收藏排序/管理/新建/条目菜单/分享 | body portal 主窗玻璃，内部控件和边线跟共享材质；排序选中项深字金底；没有保存、删除、分享或导出数据 | PASS（界面） |
| 标记编辑顶栏、图案、颜色、坐标 | 顶栏透明，三类子页可打开及返回；不改业务字段，不自动新建条目 | PASS（界面） |
| 测量/更多/B、剖面列表/新建、照片/扫码/区域、行业两tab、关于/个性化/布局 | 子 agent 独立浏览器15状态 + 主 agent复核关键图；修后剖面/行业/外观4张补拍均PASS | PASS（已列界面） |
| 相机扫码识别、照片导入、原生悬浮/锁屏、真实GPS、OPPO触控 | 浏览器扫码相机不可用；未做真实设备测试 | 未验证 |
| 数据相关结果/错误、全部自定义透明度组合及所有次级功能路径 | 没有为凑覆盖率伪造数据或权限；未覆盖状态不能视为已验 | 未验证 |

标题、列表、颜色选择器、实际边界均检查computed后再查看截图。主 agent复核时发现并修复了初次CSS修改没有压过的搜索、双图方向、收藏portal/排序级联，不以构建成功代替视觉确认。

## 定向代码检查

- `npx tsc --noEmit`：PASS，包含最终 RecordingCompactSettings / PlaceSearch 改动。
- `node --experimental-strip-types --test tests/preview-material-contrast.test.mjs tests/preview-material-groups.test.mjs tests/appearance.test.mjs`：15 PASS。
- 控制器4个JS文件语法检查及 `git diff --check`：PASS（既有文件换行提示不属于失败）。
- `npm run build:android:web -- --mode apk-preview`：最终私人 Web 构建 PASS；不是 APK 构建或真机验证。
- 日志保存在 `.openai/material-secondary-*.log`、`.openai/material-favorites-final.log`、`.openai/material-narrow-final.log`；日志不提交。

## 限制与下一步

- 部分退出面板仍产生焦点留在 `aria-hidden` 子树的浏览器无障碍警告。本轮没有扩大修改焦点生命周期；已知问题保留，不能据此宣称全交互验收通过。
- 搜索历史是可滚动列表，键盘展示来自网页预览模拟；不是OPPO输入法证据。行业图表本身保持可读的图纸背景，不按窗口玻璃替换。
- 当前仍为源码快速预览。用户确认整体效果并提供/确认最终控制器参数后再落正式默认值；出包待明确转入交付。

2026-11-14交付追加：用户已授权保存实际预览参数并打包203。现已直接读取并核验原始23项用户草稿，35项解析令牌写入个人预设；不再使用近似QA色值作为默认。输入统一和新包证据见release-0.2.203.md。
