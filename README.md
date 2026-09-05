# 观云 · 三维天气观察

面向电脑浏览器的天气与三维地形工作台。默认在川西卧龙附近，支持地图拖动、旋转、俯视/斜视/侧视、海拔读取、高清地表和最近卫星观测、带米数等高线、中文地名、道路河流、模型驱动的简化三维云雨、逐小时时间轴。

## 运行

Node.js 22.13+：`npm install`，然后 `npm run dev`。`npm run build` 生成 Cloudflare Worker 构建。安装完成自动运行 `scripts/sync-map-worker.mjs`，将与主包版本一致的 MapLibre 模块 worker 放到公开静态目录。不可删除或改用开发打包器自动推断的 worker 路径，否则 DEM 与矢量瓦片会一直等待。

## 模块边界

| 模块 | 入口和职责 | 对外接口与依赖 |
|---|---|---|
| 工作台 | `app/page.tsx`：状态与模块组合 | 通过 props 传递图层状态、选中地点、天气时间；不读取模块内部变量 |
| 地图 | `modules/map/TerrainMap.tsx`：地图生命周期、来源组装、相机和点击 | `MapHandle` 的 zoom/north/reset/view/inspect；依赖 MapLibre 和数据模块 |
| 地形 | `modules/terrain/terrain.ts`、`elevation.ts`：DEM、阴影、等高线、原始高程 | baseStyle/addContours/readElevation；地形增强不修改海拔数值 |
| 卫星 | `modules/satellite/satellite.ts`、`app/api/satellite/route.ts` | 查询 NASA 元数据，再检查当前位置最多近五日覆盖；日期与预报时间独立 |
| 常规地图 | `modules/cartography/cartography.ts` | addCartography/syncCartography；OpenFreeMap 矢量道路、河流、地名、山峰 |
| 天气 | `modules/weather/data.ts`、`useWeather.ts` | 数据适配与 null 值保留；25 点区域网格、25 个小时、15 分钟更新 |
| 云雨 | `modules/weather/WeatherLayer.ts` | update(data,index,settings)；Three.js 实例化云层、按降雨值生成雨线 |
| 控制 | `modules/controls/` | 八项图层开关、影像模式、视角盘、时间轴、选点数值；ElevationLegend 与地形共享颜色配置；可选 WebMCP 使用同一状态 |

## 数据与真实性

- **地形**：成都区域（东经 103–105°、北纬 30–31°）采用 FABDEM V1-2 去建筑/树木影响的约 30 米地面高程，Hawker / Neal / University of Bristol，CC BY-NC-SA 4.0 非商业许可。473 张静态 Terrarium 瓦片由 `scripts/prepare-ground-terrain.py` 从两幅原始 TIFF 双线性重投影得到，外缘约 5 公里与原 Mapzen 数据融合；不人为压平城区。其他地区使用 Mapzen / SRTM。`app/api/terrain/[z]/[x]/[y]/route.ts` 为网格、等高线、着色和海拔读取提供统一来源。重建数据需 Python numpy/Pillow/rasterio；浏览器运行不依赖 Python。https://research-information.bris.ac.uk/en/datasets/fabdem-v1-2/
- **海拔着色**：`modules/terrain/elevationColors.ts` 共用分段阈值与图例；0–5000m 每 500m 一档，5000–6000m 一档，6000m 以上一档。全强度颜色便于识别高度；关闭后恢复卫星地表。默认起伏比例 1×，着色与海拔读数始终不乘增强倍数。
- **视角恢复**：地图位置、缩放、旋转与俯仰保存在 URL hash，刷新后保留视角。
- **高清地表**：EOX Sentinel-2 cloudless 2024，10 米级年度无云合成。它是历史合成影像，不是当天拍摄。免费服务限非商业用途，须遵守 CC BY-NC-SA 4.0 与署名。https://cloudless.eox.at/pricing
- **最新观测**：NASA GIBS VIIRS 真彩色，通常比高清地表粗。显示提供方最新日期，并为当前位置回溯最多五日检查有效像素覆盖。页面注明 UTC 日期；云遮挡和当天尚未过境的区域可能没有可用地表影像。https://nasa-gibs.github.io/gibs-api-docs/
- **道路地名**：OpenFreeMap / OpenMapTiles / OpenStreetMap，优先中文字段；数据完整程度随地区不同。仅展示道路，不含导航路线规划。https://openfreemap.org/quick_start/
- **天气**：Open-Meteo 通过 best-match 模型提供预报，25 点采样不是密集实测网格。雨量是对应一小时的 rain 累积毫米数，雨雪分开。免费 API 限非商业用途。https://open-meteo.com/en/docs
- **三维云雨是示意**：低/中/高云量决定云团数量，高度、形状和雨滴轨迹不是雷达实测三维重建。零雨不画雨；缺失值保留为空。卫星拍摄时间不跟随预报时间轴改变。
- 无需 API 密钥；所有数据署名在地图底部与时间轴显示。

## 验证与回滚

- `npx tsc --noEmit`
- `node --experimental-strip-types --test tests/weather.test.mjs`
- `npm run build`
- 浏览器检查三维山脊、中文标注与海拔；通过视角工具验证相机与图层状态一致、非法角度拒绝。
- 新增项目，无旧业务模块被删除。跨模块变更均由类型接口连接；单个图层可在工作台独立关闭或替换数据适配器。

进度与验证证据见 `CURRENT_STATE.md`。
