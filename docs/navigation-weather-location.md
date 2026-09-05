# 0.1.3 路线天气、收藏、定位与方向

## 手机操作

- 道路规划成功后，地图左侧显示沿途天气色带：左列气温、右列降水，上起点、下终点。点色带看该里程处的气温、降水和预计到达时间，点“颜色说明”看区间图例。灰色表示缺测，干燥天气使用不同颜色。
- 点色带标题“沿途天气”打开路线详情，修改北京时间出发时间或重试预报。天气点按路线里程采样2–8处，使用各路段预计耗时估算到达时间，预报取最近整点；降水是预报整点前一小时雨雪总量。不是整趟累计雨量，也不代表每个山谷的实况。
- 右侧准星按钮获取当前位置，蓝点与浅蓝圆表示位置和精度范围。开启后持续更新地图标记与行程进度，点“停定位”停止并清除标记；切到后台暂停定位、回前台恢复此前主动开启的定位。当前位置也可直接设为路线起点。
- 左侧进度线来自定位在路线上的投影。没有定位、定位超过60秒、精度差于250米或离路线太远时显示对应提示，不能把人在路线外硬映射成进度。允许误差为50–150米范围内按定位精度调整。没有语音导航、偏航重算、实时路况或自动地图跟随。
- “北”按钮将地图恢复正北朝上并停止传感器跟随；“随”按钮开启/关闭手机方向。它使用具有北向参考的绝对方向或系统罗盘读数，不能把无北向参考的陀螺仪相对角度当作方向。支持的浏览器会请求传感器许可，不支持/无读数则提示。手机尽量平放并校准；绘制时暂停自动转图，手动旋转地图或操作视角环退出方向跟随。
- 路线结果点“收藏路线”；“路线 → 收藏夹”可打开、移除道路路线，也列出本机保存的手绘线路。道路路线最多20条，保存起终点、方式、完整线与转向列表。恢复的是收藏时的道路计算，想取最新道路结果应重新规划。收藏不上传，清除应用数据会丢失。

## 画线故障修复

0.1.2触摸坐标与放大镜读取了MapLibre的`canvas-container`尺寸；画布绝对定位时外层容器可能高度为0，导致触摸坐标无效、放大镜空白。0.1.3改用`getCanvas()`的真实CSS尺寸和边界，并补充零高度外层容器测试。

另外提高绘制状态`touch-action:none`的CSS优先级，避免关闭地图单指平移时，浏览器重新接管拖动并取消触摸。仍保留真实双指平移/缩放/旋转/俯仰处理。

画法：①按住地图移动准星，松手只确认精确起点；②从旁边的绿色牵引环按住拖动才开始画线，下一笔从终点续画。提示已明确分两步。原平滑防抖、逐点、吸附、撤销、样式、续画与整线分析保留。

## 文件和模块

| 模块/文件 | 职责和接口 |
| --- | --- |
| `modules/position/types.ts`, `usePosition.ts` | 定位校验、方向角与跨360度处理；用户操作启动定位/传感器，输出位置/精度/模式/提示；不写地图内部状态。 |
| `modules/position/PositionLayer.ts`, `position.css` | GeoJSON位置蓝点/闭合精度圆和按钮状态，接收PositionFix。 |
| `modules/journey/routeProgress.ts` | 路段耗时/天气采样、最近路线位置与进度、颜色阈值。 |
| `modules/journey/useRouteJourney.ts` | 复用天气适配器，管理路线出发时间与异步请求，旧路线回复不会覆盖新路线。 |
| `modules/journey/RouteWeatherRail.tsx`, `route-rail.css` | 左侧双列色带、点选详情、颜色图例、进度和出发时间输入。 |
| `modules/navigation/favorites.ts`, `useRouteFavorites.ts`, `FavoritesPanel.tsx` | 收藏校验/存储与列表；useNavigation.restore通过公共接口恢复。 |
| `modules/navigation/RoutePanel.tsx` | 当前定位作起点与收藏按钮，路段/搜索接口保持。 |
| `modules/tracks/DrawingGestureBridge.ts`, `TrackDrawing.tsx`, `tracks.css`, `modules/map/magnifier.ts` | 真实画布坐标/放大、触摸CSS优先级、明确起笔提示。 |
| `modules/map/TerrainMap.tsx`, `app/page.tsx`, `modules/controls/{MapActions,ControlDock}.tsx` | props连接定位/方向/天气/收藏；原地图资料和图层保持。 |
| `mobile/android/src/com/guanyun/weather/LocationPermissions.java` | WebChromeClient仅授权本应用HTTPS资源域，按需申请Android前台精确/大致位置许可。 |
| `MainActivity.java`, `AndroidManifest.xml` | 安装权限回调、WebView定位、版本0.1.3/code4。没有后台定位权限、后台服务或新的JavaScript原生对象桥。 |

网页`app/layout.tsx`和安卓`mobile/main.tsx`导入相同样式。新增`tests/route-tools.test.mjs`并加强`tests/track-interaction.test.mjs`。

删除/替换的是错误的坐标尺寸来源及旧起笔提示，没有删除地图/轨迹业务功能。原地形数据/地质/卫星/云雨、道路规划服务和原始天气接口不改。回滚本轮可撤去position与道路天气/收藏入口、恢复画布连接和权限/版本；应单独保留坐标修复以避免复现画不了。

## 验证与限制

55项测试通过，覆盖零高外层触摸和放大镜、精定位与吸附、路线沿程距离/耗时/偏离、缺测颜色、收藏校验和恢复、方向角、位置数据与精度圈样式；TypeScript和最终网页/APK构建结果记录在CURRENT_STATE.md。

用此前实际规划的成都步行路线（约2.1km/1730秒）通过新适配器请求天气，起终点分别返回168小时预报，并通过收藏格式校验。未伪造手机定位或方向读数。当前没有adb设备，未执行真实手机GPS授权、传感器方向、渲染/手感/功耗验收，也没有浏览器视觉自动化。网页定位需要安全上下文；局域网HTTP页面可能受限，建议使用APK或HTTPS。

官方接口参考：[Geolocation](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition)、[绝对方向事件](https://developer.mozilla.org/en-US/docs/Web/API/Window/deviceorientationabsolute_event)、[Android WebChromeClient](https://developer.android.com/reference/android/webkit/WebChromeClient)、[Open-Meteo](https://open-meteo.com/en/docs)。现有非商业数据授权和公开服务配额边界保持；不代表正式商用发行已经完成。
