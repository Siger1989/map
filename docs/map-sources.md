# 山兔：地图图源与本机地图

入口：**工具 → 地图图源**，或 **地图右上角“图层” → 地图图源**。“图层”是主地图上的独立按钮与浮窗，不再放在工具菜单中。内置地图可选地形、地表影像、最新云况；自定义地图保存在当前浏览器 / 设备的独立地图库。地图之外的三维地形、轨迹、照片、标记、道路与天气仍按各自开关叠加。最新云况仍受既有卫星服务的时次和覆盖限制。

## 添加方式

1. 粘贴图源地址、JSON / XML 配置，或选择配置文件。
2. 使用相机扫码，或选择已有二维码图片。识别结果先回到填写页，检查内容后再预览；不会自动跳转二维码中的网站。
3. 从系统文件选择器选择 MBTiles / GeoTIFF，检查名称、坐标范围和格式后确认。确认保存成功才切换底图；取消或识别失败保留当前地图。

| 格式            | 当前支持范围                                                                                                                                     |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| XYZ / TMS       | HTTPS 栅格模板 `{z}/{x}/{y}`，256 / 512 像素，0–22 级；TMS 行号在填写页选择，也可写进配置                                                        |
| WMTS            | EPSG:3857 / Web Mercator 瓦片地址，REST 或 KVP；识别 `{TileMatrix}` / `{TileCol}` / `{TileRow}`；图层、矩阵集和子域名需填具体值                  |
| WMS             | HTTPS GetMap 地址，CRS / SRS 为 EPSG:3857，BBOX 使用 `{bbox-epsg-3857}`；WIDTH / HEIGHT 与配置瓦片尺寸一致                                       |
| TileJSON / JSON | 栅格 `tiles` 或 `url`，可选 name、scheme、minzoom、maxzoom、tileSize、bounds、attribution；支持单项、数组、`maps` 数组。配置网址支持相对瓦片地址 |
| MOBAC XML       | `customMapSource` / `customMapSources` 下的名称、URL 和级别字段；`{$x}` 等模板转通用编号。不是任意 XML / GetCapabilities / 脚本执行器            |
| MBTiles         | 标准 SQLite metadata / tiles，TMS 行号、PNG / JPEG / WebP 栅格；最多 10 万张，单瓦片 ≤4 MB；不支持 PBF 矢量、加密或非标准 XYZ 行号文件           |
| GeoTIFF         | 8 位灰度 / RGB / RGBA 北向区域影像；EPSG:4326、3857、WGS84 UTM（32601–32660 / 32701–32760）。转换为 Web Mercator 显示副本，最长边 2048 像素      |

离线单文件 ≤64 MB；GeoTIFF 输入 ≤1600 万像素。地图库最多 20 项 / 256 MB，另受设备剩余存储空间影响。原文件不修改；GeoTIFF 保存转换后的 PNG 副本，大文件宜用 GIS 缩小范围或转栅格 MBTiles。跨日期变更线、旋转 TIFF、未知坐标系、PixelIsPoint、16 位 / 浮点高程及多光谱不在本次范围。

网页需要先打开应用、加载读取模块后再断网使用；本次没有新增网页离线启动缓存。Android 构建将页面、后台模块与 SQL WASM 一起内置，本机文件地图不依赖远程瓦片服务。在线天气、道路叠加和未缓存的三维高程仍各自需要网络，不能将其称为整个应用完全离线。

奥维提供的 `.ovmap` 和部分二维码属于专有格式，**不能保证通用导入**；本应用不解密。请向提供方索取本表中的标准格式。GPX / KML / KMZ 属于轨迹导入，使用“行程”入口。暂不支持 PMTiles、GeoPackage、Shapefile、矢量 Style JSON、GCJ-02 / BD-09 图源。

示例（example.org 仅为格式示例，不能实际取图）：

```json
{
  "name": "自定义地形",
  "tiles": ["https://maps.example.org/{z}/{x}/{y}.png"],
  "scheme": "xyz",
  "crs": "EPSG:3857",
  "minzoom": 0,
  "maxzoom": 18,
  "tileSize": 256,
  "attribution": "图源提供方"
}
```

