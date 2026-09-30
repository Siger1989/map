# 山兔

2026-09-30：0.2.88-test（versionCode95）根据使用反馈移除地图自动缓存、沿线下载和仅缓存入口，恢复正常联网请求，保留轨迹和导入图源。旧缓存数据不自动删除。860项测试、类型检查、APK资源与签名验证通过；手机速度待实测。[下载APK](https://github.com/Siger1989/map/releases/download/v0.2.88-test-standalone/Shantu-0.2.88-test-standalone-public.apk) · [发行说明](docs/release-0.2.88.md)。

2026-09-30：0.2.87-test（versionCode94）将自动缓存限定为路线附近实际浏览的瓦片，取消预取；删路线清理独占自动缓存。主动下载仅支持自行导入的在线图源和沿线区域，按图源声明开放19等整数级别。857项测试、类型检查和APK资源/签名核验通过，真机待验。[下载APK](https://github.com/Siger1989/map/releases/download/v0.2.87-test-standalone/Shantu-0.2.87-test-standalone-public.apk) · [发行说明](docs/release-0.2.87.md) · [使用说明](docs/automatic-map-cache.md)。

**2026-09-29 接续开发：** [完整交接](docs/handoff-20260929.md) · [上线图源准备与待核授权](docs/map-launch-readiness-20260929.md)。当前版本0.2.88，真机性能、真实云图/雷达和部分数据商用授权仍未完成。

2026-09-29：0.2.82-test（versionCode 89）优化路线分叉更新，压紧路线卡、移除左侧行程点栏、调整剖面线层级；横屏工具贴右边，摇杆右下，收藏左列表右地图，路线删除无需内部滚动。730tests/tsc/最终APK与原签名资源校验通过，OPPO性能仍待复测。[下载APK](https://github.com/Siger1989/map/releases/download/v0.2.82-test-standalone/Shantu-0.2.82-test-standalone.apk) · [发行说明](docs/release-0.2.82.md) · [性能证据](docs/performance-0.2.82.md)。

2026-09-28：0.2.81测试版，按当前视野筛选普通/分叉吸附候选，避免逐点投影远处路线，保留14px边缘范围与异常视角回退。分叉按钮整批更新仍待处理。[下载APK](https://github.com/Siger1989/map/releases/download/v0.2.81-test-standalone/Shantu-0.2.81-test-standalone.apk) · [性能验证](docs/performance-0.2.81.md)。

2026-09-28：0.2.80测试版，减少菜单同步与路线编辑全量重建，加入单轨差分和收藏数据缓存，修复收藏按钮内距及显隐滑选反馈。天地图栅格地名模糊完成排查，尚未改善；OPPO真机性能待复测。[下载APK](https://github.com/Siger1989/map/releases/download/v0.2.80-test-standalone/Shantu-0.2.80-test-standalone.apk) · [性能证据](docs/performance-0.2.80.md) · [发行说明](docs/release-0.2.80.md)。

2026-09-28：0.2.79测试版，优化分叉输入与吸附缓存、合并摇杆移动事件，降低3D渲染采样负担；真机效果待复测。[下载APK](https://github.com/Siger1989/map/releases/download/v0.2.79-test-standalone/Shantu-0.2.79-test-standalone.apk) · [性能证据](docs/performance-0.2.79.md) · [发行说明](docs/release-0.2.79.md)。

2026-09-28：0.2.78测试版，修复路线分叉候选扫描与按钮文字选择，并调整短横屏添加标记、工具和摇杆位置。[下载APK](https://github.com/Siger1989/map/releases/download/v0.2.78-test-standalone/Shantu-0.2.78-test-standalone.apk) · [验证与发行说明](docs/release-0.2.78.md)。

2026-09-28：0.2.77测试版，收紧记录、路线、剖面、标记和图层窗口，保留0.2.76全部按钮与操作。[下载APK](https://github.com/Siger1989/map/releases/download/v0.2.77-test-standalone/Shantu-0.2.77-test-standalone.apk) · [验证与发行说明](docs/release-0.2.77.md)。

2026-09-28：0.2.76测试版，路线拖点差分预览、返回先关菜单、联网优先、起终点坐标分享、移除立体云团。[下载APK](https://github.com/Siger1989/map/releases/download/v0.2.76-test-standalone/Shantu-0.2.76-test-standalone.apk) · [验证与发行说明](docs/release-0.2.76.md)。

2026-09-26：0.2.74测试APK，修正图层设置位置、标记返回自动保存及剖面选中时切换标记。[下载APK](https://github.com/Siger1989/map/releases/download/v0.2.74-test-standalone/Shantu-0.2.74-test-standalone.apk) · [验证与发行说明](docs/release-0.2.74.md)。

2026-09-25：0.2.72界面优化APK已构建，包含统一UI、高亮修复及图层设置记忆。[下载APK](https://github.com/Siger1989/map/releases/download/v0.2.72-test-standalone/Shantu-0.2.72-test-standalone.apk) · [验证与发行说明](docs/release-0.2.72.md)。

2026-09-25 UI：用户已确认深色黄绿样板。后续所有界面与子界面执行 [UI标准v1](docs/ui-standard.md)，当前迁移及验证见 [覆盖记录](docs/ui-migration-20260925.md)。

手机优先的三维地图、天气与户外轨迹工作台。

**2026-09-21：用户明确选择撤回整套 UI 改版，恢复 0.2.35。** 后续从本目录继续；PDF 保留为讨论资料，不代表授权重新套用被否定的实现。

## 接手入口

**2026-09-24 换电脑接续：** 先看[本次进度与回家接续说明](docs/progress-handoff-20260924.md)。当前已交付测试包为0.2.71；工作分支另含尚未进入该APK的图层/图源设置记忆源码。下方0.2.35/0.2.39描述为历史回退背景，不能据此判断当前版本。

1. [CURRENT_STATE.md](CURRENT_STATE.md)：当前基线、交付状态和下一步。
2. [AGENTS.md](AGENTS.md)：数据保护、模块边界与同步规则。
3. [Agent 交接](docs/agent-handoff.md)：已做内容、已撤回内容、工作树与恢复方式。
4. 按需阅读 [架构](docs/architecture.md)、[目录说明](docs/workspace-layout.md) 和对应 `modules/*/README.md`。

当前开发分支：`codex/rollback-ui-0235-20260921`，不是 `main`。业务基线是 `d01d9dc14bad4ecf19728514a3582087d47605bd`（0.2.35）；更高安装版本号只用于覆盖安装。

已发布 [0.2.39回退APK](https://github.com/Siger1989/map/releases/download/v0.2.39-test-standalone/Shantu-0.2.39-test-standalone.apk)：恢复0.2.35界面，附照片数据库兼容修正。验证与真机边界见[发行说明](docs/release-0.2.39.md)。

## 运行与检查

需要 Node.js 22.13+，建议24；首次或锁文件改变后执行 `npm ci`。

```sh
npm run dev
npx tsc --noEmit
npm test
npm run check:architecture
npm run build
```

布局编辑：`npm run start:layout`。不要随意终止既有服务、改端口或刷新用户窗口。
Android：`npm run build:apk -- -StandaloneTest`，SDK/JDK与原签名要求见 [开发说明](docs/continue-development.md)。

## 保留的项目能力

- 地图、地形、天气、图源与离线缓存；路网下载和离线算路。
- 画线、节点编辑、记录、导航、收藏、照片与文件交换。
- 标记与模型精确调整、测量/勘探/剖面。
- 0.2.35 的自定义布局、行程点数据和全线陡坡提示修复。

以上是代码能力概览，不等于真机验收。HarmonyOS 6.1 原生 HAP/APP 尚未交付。

## 当前讨论与历史

- [原始32页UI讨论PDF](docs/reference/ui-discussion-20260916.pdf)：保留最后文字修订；后续视觉方案先逐层确认再实现。
- [发布列表](https://github.com/Siger1989/map/releases)：安装包以实际 Release 为准，当前状态见首页交接。
- [历史索引](docs/history/README.md)：旧过程记录及历版说明；其中“最新”“通过”均只属于当时版本。
