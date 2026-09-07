# 逐点整段沿路吸附（2026-09-08）

工具 → 画线 → 逐点连线，开启「道路吸附」。点选起点和后续位置，两点之间的预览、绘制结果和保存数据都会保留道路的完整拐弯。每点一次提交一整段，撤销一次撤回这一段；绘制时只显示选定端点，不用密集的自动拐点占据地图。

## 按距离连接

端点按屏幕距离选择附近道路，沿已加载道路计算两点间的最短连接。桥梁、隧道或不同 layer 属性不再阻断连接；相隔不超过约3米的道路端点/图块接缝按距离衔接。不会把两次点击之间整段替换成穿越山体的直线。

普通路、山间小路使用同一套交互。距离是吸附依据，这属于绘图辅助，不使用交通规则、通行状态或单向行驶限制做导航规划。

仍需开启道路图层、地图放大到12级以上并加载道路矢量。当前计算范围为已渲染道路，未加载或较大断口会提示补点；无法从纯卫星照片识别道路。跨很大范围可沿路分段点选。现有保存的直线轨迹不会自动重写；自由描线模式、原路线规划、标记、照片、定位与本机存储格式保持。

## 实现

- `modules/tracks/roadPath.ts`：道路折线建图、端点接缝、最短路径、图大小与输出点数边界。
- `modules/map/roadSnap.ts`：复用地图已有矢量道路，300ms候选缓存；不逐次触摸请求外部路线服务。
- `DrawingSession`/`TrackDrawing`：整段预览和提交一致；无连接时不提交直线。
- `draft`/`useManualTracks`：整段保存、单次撤销、选择节点保留。
- `TrackLayer`：绘制时隐藏自动生成的密集编辑控制点；结束绘制后仍可编辑。

## 验证

TypeScript、226项测试、网页及安卓网页构建 PASS。新增7项回归覆盖双向弯道、发卡弯、不同道路属性、小接缝与较大断口、分图块连接、预览/保存/撤销一致。

测试地图道路取自 OpenFreeMap 的公开道路矢量，13/14级跨桥和图块走廊均通过。浏览器13.9级真实点选两个较远位置，橙色线完整跟随弯道，单次撤销后只保留起点，二次撤销草稿为空。截图 `artifacts/screenshots/road-distance-bridge.png` / `road-distance-undo.png`；构建日志 `.openai/*road-path*.log`。390/360像素DOM无横向溢出，绘制按钮在屏内；精确手机截图受既有缩放捕获问题限制。手机实际触控仍待真机验收；本轮未生成APK。

## 数据与接口参考

回归片段来自 OpenFreeMap `20260830_080001_pt`，2026-09-08下载，保留公开道路几何用于离线回归，未包含用户轨迹。

- [OpenFreeMap](https://openfreemap.org/) / [OpenMapTiles](https://openmaptiles.org/schema/) / [OpenStreetMap contributors，ODbL](https://www.openstreetmap.org/copyright)
- [OpenMapTiles transportation属性](https://github.com/openmaptiles/openmaptiles/blob/master/layers/transportation/transportation.yaml)
- [MapLibre道路要素查询与图块边界说明](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/)