在线图源直接由设备请求，服务需允许 HTTPS 与跨域访问；授权、费用、覆盖范围及可用性由提供方决定。配置识别成功不代表网络服务连通。不通过服务器代理任意 URL，不自动批量下载新增图源；原行程的区域缓存仍服务原有数据源。私人图源地址与令牌只在本机地图库中保存，未纳入轨迹备份或源码。

## 模块与接口

- `modules/mapSources/types.ts`：公共类型与限额。`online.ts`：受限配置解析、单次配置 URL 请求；无执行脚本。
- `storage.ts`：独立 `shantu-map-sources` IndexedDB，新增限额检查与写入在同一事务中；`useMapSources.ts`：选择、添加、移除及当前选择恢复。
- `MapSourcesPanel.tsx` / `mapSources.css`：列表、填写、识别预览三个步骤；`qr.ts` / `QrCamera.tsx`：本机二维码解码、相机流生命周期。
- `mbtiles.ts` / `geotiff.ts`：独立格式适配；`offline.worker.ts` / `offlineClient.ts`：后台读取、投影、瓦片查询和取消。导入可终止；地图切换释放旧 SQLite 实例与图像 URL。
- `MapSourceLayer.ts`：仅管理一个独立栅格底图，通过 MapLibre `shantu-map` 协议读本机瓦片，不重建样式或地图实例。
- `app/page.tsx` / `ControlDock.tsx` / `LayerPanel.tsx` / `TerrainMap.tsx`：公共 props 接线与原底图可见性。`vite.config.ts` / `mobile/vite.config.ts` 打包 ES Worker 和本机 SQL WASM。
- Android `CameraPermissions.java` 与 `LocationPermissions.java` / `MainActivity.java` / manifest：用户进入扫码后，仅向本应用 HTTPS 前台来源授予视频权限；不申请音频。文件导入继续走系统选择器。

新增依赖 jsqr、sql.js、geotiff、proj4，以及 SQL 类型定义。无业务文件删除；轨迹 / 照片数据库、定位筛选、天气与地形数据算法、包名、签名均保持。回滚撤销本轮源码即可，独立地图库可保留但旧版本不会读取；不要清除整个应用数据。

## 验证入口

`tests/map-sources.test.mjs`：在线格式与限额、真实 SQL / TMS、地理范围与 UTM 转换。

`scripts/verify-map-sources.mjs`：390×844 与 360×780，实际 QR 图片与文件选择、MBTiles Worker / 断网、GeoTIFF / 重载、切换保留叠加层、删除回退与配额事务。合成离线文件由 `scripts/map-source-fixtures.mjs` 生成；二维码样本 `tests/fixtures/map-sources-qr.png` 为 example.org 模板，没有真实账号信息。

`scripts/verify-map-source-bundle.mjs`：逐项比较完整 APK 与 mobile/dist 资产哈希，并用生产资源模拟安卓本机 HTTPS 网关；网络断开时验证导入、重开与选择离线文件。该模拟不等于 Android WebView 真机验收。

2026-09-07：TypeScript、148/148 逻辑测试、两尺寸实际导入与扫码生命周期回归、网页 / Android 未签名构建及上述生产资源测试通过；500 项 APK 资产一致，包含独立 Worker / SQL WASM。

执行类型检查、全套逻辑测试、网页构建、完整 Android 未签名构建。原生相机与 Android 系统文件选择器仍须真机验收；浏览器拒权模拟不等于真机授权通过。本机缺少原 0.2.4 私钥，不能发布可覆盖安装的新签名包；原包名与预期证书配置保持。

格式依据：[奥维自定义地图二维码](https://www.ovital.com/137268-2/)、[奥维地图分享](https://www.ovital.com/142734-2/)、[MapLibre sources](https://maplibre.org/maplibre-style-spec/sources/)、[MBTiles 1.3](https://github.com/mapbox/mbtiles-spec/blob/master/1.3/spec.md)。
