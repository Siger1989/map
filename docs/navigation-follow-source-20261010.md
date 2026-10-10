# 2026-10-10 路线卡片、跟随、偏航与图源接续

> **阶段更新（2026-10-10）：** 下文记录的是 0.2.119 APK 构建前的快速预览与验证；当时的未打包状态已由本版 APK 构建和交付核验记录取代。发行入口与远端核验方式见[0.2.119发行记录](release-0.2.119.md)。

本轮接续 10 月 9 日中断的已确认 UI 修改。实际仓库为 `D:\天气地图`，分支 `codex/rollback-ui-0235-20260921`，源码基线 `d77148672bf13508715a37f37b80b7bc4869b191`。当时既有未提交修改已保留，并处于快速预览阶段。

## 完成的行为

- 路线摘要整合起终点、交换和导航方式。起点绿、终点红；详情在操作区上方展开，底部按钮保持原位，折叠后保留已加载的海拔数据。导航方式下拉框实际宽约 60px，三种方式完整可读。
- 改变导航方式或交换起终点自动重新规划；旧请求取消、旧响应不能覆盖新选择，失败保留之前的有效路线。活动导航的卡片结果通过 `guidance.replaceRoute` 更新引导；收藏和轨迹导航准备也复用路线卡片。
- 跟随只更新地图中心，保留用户当前缩放。缩放按钮、滚轮和双指缩放不再暂停跟随；单指拖图、用户旋转和俯仰仍按浏览意图暂停。
- 道路导航偏航后，从最新有效且仍偏离路线的定位自动重规划；校验新结果仍覆盖最新位置。成功后更新引导和地图端点，保留原计划引用、导航时间和已走里程。轨迹导航保留接回原轨迹的语义。
- 主图及双图切换底图时保留各自的等高线、海拔着色、地形、道路、注记等设置。用户主动调整天地图注记、全球境界或坐标校正仍会生效。
- 本机私有 `apk-preview` 的天地图内置入口实际可见；环境 Key 非空、私有种子接口返回 200 且 38 条图源。凭据只核验存在性，没有写入本文。
- 复测发现双图退出后的焦点使外层地图 `overflow:hidden` 容器产生 `scrollTop=338.235`，整图及底栏被带偏。外层改为 `overflow:clip`，保留原有旧引擎 fallback；当前浏览器复测主容器 `scrollTop=0`、地图 y=0，路线详情完整显示。

## 实际验证

|项目|证据|结果|
|---|---|---|
|390×857 收起/展开|操作区 y 差 0，摘要高度约 210→518px，内容与容器没有内部滚动|PASS|
|360×780 收起/展开|操作区 y 差 0，展开顶部约 194px，下拉框宽约 60px|PASS|
|实际搜索、规划、切换方式|公开地点天府广场站西1口(南)→春熙路南口公交站；驾车 1.7km/5分钟→步行 1.5km/21分钟，交换后自动重算|PASS|
|交换/重算保留缩放|实际 zoom 14.134715983864698，交换前后差 0|PASS|
|主图切源|关闭的等高线/着色切天地图仍关闭；开启后切底图仍开启；切自定义高德源仍保留|PASS|
|天地图参数|主动选关闭注记、开启全球境界均生效；复测后恢复匹配底图/关闭境界及原高德底图|PASS|
|双图独立开关|上图等高线关、下图开；两边分别切图源仍各自保留；退出后主图恢复原设置|PASS|
|双图返回→路线→详情|地图宿主 scrollTop=0，展开顶部约 271px，底部操作区 y 差 0|PASS|
|跟随/偏航逻辑|25 项定向检查，包括真实 fix 有效性、过期结果拒绝、相机缩放保留和手势意图|PASS|
|路线卡片逻辑|16 项定向检查，包括换模、交换、请求取消与详情折叠保留|PASS|
|图源/双图逻辑|42 项定向检查，包括独立图层及参数更新|PASS|
|类型、最终 Web 构建、差异格式|`npx tsc --noEmit`；最后两项 CSS 修正后重新 Web 构建及 diff-check|PASS（构建最终结果见日志）|
|Android 实际跟随、连续偏航、后台和触控|当前预览未提供真实 GPS 设备验收；IP 定位未用作 GPS 验收|未验证|
|安装包和远程交付|0.2.119 APK 已构建核验；发行入口与远端核验方式见[发行记录](release-0.2.119.md)|以远端核验结果为准|

仅使用临时规划路线测试，没有导入 QA GeoJSON、收藏或保存测试线路；原有轨迹、标记、图源及私有配置保留。另建的 360 检查页仅用于测试，右侧默认预览维持 OPPO Find X8 的 390×857 比例。

## 接续入口和证据

主要修改在 `app/page.tsx`、`modules/navigation/`、`modules/workbench/useGuidanceWorkflow.ts`、`modules/guidance/`、`modules/map/`、`modules/mapSources/selection.ts` 及 `modules/mapComparison/`；新增/扩展相关定向测试。当时没有修改安装包版本号、签名或用户数据格式。

