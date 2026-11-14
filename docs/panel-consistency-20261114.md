# 205 后续：窗口边缘、路线显示与图源避让

## 范围与交付状态

施工目录 `D:/ShantuEngineResearch/old-engine-20261105`，分支 `codex/old-engine-tilt-dual-20261105`，基线 `8e8d2b8`。用户继续反馈并要求修复；本轮为预览修复阶段，无正式版本提升、交付 APK、提交或推送。205 私人 APK 及历史包保留。仅重建并覆盖专用模拟器的 `com.shantu.hybridprobe`，未触碰用户手机或正式 App 数据。

`savedMaterialPreset.json` 无改动；现有配色、透明度、私人天地图配置、业务数据格式保留。没有通过提高底色不透明度掩盖原生磨砂缺失。

## 根因与修改

1. 上下窗口边缘不一致：旧路线 ID 级样式覆盖 inset 边缘，只剩外阴影。`roundedSpring.css` 以共享 `--ui-panel-shadow` 统一独立窗口边缘，保留嵌入式页面的单层父底板。
2. 原生窗口透明度停在中途：WAAPI 动画不发 CSS animationstart/end，也不持续修改 DOM。主窗口使用 `SpringPresence`，小窗口使用 `useSpringInteractions`，两条路径此前都可能缺少最终发布。本轮统一开始/结束/取消事件，原生 publisher 有界采样 600ms/60ms，并发布最终命中区域与玻璃区域；尺寸动画也纳入。主窗口修复后，实测发现 raster 小窗口仍停在 opacity 0.698，补齐第二条路径后实测到 opacity 1。`measurement-share` / `marker-confirm` 也进入玻璃收集范围。
3. 路线结果卡：模式选中和开始导航旧规则使用黄色前景覆盖选中态文字。改为共享选中前景色；不改背景配色。
4. 比例尺压住路线距离/时间：主图 MapLibre 与原生比例尺统一按真实 44px 最大采样宽度生成，位于实际 3D/框选工具下 8px。双图仍保留其独立 72px 比例尺。
5. 内置图源：二级标题不再叠加带圆角的第二层底板；返回与关闭统一 36px。图源名与星标间隔 4px，星标固定 32px，名称允许省略。
6. 图源窗口顶住右栏：旧位置仅预留工具栏自身宽度，没有间隔。图源窗口及独立路线显示窗按共享右栏宽度额外保留 10px，右侧工具本身未缩小。
7. 路线显示设置：标题 36px、选择框 32px/16px 输入字号、统一内部圆角和浅色输入、作用对象独立一行。绘制内嵌视图沿用父底板，3px 内容间距消除 2px 无意义滚动。

新增 `modules/ui/panelMotionEvents.ts`、`modules/map/mapScaleLayout.ts` 及对应定向测试；修改范围为 appearance、ui、map、mapSources、routeDisplay、navigation、native UI region bridge。无功能删除，无路线几何、收藏、定位或采样业务变更。

## 实际验收

证据目录：`artifacts/screenshots/panel-consistency-20261114/`。

| 项目 | 结果 | 证据/限制 |
| --- | --- | --- |
| 图源 390×857 | PASS | `sources-rail-gap-390.png`；约10 CSSpx工具间隔，窗口约276px，右栏仍50px，无横向溢出 |
| 图源 360×780 | PASS | `sources-360.png`；间隔约10px，内容完整，星标独立32px/4px间隔 |
| 路线实际规划/骑行结果 360 | PASS | `route-summary-360.png`、`route-summary-cycle-360.png`；真实地图选点规划，未收藏，选中/开始导航文字 rgb(70,52,52)，比例尺位于右上 |
| 图层等级 360 | PASS | `raster-level-360.png`；23px圆角、blur10/saturation1.25、相同inset1.5px边缘，无横溢出 |
| 绘制路线显示 360 | PASS | `route-display-drawing-360.png`；最终内容clientHeight=scrollHeight=145px，无内部额外底板 |
| 绘制路线显示 390 | 初步PASS | `route-display-drawing-390.png`为3px间距最终压缩前截图；最终360已复核，390最后1px间距变化未重拍 |
| 安卓记录主窗 | PASS（定向） | `native-record-settled.png`；完整底板，关闭后原生区域清除，非GPS记录验收 |
| 安卓图层等级 | PASS（最终源码） | `native-raster-settled.png`；最终模拟器进程9062日志从中途opacity到1，闲置后仍完整 |
| 安卓图源 | PASS（最终源码） | `native-sources-gap.png`；原生区域right323.146，工具left333.146，间隔10px；opacity1 |
| TSC / 32项定向 / Web / Android probe | PASS | `.openai/panel-final-tsc.log`、`panel-final-tests.log`、`panel-final-web.log`、`panel-probe-final-build.log` |
| 当前配色 | PASS（源码保留） | 预设文件无diff；saved-material定向测试通过，未重设用户颜色 |

安卓证据来自专用 MuMu `127.0.0.1:16480` / `com.shantu.hybridprobe`，不是 OPPO 真机。隔离包仍沿用本机 probe 标签 `0.2.204-glass-check`，该标签不是源码版本证明；实际由本轮最终 Web 资产重建并 install -r。最终日志 `.openai/panel-native-glass-final.log` 只保留几何/玻璃数值，不含地图Key。

尚未验收：OPPO 手机观感与持续性能、安卓实际规划路线结果卡、导航嵌入显示设置、全部双图/条件数据窗口的完整状态矩阵、实时原生热调色。网页截图不能代替这些项目；本轮不报告全功能或全窗口视觉通过，也不据此自动出正式包。

## 再次测试条件

任何新增 WAAPI 面板动画都需通过 `trackPanelMotion` 通知原生窗口消费者；验证应打开后不再触摸，等待动画结束，检查最终玻璃区域 opacity=1，随后关闭清理。图源相关布局变动必须同时检查390/360的真实工具栏边界、星标间隔和完整内容。旧路线样式若改动，重新比较与上方窗口的 computed shadow/radius/filter，而不是仅检查声明。

主预览保留 `http://127.0.0.1:9174/phone-preview.html` 内置图源窗口。临时QA页面关闭，模拟器probe与截图桥停止；无用户存档清理。
