# 山兔项目目标、能力与施工规则

本文索引山兔项目已经确认的目标、仓库当前具备的能力、开工施工办法和必须遵守的门禁。功能目录证明代码和模块存在，不代表所有平台、设备或场景均已验收。

## 1. 项目目标

山兔是手机优先、面向全球的三维地图、天气与户外轨迹工作台。默认视角和界面不限定在成都或川西；必须保留地区数据真实覆盖范围及署名，不把局部增强数据说成全球覆盖。保持包名、签名、存储键和备份格式兼容；优先采用模块化、低耦合和可扩展实现，跨模块通过类型接口、props、事件或适配器协作。修复只改必要范围。

这是已确认项目目标，本规则不要求重新确认。新项目应先形成四项草案——目标、功能清单、具体施工文档和门禁细节——交用户确认后再施工；该要求不暂停山兔当前已确认的工作。

## 2. 功能清单与平台现状

下表按 `CURRENT_STATE.md` 和仓库实际模块目录记录当前能力。平台支持需逐项验证，不能仅凭模块存在推断完成。

| 功能 | 仓库依据 | 当前能力与状态边界 |
|---|---|---|
| 地图、地形、图层与天气 | `modules/map/`、`modules/terrain/`、`modules/mapSources/`、`modules/weather/` | 提供三维地图、地形/图层与天气展示。地区数据覆盖、图源许可、授权和署名按实际来源处理；不同手机上的渲染、性能及定位仍待真机确认。 |
| 记录与轨迹 | `modules/outdoor/`、`modules/tracks/`、`modules/journey/`、`modules/photos/`；Android实现位于 `mobile/android/` | 有定位记录、轨迹存取与详情分析模块。浏览器记录限前台；Android后台/锁屏、系统权限、厂商省电与中断恢复需真机确认，不能由网页或构建结果代替。 |
| 路线与导航 | `modules/navigation/`、`modules/guidance/`、`modules/offlineRouting/` | 有在线道路规划、路线展示及导航状态流程，并有离线路网相关模块。服务、网络、地区道路数据和路线可通行性有边界；真实定位、设备操作和具体路段仍需验证。 |
| 绘制与编辑 | `modules/tracks/`、`modules/areas/`、`modules/geometry/` | 有手绘、逐点编辑、吸附/续画及区域几何处理。浏览器交互验证不能代表手机触控手感；对应真机操作仍待确认。 |
| 收藏、标记、区域与照片 | `modules/collections/`、`modules/annotations/`、`modules/areas/`、`modules/photos/` | 有本地对象收藏、标记/区域、照片关联与详情模块。应保护既有用户记录；实际相机、系统照片选择器和不同设备的文件权限需真机确认。 |
| 导入与分享 | `modules/files/`、`modules/photos/`、`modules/collections/`，Android适配位于 `mobile/android/` | 有存档/文件转换、导入及交付适配代码。具体格式的平台读写、系统分享调起和照片附件须按设备实测；代码存在或浏览器预览不等于系统交付验收。 |
| 桌面版 | `desktop/`、`EXE/README.txt` | Windows桌面单EXE可复制启动，依赖WebView2 Runtime；PNG渲染依赖系统Edge或Chrome。真实Windows WebView窗口权限仍待设备验证；具体版本与产物以当期交接/发布记录为准。 |
| 完整工程JSON | `modules/dataTransfer/`、`modules/cad/`、`docs/desktop-json-pan-20261008.md` | 手机与桌面完整工程JSON可往返迁移，覆盖支持范围内照片、图源、CAD原文件、行业Excel/项目及设置；按稳定ID合并，同ID由导入侧覆盖、接收端独有数据保留。旧v1备份兼容入口为单独格式。真实UI往返已验证；Android系统保存/分享及真机文件权限仍待设备验证。 |
| CAD参考层 | `modules/cad/`、`public/cad-runtime/` | 支持范围内DWG/ASCII DXF图元作为地图参考层，保留原文件与工程资料；未知CRS需人工确认，缺乏经核实参数的北京54/西安80跨datum转换会拒绝。20 MiB文件、20,000图元、100,000顶点等上限及GPL v3运行时说明见 `modules/cad/README.md`。不是完整CAD往返编辑器；设备文件权限仍待真机验证。 |
| 工程坐标系与导出 | `modules/coordinates/`、`modules/dataTransfer/`、`modules/cad/` | 工程CRS用于坐标输入、转换及工程JSON/CSV交换；地图标准GeoJSON仍为WGS84。明确源CRS/参数后执行转换，BJ54/Xian80未知datum不猜；2D投影保留Z且不做垂直基准矫正，不代表测绘精度。涉及原生文件选择/保存/分享的手机流程仍待真机验收。 |
| 离线工具 | `modules/offlineRouting/`、`modules/outdoor/`、`modules/mapSources/` | 有离线路网、地图缓存/下载相关能力。离线包完整性、断网读取、空间占用、清理边界和真机持久性需分别核验；不可误删用户轨迹、照片或共享瓦片。 |
| Android平台 | `mobile/android/`、`mobile/main.tsx` | 仓库含 Android 原生外壳与桥接实现；具体发行包及当前设备验收状态以 `CURRENT_STATE.md` 最新记录为准。构建成功不等于手机功能验收。 |
| HarmonyOS 6.1 | `docs/harmonyos-6.1-install.md` | **原生鸿蒙包未交付。** 当前仓库没有原生 HarmonyOS 构建工程；容器/兼容试装方向不代表原生支持。须先完成平台适配、合法签名、安装与设备功能验证，方可报告交付。 |

