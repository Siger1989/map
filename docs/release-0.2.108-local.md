# 0.2.108-test 本地私有 APK（2026-10-06）

用户最新要求移除整个天气图层及云图，替代此前国内雷达接入目标。本轮交付已完成该范围，并保留地图、卫星底图、地形地质、轨迹编辑记录、导航和行程时间安排。

## 最终产物

- APK：`APK/Shantu-0.2.108-test-standalone.apk`
- 版本：`0.2.108-test`，versionCode `115`，包名 `com.guanyun.weather.shantu.preview`
- 大小：66,081,340 字节
- SHA-256：`4e69ade731a64c1ab14cc6d99acbc7ced9eaffa7c20a7f08b4a16154987c0fc4`
- 最终完整构建 stage：`mobile/.build/apk-20261006-110938`
- 本地私有包包含用户图源配置，不公开上传 APK；源码同步至功能分支 `codex/rollback-ui-0235-20260921`，未合入 `main`。构建基准 HEAD：`33e44a5a3e8ce81a7e96cceff3dda88f23714c63`；源码提交为包含本记录的交付提交。

首次 108 候选包发现轨迹详情仍有天气查询，已移除并完整重新构建；交付文件为上方最终 stage 对应的包，不使用早期候选。

## 改动及兼容

移除主图/双图的天气图层、卫星云图、雷达查看器、天气图例与面板、天气时间轴/播放、沿途天气查询，以及相关自动请求和地图天气 MCP 工具。新的地图 MCP 工具仅提供地图视角与地图图层。旧天气开关在读取、保存、外部补丁和双图快照恢复时会被忽略，不能重新开启已退役天气图层；地质与海拔着色互斥规则保留。

照片不再自动查询天气，也不显示无效的重新查询入口；无历史天气的照片显示“未记录”。已有照片天气/错误字段仍可读取和导出，旧行程归档与通用后端/原生兼容接口保留，不清用户数据。卫星影像是地图底图，保留。未修改用户轨迹几何、PDF、地质资料或签名身份。

## 验证

- 最终 TypeScript 检查 PASS，最终完整网页及 Android 构建 PASS（仅既有 chunk 大小和 Java deprecated API 提示）。
- 主定向测试 75 项 PASS，1 项照片测试因测试加载器失败；修正测试加载器后单项复跑 PASS。最终行程/收藏行程/分享回归 14/14 PASS。日志 `.openai/remove-weather-main-tests.log`、`.openai/remove-weather-main-photo-test.log`、`.openai/remove-weather-final-journey-share-tests.log`、`.openai/remove-weather-final-tsc.log`。
- 签名证书与既有配置一致，v2/v3、CRC、zipalign PASS。stage/APK 1,907 项资产集合一致：1,411 项逐字节一致、496 张地形 PNG 像素与非 IDAT 元数据一致；38 个私有种子、1,365 张概览瓦片和预览/生产/包内图源 Key 一致性布尔检查 PASS。未输出 Key。证据 `.openai/package-02108-verify.json`。
- 最终 APK 客户端资产天气入口/图层/云图请求标记均不再存在，地图 MCP 与 108 版本存在；证据 `.openai/package-02108-feature-content.json`。此项不声称所有历史天气代码/API 已删除。
- 源码预览 390×857、360×780：主图图层、工具、双图上下图层、退出返回、画线暂停后隐藏界面恢复、锁定/解锁 PASS。隔离 API 所观察的 `/api/weather*`、`/api/radar*` 请求计数为零；该计数不测量直接外部云图 URL，云图退役另由源码及最终 APK 资产核验。
- 最终 APK stage 浏览器两尺寸图层、返回和无横向溢出 PASS；源码9174预览与版本/图源配置相同。截图目录 `artifacts/screenshots/remove-weather-20261006/`，最终包截图 `final-stage-layers-390.png`、`final-stage-layers-360.png`。
- `git diff --check` PASS。全仓 architecture 检查仍失败于 10 个既有文件长度限制；与基准 HEAD 对照，没有新增违规文件，不能称全仓检查全部通过。证据 `.openai/remove-weather-architecture-baseline-20261006.json`。

## 验收边界

本轮 `adb devices` 无设备，Android 真机安装、触控、GPS、朝向与后台未验；HarmonyOS 原生包未交付。浏览器启动日志曾出现未定位的 MutationObserver 异常，此前已单独诊断且未确定来源，不声称零页面异常。删点/拖点后线条需缩放才刷新的旧版本报告仍未定位修复，不将天气移除称作轨迹修复。

用户9174预览显示版本108/code115，使用其已保存的高德卫星底图及原有标记；无需清数据来匹配隔离stage的默认Sentinel底图。主预览仍提示部分高程瓦片未加载，本轮不宣称网络地形瓦片全部通过。

构建日志 `.openai/apk-02108-final-build-20261006.log`，验包日志 `.openai/package-02108-verify.log`。原107及更早包和文档保留为历史记录。
