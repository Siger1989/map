# 双图停手抖动、线条样式与点击、等高线修复

2026-10-30，基于已交付私人 146/code153（提交 `3a0eb6e0f427aed8c6b617e0386d7594702cb1d8`）。用户确认双图在手指停下后仍来回移动，要求恢复原界面的线宽/颜色/对齐、改善路线点击，以及等高线速度与粗细；随后要求右侧可见预览。本轮为源码和快速预览阶段，未升版本、未重建/替换 APK、未提交推送；不启动模拟器，不操作 Unreal，不清除用户数据。

## 原因与方法

| 项目 | 源码根因 | 本轮处理 |
|---|---|---|
| 双图来回晃 | 两侧相机双向同步。旧 `NativeCameraSync` 用各字段 1e-7 的精确比较判断程序回音，原生眼位/地形重建出现差异或旧帧迟到时会被当作新操作，再回传给另一侧。 | 每次同步命令附单调 `cameraSyncToken`，原生即时相机事件和同帧 witness 元数据携带来源；程序回音不再触发对侧同步。新命令/真实 DOWN 后迟到的旧帧不覆盖运行态相机；手势期间不接受对侧抢相机。未标记的真实导航/跟随相机继续传播；只对尚未确认命令前的精确旧姿态作有限抑制。 |
| 线条视觉 | 原生场景漏了轨迹外描边；CSS 像素直接作为原生物理像素；Android 解析不了 rgba/部分 CSS 颜色；虚线按角色写死。 | 复用原轨迹 feature 的外描边、颜色、宽度和透明度；按当前视口实际 cssScale 换算并在比例变化后重建样式；安全解析 CSS 色值；按 dash 数据转换 stipple。保持业务数据/实际线几何。 |
| 路线难点击 | 只从原生 GL 精确点命中拿候选，点击稍离开细线就没有路线/轨迹候选。 | 原生没有对象命中时，在当前投影的可见路线/轨迹分段中找最近线，12 CSS px 内可选择；不把显示线加粗。保留节点、照片、标记、编辑/测量/绘制优先级，不跨断段、不选隐藏线。 |
| 等高线粗且重复加载 | 原生将等高线画入 256px 图片，超过源 z13 后连线宽一起放大；工厂每次构造均是新身份，可能重复采样/生成/上传。 | 复用精确 WorldWind 2.1.1 的 `MercatorTiledVectorLayer`，将现有 marching-squares 片段先拼为路径，再贴地绘制，保持原版 0.45/1.05 CSS px、0.8 透明度和色带；源仍到 z13，不虚构 DEM 细节。40 瓦片上限、4 个计算/取数槽、原 16 项 DEM 采样缓存。海拔着色保留栅格，工厂改稳定值身份。 |
| 固定高清层对齐 | 精确 SDK `Sector.fromDegrees` 后两参是角度跨度，既有代码误传北/东边界。 | 改为 north-south、east-west，并以真实 SDK 的经纬度范围在不同半球和 z0 验证。不改变坐标/投影数据。 |

双图使用 `NativeTileNetworkPool` 的同一网络加载器与持久浏览目录。相同源/层/坐标/样式/授权瓦片合并下载、共用一份缓存；两侧不同图源的必要瓦片分别按身份保存，但仍共用 8GiB 上限。没有关闭缓存，也没有修改 146 的 20 槽/重试/限流策略。缓存写盘可能影响耗时，不能用它直接解释相机来回移动；本轮没有手机 CPU/帧率对照数据。

## 范围与上游核对

- 前端：`modules/map/native/{cameraSync,NativeTerrainMap,scene,overlayStyle,tapSemantics,lineHitTest}`。
- 原生：`NativeReactMapHost`、`NativeBridgeCameraOrigin`、`NativeBridgeOverlayRenderer`、`NativeOverlayStyle`、`NativeTerrainOverlays`、`NativeContourLayer`、`NativeRasterDetailLayer` 及对应测试/白名单。
- 原样式依据：`modules/tracks/TrackLayer.ts`、原 feature 构造器与 `modules/terrain/terrain.ts`（主线 1.05/辅线 0.45、标签 11/halo 2.8/spacing 210）。原存档、图源、Key、系统能力与 React 菜单不删改；无 CSS 布局改版。
- 查阅 [WorldWindKotlin 上游](https://github.com/WorldWindEarth/WorldWindKotlin)及本机精确 2.1.1 的 TiledVectorLayer / MercatorTiledVectorLayer / Sector / Label / Path 源码。网上首次检索网络失败，后续 issue 检索未找到可直接证明本应用根因的相同报告；没有把外部相似现象当真机诊断结论。

## 定向检查与证据

| 检查 | 结果 | 边界 |
|---|---|---|
| 46 项 Node：相机来源/旧帧、路线近线命中/优先级、样式序列化、原场景/路径/投影 | PASS，0失败/跳过 | 生产 helper 测试，不是手机运行 |
| TypeScript `npx tsc --noEmit` | PASS | 类型检查，不是视觉验收 |
| 9 组 38 项原生：来源同帧快照、颜色/线宽/dash、等高线矢量/像素中心/工厂身份、固定瓦片范围、帧/触控回归 | PASS，0失败/错误/跳过 | 重编译当前 Kotlin 与测试，复用未变的测试资源/CAD；不跑模拟器 |
| `git diff --check` | PASS | 中间构建遇到缺 clone、重复测试 source，均已修复后复测 |
| 右侧网页预览 | 已显示；保留 390×约857、Find X8 比例 | 私人 apk-preview 配置，天地图入口可见；原生修复未在此运行 |
| API 服务 | 本机 3108 health=200，地形路由=302；Vite 9174 | Vinext/Miniflare 启动未完成，改用本项目现有 desktop-web/server 复用 API，未修改业务/API 源码 |
| 手机双图停手、实际线宽/对齐/命中与等高线耗时 | 未验证 | 不宣称体验或整套视觉已通过 |

日志：`.openai/dual-lines-contours-*`。预览截图仅本机 `artifacts/screenshots/phone-preview-20261030-native-fix-reference.png`，含既有用户地图状态，不上传公开仓库；它仅证明网页预览已显示。

## 尚待复测

WorldWind 的 16-bit stipple 对 MapLibre dash 是近似；等高线标签字体、沿线排列/重叠和任意俯仰下的像素外观仍需原生截图对照。双图连续交替操作、真实跟随、停手不回摆、空白点击/附近多线/断段、不同 dpi 与地图位置，以及等高线首次与回访耗时，都需手机或用户后续授权的原生环境。不得用右侧网页截图宣布这些通过。

手机仍为原 146 私人 APK，SHA256 `2ecb2183ad5330f62dce14254a805f712a8fd797fd5468ed2b4fe642405ebcd9` 已重新核对未变；新源码未装入该旧包。下一步先对原生外观/交互作实际复核，再按用户明确交付要求生成新版本私人包；不把旧包当新修复包。