每次接手先读 `CURRENT_STATE.md` 最新条目，确认哪些项目能力已实现、哪些只经浏览器或逻辑验证、哪些尚待真机、授权或平台适配。不要把历史发布记录当作当前设备验收。

## 3. 施工流程

### 跨电脑开工与执行

每次开工先确认实际工作目录、Git分支、本地改动和预览变体；先保留已有未提交改动。读取 `CURRENT_STATE.md` 最新条目、`docs/agent-handoff.md` 最新交接，以及本文件的项目目标、功能清单、施工流程和项目门禁；UI任务再核对 `AGENTS.md` 顶部门禁、`docs/ui-standard.md` 与 `docs/ui-quality-gate.md` 的最新覆盖规则。低消耗 Luna（`gpt-6-luna`）只接边界明确的小任务；主 agent 亲自检查实际截图与 computed 值，并点击关键操作、走返回路径。将受影响的状态矩阵及 PASS/FAIL/未验证证据写入本轮交接/报告；必需状态未验证或失败时不得报通过或据此出包。快速预览只做当前指定工作，不自动推送或打包。规则仅适用于本项目；不得改 Codex 全局配置、覆盖用户改动或写入凭据。

1. 开工前阅读 `CURRENT_STATE.md`、`docs/agent-handoff.md`、本文件、`docs/continue-development.md` 和相关模块文档；涉及 UI 时另读 `docs/ui-standard.md` 与 `docs/ui-quality-gate.md`。
2. 写清用户目标、涉及范围、明确不涉及的部分和当前验证边界。先定位现有入口、数据流、存储格式、接口及平台适配边界。
3. 按“scope → 接口 → 最小改动 → 验收 → 交接”执行：控制改动范围；跨模块变更通过既有类型接口、props、事件或适配器；先修必要问题，不顺手重构。
4. 依影响选择定向检查。UI 必须有适用视口/状态的实测和截图；逻辑与构建检查按改动范围执行。每类证据只支持它实际验证的结论。
5. 更新交接说明，记录文件范围、实现状态、PASS/FAIL/未验证、根因与复测条件、截图/日志位置、未完成工作及下一步。用户数据、凭据、签名和本机文件按既有规则保护。

施工参考：

- [换电脑继续开发](continue-development.md)：环境准备、开发、检查与交接入口。
- [模块目录](../modules/)：按本次 scope 阅读对应功能的实现与接口；常用说明包括[户外功能](outdoor.md)、[手绘与行程](track-drawing-and-journey.md)、[路线和手机地图控件](mobile-controls-and-routes.md)、[导航天气与定位](navigation-weather-location.md)、[标记、区域与收藏](markers-areas-and-collections.md)、[离线地图缓存](automatic-map-cache.md)。
- [UI标准](ui-standard.md)：共享视觉令牌、布局和行为要求。
- [UI验收门禁](ui-quality-gate.md)：尺寸/状态检查、截图、点击、根因与验收表。
- [鸿蒙适配与安装状态](harmonyos-6.1-install.md)：平台现状与鸿蒙交付边界。

## 4. 项目门禁

- **数据与兼容：** 保留包名、签名、存储键和备份格式；先核对影响范围，禁止用模拟位置冒充 GPS，禁止覆盖或清除真实用户记录、照片和布局。
- **来源与授权：** 地图、地形和天气必须保留真实覆盖与署名。未取得所需授权或未解决许可时，不宣称全球完整、商用可发布或正式上线。
- **质量证据：** UI 按 `AGENTS.md` 顶部门禁和 `docs/ui-quality-gate.md` 验收；实测截图和点击是视觉证据，逻辑测试、类型检查与构建是对应代码证据，均不得互相替代。结果逐项记为 PASS、FAIL 或未验证。
- **平台边界：** 分别报告网页、Android、HarmonyOS能力。浏览器模拟不是 Android 触控/GPS/后台验收；Android APK 不是 HarmonyOS 原生包。鸿蒙原生仍未交付。
- **阶段与同步：** UI快速视觉阶段只做当前指定内容，暂不升版、打包、提交或推送；用户明确转入交付后，按 `AGENTS.md` 的版本、检查、同步和发布规则执行。不得把本地预览说成远程交付。
- **验收失败：** 必需项 FAIL 或未验证时，不报告该项通过，也不得基于它出包。说明阻塞证据和下一次复测条件，继续不依赖该结果的已授权工作。
