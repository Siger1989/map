# 地图加载与奥维架构对照 · 2026-10-27

用户确认：手机 APK、内置天地图；进入后长时间空白与拖动/放大后缺块两种情况都有。当前先查地图加载，原生重建保留进度，不扩大 UI 迁移。没有连接真实手机，不能把代码路径或历史本机 HTTP 记录当成手机根因实测。

## 奥维公开证据

- 官方目录说明（2026-07-30）：在线浏览缓存存于 `mapcache.sdb`，离线地图按图源目录保存，收藏/配置/附件独立存放。https://www.ovital.com/140600/
- 官方手机手册 v6.7.1 第16页：在线模式本地数据库及浏览缓存缺失时才联网；离线模式只加载本地数据库/浏览缓存。这是旧版手册，不能据此断言当前版缓存优先级、容量、淘汰算法完全未变。https://download.ovital.com/pub/omapTool_UserGuide_Phone_v671.pdf
- 官方自定义图源教程（2026-10-26）：通过投影、XYZ级别、图块尺寸、URL及Key配置接入在线图源，底图和注记可分层。https://www.ovital.com/131425-2/
- 官网说明影像与高程结合呈现三维，支持多源地图和离线能力。https://www.ovital.com/
- 上述只能支持功能层架构概括：地图浏览/显示 + 本地图块数据库/浏览缓存 + 在线图源接入 + 高程/对象叠加。未找到足够官方公开证据确认 Android 内部语言、具体渲染库、线程数、请求去重/退避策略；不将其说成 Flutter、Kotlin、C++、Qt、MapLibre 或 WorldWind 的确定实现，也不声称所有流量经过奥维服务器。

## 山兔当前源码已确认路径

1. `modules/terrain/terrain.ts` 的内置 raster sources 使用 `tiandituTiles()` 输出的官方 WMTS HTTPS 地址。
2. `modules/map/TerrainMap.tsx` 的 transformRequest 为 `offlineMapTransform`；`modules/outdoor/tileCache.ts` 在普通在线模式原样返回 URL。
3. Android `MainActivity.java` 调用 `LocalGateway.intercept`；后者对非应用本地 host 返回 null，因此官方天地图由 WebView/MapLibre 直连，未走 `/api/map-tile` 的原生预算管理。
4. `modules/mapSources/tileTransport.ts` / `cachedTileTransport.ts` 为另一条取图路径。内置普通在线天地图没有接入该 IndexedDB + 内存浏览缓存。不能据此说完全无缓存：MapLibre驻留瓦片、WebView/HTTP缓存及显式离线包仍存在。
5. 当前主图设置全局图片并发16；这不等于天地图专用并发/配额控制。MapLibre 6.7.0的 ajax/image_request/raster_tile_source 对失败返回错误状态；未发现应用层针对内置天地图的 Retry-After 共享冷却/定时补载。不得据此断言16并发一定导致限流。
6. `docs/release-0.2.138.md` 有本机44次HTTP429的历史记录，141仅单次HTTP200通过；均不能证明当前手机持续加载正常或具体配额不足。

## 下一步边界

优先在内置天地图实际取图路径补充可脱敏诊断，再验证缓存复用、429退避、请求超时、取消及当前视口补载。主图和双图必须一起覆盖；不能只修改导入图源路径。保留注册Key、原图源、清晰度、相机、现有功能和存档，不通过切换账号/域名规避上游限制。

缓存改善回访及重新打开；首次进入从未缓存区域仍依赖图源服务。按相同地图/区域/缩放/网络分别比较冷缓存、回访、重开、拖动缩放、断网恢复，记录首张图/完整视口时间、请求量、HTTP状态及缓存命中，不能以构建或模拟吞吐代替真机结果。

本次为只读架构审计与资料研究，没有修改旧版地图运行代码，没有重新压测天地图，没有生成替代旧版的安装包。
