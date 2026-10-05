# 2026-10-05 双图规划路线显隐收尾

## 范围与运行方式

使用 `.openai/route-finish-20261005.mjs` 和 `.openai/route-finish-recorded-20261005.mjs`，通过 `scripts/browser-runtime.mjs` 的 `browserRuntime()` 启动 Edge Chromium headless。每个尺寸使用新的 Playwright context、独立 localStorage 和合成QA路线；没有读取或改写用户的9174浏览器存储。9174预览与3108本地API在检查时均返回HTTP 200。MapLibre对象仅在被隔离上下文拦截的 `TerrainMap.tsx` 响应中暴露给QA脚本，真实地图数据通过Map对象的GeoJSON source读取。

## 结果

| 验收项 | 390×857 | 360×780 | 证据 |
| --- | --- | --- | --- |
| 双图上图点选规划路线中段并显示路线卡/路线规划面板 | PASS | PASS | `route-finish-{390,360}.json` 的 `select route in upper map`；每图 `planned-route` 为3个要素（路线线段、起点、终点）。 |
| 上图操作隐藏/恢复，同时隐藏/恢复地图路线和同一路线收藏副本；双图与面板保留 | PASS | PASS | 两图 `planned-route` 均为3→0→3；`manual-tracks` 收藏副本为1→0→1；comparison、路线操作卡和路线规划面板保持打开。截图 `04-route-hidden-upper-{390,360}.png`、`05-route-restored-upper-{390,360}.png`。 |
| 关闭上图路线卡、下图点选并独立操作隐藏/恢复 | PASS | PASS | 关闭后双图仍打开且路线卡已收起；下图中段点选后重复3→0→3与1→0→1。截图 `08-route-hidden-lower-{390,360}.png`、`09-route-restored-lower-{390,360}.png`。 |
| 路线退出/返回路径与页面溢出 | PASS | PASS | “更多操作”返回主图路线详情，再关闭面板回到地图。比较视图下`body.clientWidth/scrollWidth`与`clientHeight/scrollHeight`分别为390×857及360×780，无页面溢出。 |
| 已记录轨迹详情隐藏/恢复与返回 | PASS | PASS | 两尺寸独立合成记录均为3→0→3；详情对话框保持打开，按钮在隐藏时变为“显示实走行程”，存储hidden状态随操作true→false；返回详情卡及地图浏览可达。截图 `recorded-02-hidden-{390,360}.png`、`recorded-03-restored-{390,360}.png`。这项在单图详情界面验收。 |
| 规划路线收藏副本匹配逻辑定向测试 | PASS | PASS | `node --experimental-strip-types --test tests/planned-route-visibility.test.mjs`，1/1。 |

上、下图点选由Playwright分别在对应MapLibre容器内以路线两端坐标的地理中点执行；两图的数据及操作卡状态均来自页面中实际地图对象和DOM。截图目录为 `artifacts/screenshots/route-finish-20261005/`，逐步JSON为 `route-finish-{390,360}.json` 与 `route-finish-recorded-{390,360}.json`。

本轮没有复现缺陷，因此没有修改应用源码。没有执行全套测试、类型检查、构建、打包、Git提交或推送；Android真机操作未验证。
