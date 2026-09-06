# 0.2.1-test 保留原 3D 控制器

恢复右下角原有绿色模型与圆环控制器，打开地图即显示：拖绿色模型调俯仰，沿圆环滑动调旋转。工具里的视角盘按钮仍可临时收起。其他户外功能保留，剖面继续停用。

# 0.2.0-test 户外与极简地图更新

新增实走记录、GPX/KML/KMZ 交换、JSON 存档备份、可续传离线行程包与出发时间天气比较。默认 OpenFreeMap / OSM 免 Key 地图，界面常驻三入口；视角盘与复杂图层按需打开，剖面保持停用。详见 [户外功能说明](docs/outdoor.md)。

# 观云 · 三维天气观察

剖面功能按当前要求暂时停用：界面不显示入口，也不启用地形裁切。代码保留，供以后继续研究。历史实现见 [自由矩形剖面](docs/elevation-section.md)。

新增：地图上点选手绘路线、标记名称或模型可查看详情并编辑；完成绘制后，长按节点、标记名称或模型本体约半秒可拖动位置，坐标同步更新，支持撤销。见 [路线与标记编辑](docs/selection-and-node-editing.md)。

新增：手绘道路/小路吸附、地图标记、米制长方体/圆柱/球体与地下半透明模型，以及天地图国内底图配置。使用方法、参数定义和国内接入边界见 [道路、模型与国内图源](docs/roads-models-domestic.md)。天地图真实服务仍需本应用有效 Key，不能视为全功能无 VPN 验收通过。

面向手机和电脑浏览器的天气与三维地形工作台。默认在川西卧龙附近，支持地图拖动、旋转、俯视/斜视/侧视、海拔读取、高清地表和最近卫星观测、带米数等高线、中文地名、道路河流、模型驱动的简化三维云雨、逐小时时间轴。

