# 手机地图控件、道路路线与手绘轨迹

更新：2026-09-05。本轮保留已有数据模块，实现手机紧凑控件、道路路线、按示意图的视角模型/旋转环和牵引杆手绘。

## 界面入口

`app/page.tsx` 组合模块并通过 props 传状态；`app/layout.tsx` 与 `mobile/main.tsx` 共用样式。`ControlDock.tsx` 只管理小浮窗与收起，移除原先常驻的上拉摘要、时间轴、地图页签和拖柄。默认底部控件 40px 高，标题 36px 高，海拔图例 66px 宽。天气、时间和图层信息仍可打开；地质颜色说明继续常驻地图。

- `modules/controls/{ControlDock,WeatherSummary,MapActions,ElevationLegend}.tsx`：入口与信息；`workspace.css` 管布局，`panels.css` 管控件内容。
- `CameraGizmo.tsx`：固定底点的绿色立体楔形模型 + 椭圆旋转环。俯仰 0–80°，环处理跨 ±180°；鼠标/触摸拖动、键盘方向键均通过 onView 回调，不读取 MapLibre 内部状态。原 ViewController 文件保留，但旧大控制器入口移除。
- `modules/geology/legend.css`：缩小外置地质图例；不更改地质颜色含义。

## 道路规划模块

`modules/navigation/`：

| 文件 | 职责 / 对外接口 |
| --- | --- |
| `types.ts` | WGS84 经纬度、出行方式、RoutePlace / PlannedRoute / RouteOverlay。路段保留坐标、米、秒及累计耗时，供未来沿途天气消费。 |
| `provider.ts` | planRoute / searchPlaces / normalizeRoute / normalizePlaces；可替换服务地址与解析器。真实道路匹配；未找到路线或数据异常时明确失败，不画直线冒充路线。 |
| `useNavigation.ts` | 起终点、出行方式、请求状态；端点/模式改变清掉旧路线并取消旧请求。 |
| `RoutePanel.tsx` | 手动搜索、候选确认、图钉选点、交换/清除、规划、看全程和中文转向列表。 |
| `RouteLayer.ts` | 接收 RouteOverlay，添加地图 GeoJSON 路线及起终点，不操作 UI 或天气。 |
| `navigation.css` | 小浮窗内的路线内容。 |

当前连接 [FOSSGIS Valhalla 公共实例](https://valhalla.github.io/valhalla/start/introduction/)，使用 OSRM 格式与 GeoJSON，分别请求 auto / bicycle / pedestrian；不是一个驾车结果换标签。中文地名使用 [Photon](https://github.com/komoot/photon#demo-server)，由用户点击提交才请求。没有接入公共 Nominatim。

原型请求使用 1.1 秒间隔、15 分钟内存缓存、25 秒超时、响应大小及坐标校验，重置/切换会取消请求。公开实例无 SLA；[FOSSGIS 使用摘要](https://routing.openstreetmap.de/about.html)要求署名、有效 UA/Referer、最多每秒一次、不得大量抓取。Photon 也仅允许合理小量调用。单个客户端限速不等于多用户总量合规；正式分发前应切换自有后台或有明确服务保障的供应商，统一处理总量限制。安卓 UA 含 Guanyun 版本，界面有服务/OSM 署名与纠错链接。

当前路线是基于 OSM 道路和方式的预估，没有实时路况、封路、定位跟随或语音播报；沿途天气当前在手绘轨迹详情中提供。选点会匹配附近道路，较大偏移在详情提示；选点到道路的空白段不假装已规划。山区数据完整性与现实可通行性仍需确认。

## 手绘轨迹模块

0.1.2 已更新为精确定点＋平滑绘制、单指画/双指原生控图、吸附/续画/合并、可调细线与颜色，以及整线高程统计和沿途天气。当前实现与完整接口说明见 [精确绘制、吸附与整线分析](track-drawing-and-journey.md)。

## 地图 / 原生连接与回滚

`TerrainMap.tsx` 新增 RouteOverlay / TrackOverlay 和 onMapPick；MapHandle 暴露 fitRoute、focusPoint、stop、toCoordinate。反投影使用 MapLibre 的 terrain 参数与投影回检，避免直接在天空画地理坐标。页面 memoize 覆盖状态，相机变化不重复送路线数据。

`MainActivity.java` 消费已应用的系统安全区并改进返回优先级。`AndroidManifest.xml` 升到 versionCode 3 / 0.1.2-test；`scripts/build-android.ps1` 按版本命名，保持原签名。

未更改地形数据算法、天气/云雨计算、卫星来源、道路地名源、地质 API。移除的是旧 UI 入口/定位方式，没有删除原数据功能。回滚本轮可恢复页面、控件样式、地图新增接口与原生容器，并撤去 navigation/tracks 模块及样式导入；原数据模块无需回滚。

## 验证

- TypeScript 与网页/静态安卓构建。
- 既有天气/地质14项；路线6项；牵引/存档/旋转7项；安卓返回脚本3项，共30项。
- 真实服务：同一成都起终点返回驾车约2.0km/356s、骑行2.55km/577s、步行2.10km/1730s；Photon 返回“都江堰”中文候选。保存详细响应在忽略的 `.openai/` 验证日志中。
- APK 签名/版本/启动入口/473张高程瓦片/资源索引与 worker；真机触控、视觉、功耗尚未验证。
