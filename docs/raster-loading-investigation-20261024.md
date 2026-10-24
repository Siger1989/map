# 地图粗细拼块与加载策略调查

用户确认现象：一块清楚、一块模糊，等待较久才完整；此前137 APK在没有缓存下载时也觉得变慢。此次先交付138 Mac独立窗口测试包，再核查当前源码和MapLibre官方资料；没有把手机问题假定为后台缓存抢网。

## 已确认与待确认

1. 当前默认高清 (`modules/map/types.ts`) 配合 `RasterQuality.sync` 将选中栅格的tileSize减半。MapLibre据此多取一级，普通同范围瓦片数量通常约四倍，边缘/3D覆盖会改变具体数量。这是保留最终高细节的设计，但立即铺满高一级会延长粗细混合阶段；不是提供方图片尺寸错误，不能简单把128改回256当作高清已修复。
2. MapLibre在理想瓦片未到时寻找已加载父/子瓦片作为替代，因此不同区域逐块变清晰符合其机制。当前地图未覆写 `cancelPendingTileRequestsWhileZooming`，库默认true：放大时取消仍在加载的较低级瓦片。设false可保留渐进过渡，但也增加请求和渲染，必须对照，不能说必然最快。
3. `MapSourceLayer` 与Sentinel将raster-fade-duration设0，清晰瓦片出现时直接替换，分块边界更明显。增加短渐变只改变观感，并不会缩短网络等待。
4. 错误恢复确有缺口：当前MapLibre非404错误将tile置为errored；同一视野复用该tile不会自行重新请求。TerrainMap的error处理只显示状态。上一轮本机天地图44次HTTP429已确认，不能推断用户手机/其它图源也均为429。应尊重Retry-After，有限退避只补失败瓦片，避免整屏刷新和无限重试。
5. 若用户开启固定级别，`RasterDetailPatch`最多144张、2路下载，整批成功后才提交canvas；一张失败会放弃整批显示，原地没有自动重试。该模式应分块完成/只补缺块，不能强迫整屏等最慢一张。尚未确认用户此次是否开启固定级别，因此不作为手机根因定论。
6. 两个DEM source (`elevation`/`shading`) 指向相同URL，但是否真实重复网络取数取决于缓存和运行时，尚未测量；没有未经验证合并地形来源。

## 优先改造方向

先保证当前屏幕的同源基础影像完整，保留已显示的父级图，再在交互停稳后逐步补当前视野的高清。高清目标、相机、图源与存档保持；不靠永久降低清晰度或批量重拉全屏制造提速。

首先补有限失败恢复与取消过期视野；其次对比“立即高清”和“基础影像后补高清”的首屏完整时间、90%高清覆盖时间、失败率与解码长任务。固定级别单独移除整批成功屏障。并发只作为有上限的参数，按真实图源/手机测量，不能把32路或16路称为普适最佳。

该调查未修改加载策略，138仍是上一轮并发回退版本；Mac138也未包含尚未实现的渐进高清或失败补图。未再发起高频真实图源请求，不换Key或子域绕过限流。

## 官方依据

- [MapLibre Life of a Tile](https://github.com/maplibre/maplibre-gl-js/blob/main/developer-guides/life-of-a-tile.md)：理想瓦片和父/子替代瓦片、网络与渲染阶段。
- [MapOptions](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/#cancelpendingtilerequestswhilezooming)：缩放时取消/保留父级请求的取舍。
- [并发参数](https://maplibre.org/maplibre-gl-js/docs/API/functions/setMaxParallelImageRequests/)：影像请求默认16，不承诺最高数值最快。
- [栅格图层](https://maplibre.org/maplibre-style-spec/layers/#raster-fade-duration)：渐变与重采样属于显示策略。
- [HTTP 429](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Status/429)：限流及Retry-After；没有查到可适用于用户Key的具体天地图频率额度，不臆测配额。

远端文档可能比安装版本更新，涉及行为已同时核对本机MapLibre 6.7.0的image_request、raster_tile_source与tile_manager源码。