- 视觉数值：`.openai/continue-visual-evidence-20261009.json`。
- 实际截图：`artifacts/screenshots/continue-20261009/`，包含两尺寸路线卡、天地图入口、主图及双图开关。
- 定向日志：`.openai/continue-guidance-follow-20261009.log`、`.openai/continue-route-card-20261009.log`、`.openai/continue-source-panel-20261009.log`。
- 最终检查：`.openai/continue-tsc-20261009.log`、`.openai/continue-web-build-20261009.log`、`.openai/continue-diffcheck-20261009.log`。
- 返回路径复盘：`.openai/continue-comparison-exit-20261010.log`。
- 本轮启动的私有预览 Vite 9174 / API 3108，进程信息 `.openai/continue-preview-20261009.json`。启动日志含旧日期是因为本轮从 10 月 9 日持续至 10 日，不是另一套旧源码。

0.2.119 APK 已构建并完成产物核验；公开发行资产及源码状态按发行记录中的入口和核验方法确认。真实 Android 导航、位置跟随、偏航和后台行为仍需设备验证；旧公开 0.2.118 包不包含本轮修改。

## 发布后快速预览：记录入口与路线遮罩（未包含在0.2.119）

0.2.119构建完成后，另行修正了导航记录入口的底部定位和海拔 dock clearance，并调整真实路线图标遮罩，使1×1 overflow marker采用子节点遮罩。此阶段未升版、打包、提交或推送；0.2.119 APK与现有EXE不含这些发布后改动。

真实 `RouteLayer` 的隔离夹具在冷启动pitch60°、bearing35°、缩放和平移下，确认路线连续穿过气泡、照片块和预览点；helper遮罩落在三个可见子节点上（root/descendant mask统计 `0/3`），没有fixture A/B覆盖。快速导航/预览按钮各点击1次；清路线会清除遮罩，清除/恢复标记和切换样式后重新建立3个遮罩，2D路线也连续可见。截图：`artifacts/screenshots/nav-icons-20261010/final-helper-pitch60-bearing35-zoom.jpg`、`final-helper-2d.jpg`。测试fixture为 `.openai/nav-icon-layer-qa-20261010.html` / `.ts`，只使用合成路线和本地背景样式，不含GPS、外部瓦片或用户存档。

21项路线遮罩定向检查、全量 TypeScript 与最终 Web 构建通过。架构检查仍有10项历史长度预算超限；发布后新增324/200行未超限。

用户随后明确要求将这些发布后修复纳入`0.2.120-test/code127`并上传GitHub。两份APK已本地构建并完成aapt、原签名、zipalign、ZIP项和terrain资源核验；实际大小/哈希见[0.2.120发行记录](release-0.2.120.md)。强化正/负控通过：`targetsByMarker` helper与新CSS只在120出现，119负控保留旧规则，120移除`home-recording bottom+94px`及left共享selector。全量构建与源码检查已完成。两份APK已构建核验；发行入口为固定tag `v0.2.120-test-standalone`，源码与公开资产的实际发布结果由远端tag及本机 `.openai/release-120-github.json` 核验。

### 导航记录入口集成复验

390×857与360×780导航布局的完整实测使用此前的原9174同origin源码编译预览 [`nav-built-assets-phone-20261010-fresh.html`](http://127.0.0.1:9174/@fs/D:/天气地图/.openai/nav-built-assets-phone-20261010-fresh.html)：公开步行规划→开始导航→设置→关闭/开启海拔曲线→返回/收起。两尺寸均保持`guiding=true`、记录入口`left=8px`；曲线显示时`bottom=166px`、与图表间距`16.054px`、`--nav-info-clearance=110px`；关闭曲线后`bottom=116px`且图表节点消失。390还验证单色模式下legend选项保持勾选、profile从false切true会准确重新挂载曲线；360结束时恢复`profile=true`，390恢复原样式与`legend=false`。这组布局验收属于源码预览，不标记为120 APK复验。

本轮120 fresh phone页面 [`nav-built-120-fresh-phone.html`](http://127.0.0.1:9174/@fs/D:/天气地图/.openai/nav-built-120-fresh-phone.html) 完成HTTP/MIME、页面版本`0.2.120-test/code127`、地图加载并保留存档及关于面板的检查；没有在该页面重跑390/360完整导航布局流程。

本次只验证预览布局，没有开始录制，也没有保存或导入数据。证据 `.openai/nav-record-layout-20261010.json`；截图 `artifacts/screenshots/nav-icons-20261010/final-navigation-{390,360}-{curve,no-curve}.jpg`。partial DEM、IP fallback ±50000m环境不作为真实GPS证据；Android设备定位/触控/后台及HarmonyOS原生包仍未验。0.2.119 APK不含这些修复，现有EXE仍0.2.118。两份APK已构建核验；发行入口为固定tag `v0.2.120-test-standalone`，源码与公开资产的实际发布结果由远端tag及本机 `.openai/release-120-github.json` 核验。