代码同步：[Siger1989/map](https://github.com/Siger1989/map) · [下载安装包](https://github.com/Siger1989/map/releases) · [回家继续开发](docs/continue-development.md)。最新进度在 `CURRENT_STATE.md`，后续同步规则在 `AGENTS.md`。

## 运行

建议 Node.js 24：`npm ci`，然后 `npm run dev`。`npm run build` 生成 Cloudflare Worker 构建。安装完成自动运行 `scripts/sync-map-worker.mjs`，将与主包版本一致的 MapLibre 模块 worker 放到公开静态目录。不可删除或改用开发打包器自动推断的 worker 路径，否则 DEM 与矢量瓦片会一直等待。

## 模块边界

| 模块 | 入口和职责 | 对外接口与依赖 |
|---|---|---|
| 工作台 | `app/page.tsx`：状态与模块组合 | 通过 props 传递图层状态、选中地点、天气时间；不读取模块内部变量 |
| 地图 | `modules/map/TerrainMap.tsx`：地图生命周期、来源组装、相机和点击 | `MapHandle` 的 zoom/north/reset/view/inspect；依赖 MapLibre 和数据模块 |
| 地形 | `modules/terrain/terrain.ts`、`elevation.ts`：DEM、阴影、等高线、原始高程 | baseStyle/addContours/readElevation；地形增强不修改海拔数值 |
| 卫星 | `modules/satellite/satellite.ts`、`app/api/satellite/route.ts` | 查询 NASA 元数据，再检查当前位置最多近五日覆盖；日期与预报时间独立 |
| 常规地图 | `modules/cartography/cartography.ts` | addCartography/syncCartography；OpenFreeMap 矢量道路、河流、地名、山峰 |
| 地质 | `modules/geology/GeologyLayer.ts`、`data.ts`、`GeologyPanel.tsx` | sync(settings)/dispose；通过 GeologyState 回传当前视野图例和点选属性；依赖 MapLibre、固定 Macrostrat 瓦片代理 |
| 天气 | `modules/weather/data.ts`、`useWeather.ts` | 数据适配与 null 值保留；25 点区域网格、25 个小时、15 分钟更新 |
| 云雨 | `modules/weather/WeatherLayer.ts` | update(data,index,settings)；Three.js 实例化云层、按降雨值生成雨线 |
| 控制 | `modules/controls/` | 八项图层开关、影像模式、视角盘、时间轴、选点数值；ElevationLegend 与地形共享颜色配置；可选 WebMCP 使用同一状态 |

## 数据与真实性

- **地形**：成都区域（东经 103–105°、北纬 30–31°）采用 FABDEM V1-2 去建筑/树木影响的约 30 米地面高程，Hawker / Neal / University of Bristol，CC BY-NC-SA 4.0 非商业许可。473 张静态 Terrarium 瓦片由 `scripts/prepare-ground-terrain.py` 从两幅原始 TIFF 双线性重投影得到，外缘约 5 公里与原 Mapzen 数据融合；不人为压平城区。其他地区使用 Mapzen / SRTM。`app/api/terrain/[z]/[x]/[y]/route.ts` 为网格、等高线、着色和海拔读取提供统一来源。重建数据需 Python numpy/Pillow/rasterio；浏览器运行不依赖 Python。https://research-information.bris.ac.uk/en/datasets/fabdem-v1-2/
- **海拔着色**：`modules/terrain/elevationColors.ts` 共用分段阈值与图例；0–5000m 每 500m 一档，5000–6000m 一档，6000m 以上一档。全强度颜色便于识别高度；关闭后恢复卫星地表。默认起伏比例 1×，着色与海拔读数始终不乘增强倍数。
- **地质投射**：Macrostrat 地层/岩性颜色和构造线贴合三维山体；当前中国区域实际为 Chorlton / Geological Survey of Canada 的 2007 世界地质概览，非 1∶20 万详图、非地下剖面。图例放在地图独立浮窗，直接显示当前视野颜色及中文说明；点选显示原图属性。地质与海拔着色互斥，透明度可调。来源署名与许可链接保留在地图和浮窗。上游中国 z6 以上实测为空，固定最高请求 z5，放大不会提高原始精度。
- **视角恢复**：地图位置、缩放、旋转与俯仰保存在 URL hash，刷新后保留视角。
- **高清地表**：EOX Sentinel-2 cloudless 2024，10 米级年度无云合成。它是历史合成影像，不是当天拍摄。免费服务限非商业用途，须遵守 CC BY-NC-SA 4.0 与署名。https://cloudless.eox.at/pricing
- **最新观测**：NASA GIBS VIIRS 真彩色，通常比高清地表粗。显示提供方最新日期，并为当前位置回溯最多五日检查有效像素覆盖。页面注明 UTC 日期；云遮挡和当天尚未过境的区域可能没有可用地表影像。https://nasa-gibs.github.io/gibs-api-docs/
- **道路地名**：OpenFreeMap / OpenMapTiles / OpenStreetMap，优先中文字段；数据完整程度随地区不同。底图层仅展示道路；路线由独立 navigation 模块请求道路规划服务。https://openfreemap.org/quick_start/
- **天气**：Open-Meteo 通过 best-match 模型提供预报，25 点采样不是密集实测网格。雨量是对应一小时的 rain 累积毫米数，雨雪分开。免费 API 限非商业用途。https://open-meteo.com/en/docs
- **三维云雨是示意**：低/中/高云量决定云团数量，高度、形状和雨滴轨迹不是雷达实测三维重建。零雨不画雨；缺失值保留为空。卫星拍摄时间不跟随预报时间轴改变。
- 国际演示图源无需 API 密钥；可选国内天地图需要本应用 Key。所有数据署名在地图底部与时间轴显示。

## 验证与回滚

- `npx tsc --noEmit`
- `node --experimental-strip-types --test tests/*.test.mjs`
- `npm run build`
- 浏览器检查三维山脊、中文标注与海拔；通过视角工具验证相机与图层状态一致、非法角度拒绝。
- 新增项目，无旧业务模块被删除。跨模块变更均由类型接口连接；单个图层可在工作台独立关闭或替换数据适配器。

进度与验证证据见 `CURRENT_STATE.md`。

## 商用替代资源与地质详图

已新增地质云 WMTS 授权适配器，在地图外置图例切换“世界概览 / 1∶20 万 · 地质云”。Token 保存在服务端 `.env.local`；真实服务须通过 Capabilities 比例尺校验再加载。目前未取得有效授权和真实瓦片。配置和验证边界见 [地质云接入说明](docs/geocloud-integration.md)。

已核对的免费资源、接入成本、1∶20 万官方数据集入口与尚未明确的再分发许可见 [数据来源调查](docs/data-sources.md)。本轮仅新增地质图及独立图例，未替换 EOX 2024、FABDEM、Open-Meteo，当前原型仍含非商业使用的数据/服务。未接入存在再分发限制的 USGS geo3al。

本轮修改入口为 `app/page.tsx`、`app/globals.css`、`modules/map/{types.ts,TerrainMap.tsx}`、`modules/controls/{LayerPanel.tsx,useMapTools.ts}`；新增 `modules/geology/`、`app/api/geology/tiles/[z]/[x]/[y]/route.ts` 和 `tests/geology.test.mjs`。没有删除业务功能；天气模型、云雨动画、卫星数据、道路和地形算法保持原样。回滚地质功能时，移除独立模块/代理及上述入口；关闭开关即可停止显示该层。

## 手机地图、路线与手绘轨迹

手机默认显示地图、小标题、窄图例与一行工具按钮，原上拉大面板已取消。天气、时间轴、图层按需打开小浮窗。绿色模型固定底点，拖动调俯仰；滑动外环旋转，地图仍支持双指角度操作。

“路线”包含道路规划和手绘轨迹。道路规划已接 FOSSGIS / Valhalla，支持驾车、骑行、步行，配合 Photon 中文地名搜索或地图选起终点；显示距离、预计耗时、转向。手绘支持精确定点和平滑牵引、单指画/双指控图、节点吸附、续画/合并与整线统计，沿途天气可在手绘线路详情获取。实时定位跟随与语音导航尚未实现。

新增模块为 `modules/navigation/`、`modules/tracks/`、`controls/CameraGizmo.tsx` 与算法；更新 `app/page.tsx`、控件/图例样式、`TerrainMap.tsx` 的类型接口、网页/手机入口及安卓安全区/返回处理。未更改天气、地形、云雨、卫星和地质数据算法。详细文件职责、服务条件、验证和回滚见 [本轮说明](docs/mobile-controls-and-routes.md)。

## 安卓安装包

`npm run build:apk` 生成 `APK/Guanyun-0.1.3-test.apk`。使用同一签名时，已安装旧版可直接覆盖更新，不需要卸载；电脑本地修改不会自动更新手机。应用联网获取公开数据，不依赖电脑 localhost。安装要求及架构见 [安卓测试版说明](mobile/README.md)。

公共路线/搜索实例适合小量测试，正式销售需要有保障的服务与合法数据授权；其他来源中的非商业限制尚未全部替换。1∶20万地质云仍缺授权。0.1.3验证包括编译、55项逻辑检查、实际路线/搜索/沿途预报响应与 APK 签名资源检查；新版真机操作和性能待验收。
## 0.1.2 精确轨迹与整线分析

0.1.2阶段功能：默认放大镜精定位后牵引平滑画线，也保留逐点连线；单指画、双指直接控制地图。支持节点吸附、已保存线路续画/反向/合并相接线路、细线和颜色设置；手机浮窗缩到252px/44dvh。草稿和存档详情新增全程里程、高程剖面、爬升下降和按出发时间/速度匹配的沿途预报。

本轮涉及 `modules/tracks/`、新 `modules/journey/`、`modules/map/magnifier.ts`、地图/页面props与样式导入、浮窗尺寸以及安卓版本。移除旧绘制层拦截所有触摸和暂停移图流程；道路规划、既有地图数据源、地质、云雨图层不变。具体文件职责、使用步骤、数据限制与验证见 [轨迹与整线分析](docs/track-drawing-and-journey.md)。

## 0.1.3 导航天气、收藏与定位

新增道路沿途气温/降水双列色带、按定位显示行程进度、出发时间设置、统一收藏夹、当前位置和正北/手机方向模式。修复零高度地图外层容器造成的触摸坐标无效与放大镜空白。完整使用方法、权限、文件清单与验证边界见 [本轮说明](docs/navigation-weather-location.md)。新定位/方向功能需要手机授权与对应硬件，未做真机手感和传感器验收。
