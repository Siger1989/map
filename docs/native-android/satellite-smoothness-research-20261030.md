# 卫星地图流畅度研究与对照

2026-10-30。用户反馈143手机仍特别卡，要求研究其它卫星地图并达到非常流畅的体验。本轮目标是确定瓶颈和可执行路线；143不再作为“流畅已验收”的结论。用户随后已明确确认手机安装的是143测试包，该版本真机流畅度FAIL，不能归因于装错142。保留原生地图、原React业务/UI、私人天地图、区域FABDEM/修补与全球回退、主双图、绘制/记录/分享等契约。后续144施工和无注入连续拖动对照另见 `performance-fix-144-20261030.md`，本文的消融数据仍只作诊断。

## 成熟实现中可以核实的做法

- [MapLibre Native的Android数据流](https://maplibre.org/maplibre-native/docs/book/design/android-map-rendering-data-flow.html)将MapView输入交给GL线程及Native Core。可借鉴原生输入到渲染的直接通路，不能由文档推断具体手机FPS。
- [Cesium Globe](https://cesium.com/learn/cesiumjs/ref-doc/Globe.html)公开了屏幕空间误差LOD、祖先瓦片预加载、可见瓦片缓存保护、后代加载限制。其tileCacheSize约束的是可释放缓存，当前帧仍需要的瓦片不会因达到普通缓存数量而被强行释放。较大误差阈值会降低质量，不能把调粗地形作为未披露的提速。
- [Mapbox的性能统计](https://docs.mapbox.com/android/maps/guides/debugging-and-profiling/performance-stats/)提供逐帧/逐图层时长和纹理/顶点内存，配合[可重放场景与Tracing](https://docs.mapbox.com/android/maps/guides/debugging-and-profiling/)定位瓶颈。统计本身有开销，诊断与最终验收要分开。

工程建议：原生输入/相机/绘制独立于JS和网络；数据后台准备，主线程和GPU上传按帧预算消费；移动期间保留现有画面和父瓦片，优先当前可见区域，取消过期视口请求；业务只同步最新状态，手势结束再精确补齐和持久化。上述是从公开机制与本项目瓶颈得到的设计建议，不是对闭源Google Earth/奥维/高德内部实现的断言。

## 引擎能力比较

| 候选 | 已核实能力 | 本项目边界 | 实测性能结论 |
|---|---|---|---|
| 当前WorldWind + React UI | 已接私人影像、区域/修补/回退DEM及现有功能 | 每帧业务桥接、地形拾取、缓存/调度仍需整改 | 143正式小渲染面仅21.6–29.4FPS；未达到非常流畅 |
| MapLibre Native Android | C++/GL渲染管线、栅格图源 | [官方terrain支持表](https://maplibre.org/maplibre-style-spec/terrain/)目前将Native Android/iOS真实地形标为不支持；RasterDemSource/阴影并不等于起伏地形 | 未做同机原型，不写FPS；不能直接替换全部3D功能 |
| Mapbox Maps Android | 官方有真实3D Terrain和性能诊断接口 | [Android图源指南](https://docs.mapbox.com/android/maps/guides/styles/work-with-layers/#raster-dem)写明支持的DEM为Mapbox Terrain-DEM；自有FABDEM/修补的实际接入与授权需原型核实，不能凭URL参数存在就宣称完整兼容 | 未做同机原型，不能保证60FPS |
| ArcGIS Maps SDK Kotlin SceneView | [WebTiledLayer](https://developers.arcgis.com/kotlin/v200/api-reference/arcgis-maps-kotlin/com.arcgismaps.mapping.layers/-web-tiled-layer/index.html)接非Esri影像；[RasterElevationSource](https://developers.arcgis.com/kotlin/v200/api-reference/arcgis-maps-kotlin/com.arcgismaps.mapping/-raster-elevation-source/index.html)接本地高程文件到3D表面 | 自有Terrarium PNG需转SDK支持的高程数据；修补优先级/全球回退/双图/绘制需验证；[开发/部署许可](https://developers.arcgis.com/kotlin/api-reference/arcgis-maps-kotlin/com.arcgismaps/-license/index.html)需核实 | 适合作为完整原生3D的备选原型；无实测FPS，不宣称已经更快 |
| Cesium技术路线 | 球体、地形/影像层级LOD与可见缓存机制公开 | CesiumJS不能冒充原生地图；Cesium Native还需渲染与Android接入，不能当现成替换SDK | 作为调度/工作集设计参考，不把浏览器演示当手机验收 |

更换影像服务商主要影响请求/清晰补齐时间；已缓存情况下的主线程阻塞、桥接、网格生成和GPU负担仍需解决。也不通过突破私人图源限流来改善加载。

## 当前143链路审计

1. `NativeReactMapHost.onRenderedFrame`每33ms最多发布一次；并非WorldWind渲染器被硬限制为30FPS。发布前会调用cameraJson、构造正逆矩阵、JSON序列化并触发DEM/吸附同步。
2. 普通手势DOWN清除地面锚点；`NativeMapController.cameraSnapshot`因此可能在每个已发布帧对中心点调用pickTerrainPosition。DEM footprint另有25个投地和最多5个地形拾取。
3. `NativeTerrainMap.emitCamera/updateProjection`对变化的相机每帧回调React业务，并写localStorage及history.replaceState；触摸MOVE还约24ms一次跨桥通知。
4. WorldWind本身使用RENDERMODE_WHEN_DIRTY，未发现独立的30FPS硬上限。之前增加缓存和减少getPixel解决了一部分问题，不能替代输入与渲染通路整改。

## 本轮隔离实验

精确143/code150原APK，MuMu实例3，4核/4GiB、390×857、160dpi、应用CSS390×833；TDT高清、道路/标签/真实地形开启，中心102.9/31、zoom12/pitch55。四次顺序为control→mute-frame→mute-frame→control，每次同32次连续物理拖动，重置相机并预热15秒。

两种模式都临时注入同一Frida观察器：control照常调用原onRenderedFrame；mute-frame跳过该宿主回调，WorldWind绘制、影像、地形、画质与原始MotionEvent保持。回调命中计数留档，截图人工核对地图和相机。该模式会冻结/省略业务相机、投影、DEM等同步，**只是定位，不是交付功能**。两种模式均有注入，数据不能与此前无注入正式验收直接拼成性能倍数；顺序、缓存/JIT和宿主调度仍有影响。

| 物理渲染面 | 模式 | FPS | ≥54ms慢帧 | P95桶 ms | 四核CPU均值 | 峰值PSS MiB |
|---|---|---|---|---|---|---|
| 390x857 | case0-control | 31.2 | 9.7% | 66 | 56.8% | 466.1 |
| 390x857 | case1-mute-frame | 44.0 | 4.2% | 50 | 31.0% | 407.2 |
| 390x857 | case2-mute-frame | 46.9 | 3.4% | 33 | 21.4% | 368.0 |
| 390x857 | case3-control | 12.6 | 49.2% | 250 | 68.0% | 458.6 |
| 1256x2760 | case0-control | 23.1 | 21.9% | 118 | 57.6% | 455.1 |
| 1256x2760 | case1-mute-frame | 48.1 | 4.5% | 50 | 20.4% | 378.3 |

高像素组已确认MuMu物理1256×2760/dpi515，WebView CSS391×834、原生地图回调1256×2679（扣状态栏）。另一次wm临时尺寸被系统限制为780×1714且CSS243×526，已排除，不当Find X8像素负载。高像素组仅一对，四核虚拟机并非Find X8硬件；输入为连续命令执行的32次独立swipe，包含抬手间隙，统计可能包含非持续触摸空档，不能由平均FPS推定引擎极限或真实输入延迟。正式55/60FPS验收需增加连续单指流和活动期FrameTimeline。

归档指标见[`artifacts/performance/satellite-smoothness-20261030/`](../../artifacts/performance/satellite-smoothness-20261030/)，文本仅归一行尾空白；截图和诊断脚本在本机`.openai/smoothness-ab-20261030/`、`smoothness-phone-pixels-20261030/`及`.openai/smoothness-*.cjs/.py`。

证据支持：每帧宿主同步/地形采样链是主要负担之一。即使暂时移除，约44–47FPS仍未稳定60；不能宣称已找到全部瓶颈或手机已流畅。将现有完整链路原样迁到另一SDK也不能自动解决此负担。

## 建议施工顺序与门禁

这是现有项目内的性能路线建议，尚未实施成新交付包：

1. 给原生相机/渲染建立直接输入通路。帧矩阵保留最新值，按需拉取或合并；禁止每帧持久化和地址栏改写。精确地形拾取服务实际任务，普通浏览的业务通知不阻塞绘制。手势结束再提交精确相机并补齐DEM；双图、跟随、绘制等实时功能逐项保留，不能直接沿用消融开关。
2. 遥测分别记录UI线程、原生准备、GL/GPU呈现、JS桥事件、中心拾取/DEM任务、图层组装与纹理解码。分别测冷加载和热缓存手势，不用加载耗时冒充交互性能。
3. 按可见工作集保护瓦片，优先屏内/当前视口、保留父瓦片，控制解码/上传预算。内存紧张时回收屏外内容；不靠继续无上限增加缓存，也不隐藏高清/地形开关。
4. 先验证整改后的当前引擎；若原生绘制通路仍达不到门槛，再做ArcGIS SceneView等隔离原型，先证明私人影像+自有高程+原生触控+基本叠加能力，再决定迁移。新引擎不得宣称已保持全部功能。

建议将“非常流畅”的验收目标设为60FPS档：连续拖动/缩放平均至少55FPS、P95帧间隔≤33ms、>50ms慢帧<1%，并记录P99和最差1秒，防止平均FPS掩盖长卡顿。至少两轮交错测试，包含实际1256×2760物理渲染面、普通浏览/3D/道路与注记/双图；无黑块断图、停止后无持续忙循环、长时间内存无单向增长。触摸到画面响应须另测，不能从FPS直接推出。门槛是本轮建议，不冒充用户已确认具体数值或真机通过。

Find X8最终验收必须在手机本身完成；MuMu达到目标只算进入真机测试的条件。当前143仍未通过上述新门槛。本轮不修改产品源码、不升版本、不发布APK，原交付与私人数据保留。
