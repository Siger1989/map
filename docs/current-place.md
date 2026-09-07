# 地图中心地名

“山兔”后显示当前地图中心的地区名称。地图拖动结束、搜索定位、GPS跟随、图源范围跳转和URL恢复都会更新中心；点击别处读取天气不会改变页头的地图中心含义。3级以下显示“世界地图”，3至7级优先国家/省州，8级起优先城市/区县，长名字省略，鼠标悬停可查看完整地名与坐标。

查询使用现有[Photon逆地理API](https://github.com/komoot/photon/blob/master/docs/api-v1.md#reverse)，请求中心保留两位小数、10km半径、单条结果；不采用附近商店名作为地区名。900ms防抖，复用navigation/provider每服务1.1秒间隔、15分钟/24条内存缓存，12秒超时，移动后取消旧请求，迟到结果不能覆盖新位置。无匹配显示“未命名区域”，失败显示“地名暂不可用”；网络恢复后重试。没有新增定位权限或位置存档。

Photon按附近OSM对象的行政信息返回地名，精度和语言受数据覆盖限制，不是行政边界核验。查询服务不可用时不保留上一地区冒充当前地名。演示服务仅适合小量测试，正式分发应更换有统一流量控制的服务，见[Photon说明](https://github.com/komoot/photon#demo-server)。原地图OSM署名保持。

模块：navigation/placeName.ts负责解析与坐标网格，provider.ts提供reversePlace共享请求边界，usePlaceName.ts处理防抖/取消/重试；controls/PlaceName.tsx负责显示；TerrainMap公开onCenter回调，app/page.tsx通过props接线。workspace.css限制页头宽度，避开右上图层入口，地图与复位按钮保留原交互。回滚撤销本轮回调、组件与查询代码即可，旧数据格式不变。
