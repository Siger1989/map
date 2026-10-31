# 山兔 0.2.150 私人测试版 — 原生回归未通过

## 状态

0.2.150-test（versionCode 157）已经构建并保存为版本化私人 APK，但实际原生回归发现点选与标记图像问题，本候选 **FAIL / UNQUALIFIED**。150核验时固定入口仍为149；之后已由151更新为151（见[151发行说明](release-0.2.151.md)）。当前聊天附件 **NOT_DELIVERED**。

## 包身份

- 版本：`0.2.150-test`，versionCode `157`
- 包名：`com.guanyun.weather.shantu.preview`
- 版本化私人副本：`APK/Shantu-0.2.150-test-private.apk`
- 大小：165,150,292 字节
- SHA-256：`a047a80781603e473d77359fc51ab113f5aaf2c4cf362eef35d1fd38be7f2f42`
- 150核验时固定安装入口：`APK/山兔手机.apk` 指向 149/code156，SHA-256 `3f681197d80507cd2fccc118ee8bb5c44267a6fffa398f37ef3a120890a9f4cd`；该入口之后已更新到151。

## 构建与源码检查

51 项 Node、30 项 Kotlin（5 suites）、TypeScript、私人 React 资源和 optimized APK 构建均 PASS。这些结果不抵消下列原生运行失败。

150 加入的 `NativeMarkerPlacemark` SDK `getTexture` 回退暴露了白色 24 px SDK 默认 placeholder。模拟器截图中见到该白方块；root 确认当前 SDK 在该缺图分支会提供默认占位图。该实现不能作为生产标记贴图使用。

## 原生运行结果

root 提供的 150 原生回归记录为 `.openai/native150-gpu/report.json`，共 75 个动作：A/B/C、空白清除、refocus 通过，但快速交替点选预期 B、实际落在 A，故点选回归 **FAIL**。同次模拟器还显示 24 px 白色方块，标记呈现 **FAIL**。

实际 DOM 选中卡片包含正确名称和按钮；helper 中 `hasStartFlags=false` 是序列化/编码问题，真实 button array 正确，不能把 helper flag 当成生产 UI 的状态证据。保留该 QA harness 问题说明，也不以 DOM 卡片通过掩盖原生快速点选失败。

## 浏览器 UI 范围

先前隔离 Playwright 检查的 React UI 在 390×857 与 360×780 下通过：选择卡片、同排“设为起点/设为终点”按钮、路线面板边界、对应输入字段及返回/重新选择通过，没有点击规划。root 也目视确认过 390 宽页面 PASS。浏览器无 `ShantuNativeMap`，运行 MapLibre React 路径；该证据不覆盖 APK 的 GPU 图像或快速原生点选。

截图和尺寸记录见 [marker-navigation-150-20261031.md](native-android/marker-navigation-150-20261031.md) 及本机 `.openai/marker150-home-ui-layout.json`。

## 151 修复状态

候选 151 源码改为没有可用纹理时跳过绘制 SDK default placeholder，同时保留已经 ready 的回退纹理；另修 host 的通用取消逻辑，避免取消与当前手势无关的 GPU、DEM 或 section 任务。该实现仅在 151 源码，等待 optimized 构建和原生复测。

151/code158 的 51 项 Node、31 项 Kotlin（5 suites）、TSC 与私人 React 资源构建 PASS；optimized Android build **IN_PROGRESS**。目前没有 151 APK 产物可核实，不能复用 150 的 SHA 或大小。详见[151交接](HANDOFF-20261031-151.md)及[151原生导航报告](native-android/marker-navigation-151-20261031.md)。

## 私人交付

150 只保留版本化私人 APK，未替换固定安装入口；151 尚无 APK。当前聊天私人附件仍为 **NOT_DELIVERED**，没有附件 ID 或下载链接。两包均不公开发布，不公开私人地图配置。
