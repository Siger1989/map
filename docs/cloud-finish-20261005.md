# 双图真实卫星云图验收 · 2026-10-05

## 范围

补验主图与双图各自的 NSMC 卫星云图显示，不改图层产品逻辑或双图公共模块。仅使用独立 Playwright context；未读写用户浏览器存档。预览 `9174` 和本地 API `3108` 开工时均未监听，按仓库已有启动流程启动；验收使用 `msedge` headless。期间没有打包、升版或改 Git 状态。

## 结果

| 状态 | 实测 | 结果 |
| --- | --- | --- |
| 实际双图 | 390×857 与 360×780 各创建两个 MapLibre 实例；NSMC GetMap 通过本机 `/api/map-tile` 请求，HTTP 200；地图源均报告已加载 | PASS |
| 云图可见性 | 视角手动缩小到 zoom 4 后，上方 Sentinel-2 2025 影像与下方地形底图均可见真实云带；非模拟数据 | PASS |
| 独立开关 | 分别关闭其中一图时另一图云层仍在；两图均可重新加载 | PASS |
| 观测时次 | 每图通过“显示参数”选择更早时次再切回最新；样式源 URL 随选择更新。实际 NSMC 响应包括最新 `202610050300` 与较早 `202610040400` | PASS |
| 透明度 | 方向键操作滑块；上图设为 0.25、下图 0.70 时读取实际 MapLibre `raster-opacity`，互不覆盖；截图最终状态分别为 0.50 与 0.70 | PASS |
| 相机 | 云图开关、时次与透明度操作前后中心、zoom、pitch、bearing 完全相同：`[104.0666718, 30.6666745]`、4、40、0 | PASS |
| 关闭返回 | 关闭对比图层设置后回到双地图；两 pane 与两份连接中的 MapLibre 实例仍存在 | PASS |
| 浏览器错误 | 无未捕获 page error | PASS |
| Android 触控与性能 | 本次未验 | 未验证 |

两张截图保存在 [`artifacts/screenshots/cloud-finish-20261005/`](../artifacts/screenshots/cloud-finish-20261005/)：390×857 与 360×780。独立复跑脚本为 [`.openai/cloud-finish-20261005.mjs`](../.openai/cloud-finish-20261005.mjs)，结构化结果为 [`.openai/cloud-finish-20261005-results.json`](../.openai/cloud-finish-20261005-results.json)。

## 定向检查

`node --experimental-strip-types --test tests/satellite-cloud.test.mjs tests/cloud-projection.test.mjs`：10/10 通过。未改 TypeScript 源码，未运行全套测试、类型检查、网页构建或 APK。

未改 `app/page.tsx`、双图公共组件、`SatelliteCloudLayer.ts`、`cloudProjection.ts`、`satelliteCloud.ts` 或云图逻辑测试；未输出地图 Key 或用户数据。浏览器证据只覆盖本地 Chromium/MapLibre 渲染，真机触控、内存与网络性能仍待设备实测。
