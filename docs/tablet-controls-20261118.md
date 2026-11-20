# 山兔平板右侧地图工具复测 · 2026-11-18

私人网页预览已修复矮横屏工具挤压。原先在 960×600 点击图层等级按钮中心会触发框选。现在图层等级按钮为 44×44，可从原位置打开菜单并关闭返回。尺寸均为应用可用的 CSS 像素。

| 场景 | 检查内容 | 结果 |
| --- | --- | --- |
| 主图普通浏览，100 档 | 核对实际视口，检查 9 个地图按钮的边界、尺寸、中心命中及右栏、快捷操作、比例尺、摇杆和底栏之间的相交 | 100 档通过 |
| 主图菜单，4 档 | 390×857、780×360、960×600、1024×601，实际打开和关闭图层等级与收藏图源 | 通过 |
| 双图，14 档 | 横竖屏、操作栏和图源弹窗。480×360 横屏右图菜单原先越界 42px | 通过，右图菜单距右边 8px |
| 勘探线、海拔图例、两者同时打开 | 每种状态各 7 档，检查可见工具、面板与图例的边界及按钮中心命中 | 21 个组合通过 |
| 勘探线展开编辑并开启海拔图例 | 选完 A、B 两点，进入 B 点编辑，再查 7 档尺寸 | 7 档通过，360×780 的比例尺与右栏边缘相交已消除 |
| 矮竖屏路线窗口 | 390×480 实际打开路线 | 路线窗口与右栏横向净距 8px，右栏与下方摇杆垂直净距 28px |

勘探界面原有的属性选择器也匹配普通浏览状态，把地图按钮压到 36px。主图现在按方向和可用空间布置工具组，双列工具保留 44px 按钮，海拔图例占用所需行数，弹窗根据整组工具的位置避让。双图的图源菜单按所在图窗限制宽度。

修复位于 `modules/controls/outdoorTheme.css`、`modules/section/survey.css` 和 `modules/mapComparison/mapComparison.css`。后续调整右栏时，使用私人预览执行 `node scripts/verify-tablet-controls.mjs after`，再复测双图图源菜单与勘探、海拔状态。重点保留 600×600 正方形以及高度 599、600、601、680、681px 的覆盖。

- [主图尺寸与命中结果](../artifacts/screenshots/tablet-controls-20261118/after/matrix.json)
- [960×600 修后首页](../artifacts/screenshots/tablet-fix-20261118/review-960x600-home.jpg) · [点开图层等级](../artifacts/screenshots/tablet-fix-20261118/review-960x600-level.jpg)
- [双图结果](../artifacts/screenshots/tablet-fix-20261118/dual/after.json) · [480×360 右图源菜单](../artifacts/screenshots/tablet-fix-20261118/dual/480x360-source.png)
- [勘探与图例结果](../artifacts/screenshots/tablet-fix-20261118/survey/after.json) · [390×480 两者同时开启](../artifacts/screenshots/tablet-fix-20261118/survey/survey-legend-390x480.png)
- [展开编辑结果](../artifacts/screenshots/tablet-fix-20261118/survey/expanded-final.json) · [360×780 展开编辑](../artifacts/screenshots/tablet-fix-20261118/survey/survey-expanded-legend-360x780.png) · [390×480 路线窗口](../artifacts/screenshots/tablet-fix-20261118/route-390x480.png)

Android 混合界面资源已在隔离输出目录构建通过。布局迁移、原生玻璃区域、弹窗动画与键盘视口共 24 项定向测试通过。本轮为源码和预览修复，现有 0.2.207 安装包仍是旧构建，朋友平板的系统缩放、实际触控与原生合成待新包上机核验。
