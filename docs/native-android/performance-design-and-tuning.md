> **157试修更新**：手机156仍静止闪烁，未确认根因。当前GPU纹理/缓冲预算在非低内存设备上取“旧heap/2、8–192MiB”与物理内存1/16的较大值，封顶512MiB；未知/低内存设备保留旧算法。主双图分别计量，非预分配但可能增加驻留。以下192MiB记载仅适用于156历史。画线MOVE每显示帧最多处理最新一次，瓦片焦点重排最多20Hz，抬手前flush；长度按新增段累计，路网图按快照复用/A*最多4000扩展。调整入口仍是`NativeRenderMemoryBudget.kt`、`NativeMapController.kt`、`NativeReactMapHost.kt`、`DrawingSession.ts`、`roadPath.ts`。真机验证边界见[157交接](../HANDOFF-20261031-157.md)。

> 156指定模拟器场景实测：几何缓存约110MiB、21块、排队0；静止无继续生成；单图Java heap约146MiB，双图采样约235–267MiB，GPU缓存仍192MiB/窗。仅这些场景，不代表真机/长时峰值。155的32MiB循环失败是历史。

> 用户最新要求：视觉对齐WebView已确认效果；速度目标是直接更快，不与WebView对照。优化依据实际耗时、中心首图时间、缓存命中与峰值内存。

# 原生地图性能参数与调优路线

> 状态基线：2026-10-31。本文说明当前 `mobile-native/` 源码实际值、作用和调参时应观察的量，不承诺未经对照测出的收益。候选154仍在施工/验收中：152等高线路径曾触发 Java heap OOM，153没有显示等高线；154存在局部出线/中心空白；下一候选源码已拆分 `source floor=7` 与 UI zoom 门槛，并加入生成前真实光标请求优先级，尚待实际验证。不要把以下当前源码值误读成154最终值或已通过验收。

## 读数原则

地图速度不是一个开关。至少分开记录请求排队/网络、磁盘缓存、PNG解码、DEM采样、矢量组装、GPU纹理驻留与上传、每帧绘制、相机同步。一次改动只应改变一个预算/门槛，再在同设备、同视口、同图源、同层开关和同手势下比较；记录静止、首次拖到新区域、回拖、旋转/倾斜、双图各自及同时操作。要说明性能收益，必须有重复样本和阶段计数/耗时，不能从代码上限推导倍速。

## 参数与实际效果

| 参数 / 当前值 | 在做什么、增大或减小的方向 | 代价与边界 | 源码入口 | 定向复测 |
|---|---|---|---|---|
| 地图网络 `MAX_ACTIVE_REQUESTS=20` | `BoundedTileNetwork`共享调度器的全局同时活动请求数；调大可增加并行候选，调小可减轻连接/解码争用。调度器按最新可见窗口的光标距离重排**尚未开始**的队列，8个同视口请求后给另一可见视口机会；隐藏/后台请求让前台先行，后台最多占2槽。 | 20 是应用内部上限，不是每秒20张，也不是天地图账号官方QPS；没有据此证明服务允许更多请求。已在途HTTP不会因拖图被抢占，只有排队请求能按新光标重排。不能只改此值而不核对 WorldWind `remoteRetrievalQueueSize`，当前两者都设20。 | `map/BoundedTileNetwork.kt`: `MAX_ACTIVE_REQUESTS`, `TileRequestQueuePolicy`, `TileRequestPermitScheduler`; `map/NativeMapController.kt` 初始化中的 `remoteRetrievalQueueSize`。 | 冷区域首屏与连续拖动分别看队列等待/命中、活动请求数、429/Retry-After、decode耗时和首个完整可见帧；增加并发后若429、解码排队或帧慢增加，应回退。双图需看两视口是否均有前进。凭据/URL不得进日志。 |
| 普通浏览持久缓存 `8 GiB` | APP 自管 `filesDir/shantu-map-browse-cache` 瓦片目录，缓存可跨返回/重启复用；目标按字节增长，另留256 MiB系统可用空间，条目默认24小时新鲜期，允许策略读旧数据先显示。增大能延后LRU清理，可能提高回访命中；减小节省存储但更早淘汰。 | 这是容量目标，不是启动时预分配RAM；与系统临时HTTP cache、用户手动离线包分开。空间紧张、索引/文件IO、过期更新仍影响体验。双图共用目录和容量，不是每窗各8 GiB。 | `map/NativePersistentBrowseCache.kt`: `DEFAULT_MAX_BYTES`, `DEFAULT_MIN_FREE_BYTES`, `DEFAULT_TTL_MILLIS`, `CACHE_DIRECTORY`; `BoundedTileNetwork`调用读写。 | 记录缓存前后字节/命中/过期命中、相同区域首次/回访/重启后读取时间、删除回收和剩余空间；确认仅瓦片目录受LRU影响，不触碰离线包、轨迹或照片。不要为了制造冷缓存清除真实用户缓存。 |
| 每个 WorldWindow GPU render cache：`heap/2`，夹在 `8–192 MiB` | `NativeRenderMemoryBudget.textureCapacityBytes()`按运行时最大Java堆估算每个渲染窗口可驻留的WorldWind render资源上限；这是容量上限而非预分配。增大减少可见瓦片被驱逐、重复读盘/解码/上传；减小省资源但可能对斜视高分辨率视口形成反复淘汰。 | 每个主图、双图次图、分享渲染器各自建 `WorldWindow/RenderResourceCache`；当前没有跨窗口统一的应用总GPU预算。因此双图可同时持有两个各自预算，按各窗口实际 `maxHeap` 计算，不能说全应用最多192 MiB。实际还存在Java对象、临时Bitmap、驱动/GPU和Surface开销；192不是设备总内存上限。 | `map/NativeRenderMemoryBudget.kt`: `textureCapacityBytes`, `MIN_TEXTURE_BYTES`, `MAX_TEXTURE_BYTES`; `map/NativeMapController.kt` 构造器将该值交给 `RenderResourceCache`。 | 单图/双图、平视/斜视、主图与次图同时加载时记录每个cache的`usedCapacity/capacity/entryCount`、解码数、PSS、帧耗时和内存压力；观察回访旋转时是否重复解码。只有峰值PSS/掉帧/OOM一起比较，才能评估调高是否划算。 |
| 栅格化矢量瓦片 `vectorTileCount = heap/2MiB`，范围 `32..256` | 道路、地名等MVT层共用按堆算出的驻留瓦片数上限；增大可减少可见几何反复驱逐和重新组装，减小降低瓦片/几何驻留。计算方法是整数折算并夹到最小32、最大256。 | 这是瓦片“个数”近似预算，不等于每块精确占2 MiB；不同道路/标签要素的实际内存可不同。每个地图控制器/图层实例都可有自己的层缓存，不能把256当全应用共享总数。单个MVT输入另有4 MiB读取限制和其它队列/组装并发参数。 | `map/NativeRenderMemoryBudget.kt`: `vectorTileCount`, `BYTES_PER_VECTOR_TILE`, `MIN_VECTOR_TILES`, `MAX_VECTOR_TILES`; `map/NativeCartographyLayers.kt`: `vectorTileBudget`, `NativeRoadVectorLayer`及相邻MVT层。 | 分别记录loaded/pending/assembly、回访时重组数、堆与PSS、道路/标签是否完整；放大预算前先确认持续CPU来自几何重组而非解码、请求或DEM。测试主图与双图并存。 |
| 等高线 `CONTENT_CACHE_BYTES=heap/4，8–128 MiB（512 MiB堆时128 MiB）`、`MAX_PREPARED_TILES=2`、`ADMIT_BYTES_PER_FRAME=2 MiB` | 新预算是WorldWind等高线已加载内容的LRU目标；155实际32 MiB仅能保留6–7块，静止14秒生成序号602→727、9个已见瓦片合计40.52 MiB，已证实循环重建。现按Java最大堆1/4计算，最小8/最大128 MiB；2个槽限制生成完成但尚待渲染线程接收的prepared瓦片数；每帧2 MiB限制正常逐块准入速度，减轻单帧大量建对象/上传。提高前两项可保留/并行更多几何但增加内存/堆峰值；提高每帧准入值可更快补齐视图但可能造成帧尖峰；调低则更平稳但出现内容更慢。 | 该LRU目标 **不是硬上限**：WorldWind的加权LRU按`contentWeight`驱逐，但一个单独超大瓦片/批次仍可能超过目标；每帧准入门槛也允许一个单块自身超过2 MiB后单独准入。prepared槽按瓦片个数限制，不代表字节限制。152的`Path.makeDrawable → NativeContourLayer.renderTileContent`曾在512 MiB Java heap OOM，153未显示；当前即使这些值在源码也不能称问题已解决。 | `map/NativeRenderMemoryBudget.kt`: `contourCapacityBytes`；`map/NativeContourLayer.kt`: `NativeContourVectorGeometry`常量、`maxLoadedTileBytes`、`maxTileAdmitWeightPerFrame`、`NativeContourPriorityQueue`、`contentWeight`; `NativeContourVectorTileBuilder`的`byteWeight`估算。 | 必须用真实 `layer.render → SSE → loadTileContent → 准入 → draw`路径，覆盖中心、四边/角、全球根网格边界、多个等高线间距、倾斜/缩放、静止和拖动。采Java heap峰值/最大单块weight/队列数/标签数/帧长；确认无OOM、瓦片确实出线且覆盖连续后再做源图视觉对照。153的“没有线”或编译/单测不能证明通过。 |
| 等高线源级与UI zoom：源 `SOURCE_MAX_ZOOM=13`；当前显示门槛按间距为30m→UI 11、50m→10、100m→9、200m→8 | UI zoom表达用户看到的地图缩放级别；WorldWind请求的z是瓦片源/金字塔级别。两者不是同一个数值：透视、视口尺寸、瓦片SSE和SDK细分决定一个UI视角下实际请求哪些z。同一真实DEM细节最多到可用源级，继续放大不能创造新等高线细节。UI门槛控制何时显示/生成，源floor控制四叉树最低层/最粗层从何级起；两项需要独立表达。 | 154错误地把UI门槛传入LevelSet，导致理想源z较低的中心区域永远不请求。下一候选源码已将SOURCE_MIN_ZOOM固定7（低于7强制细分），UI门槛通过setViewportStyle整层控制；这套修复尚未实际验收。源最大13也不代表UI最大zoom=13。 | `map/NativeTerrainOverlays.kt`: `contourMinimumZoom`, `renderables`; `map/NativeContourLayer.kt`: `SOURCE_MAX_ZOOM`, `minimumZoom`, `levelSet`, `loadTileContent`; `map/NativeMapController.kt`: 相机/视口到各层的SDK细分。 | 固定同一中心、视口尺寸、俯仰、间距，缓慢连续扫UI zoom门槛上下；记录每帧UI zoom、SSE、z/x/y、请求/缓存复用和可见轮廓。逐项调门槛验证远景密度/细节/CPU，测试z13封顶和越界放大无虚构层级；必须证明最低层网格稳定、中心不空、无整世界/重复瓦片。 |
| DEM采样、解码和纹理上传链 | DEM源按修补/FABDEM/Terrarium优先级取样，PNG经`BitmapFactory`解码，Terrarium像素转高程，再供地形、着色和等高线；等高线几何构建、瓦片cache admission与GL绘制是后续独立阶段。网络命中、DEM数组ready都不等于GPU纹理已上传或真实帧已画完。 | 提高采样范围/密度、降低采样间隔会增加像素解码/插值/几何点数与堆占用；降低采样精度或略过来源可能产生缺失/粗化，涉及数据正确性，不能作为无声提速手段。Bitmap、像素数组、CPU几何和GPU资源可能短时并存。 | `map/NativeTerrariumCoverage.kt`: `readBitmap`, `decodeTerrarium`, `sampleElevation`; `map/NativeTerrainOverlays.kt`; `map/NativeContourLayer.kt`; `hybrid/NativeBridgeDemGrid.kt`及`NativeBridgeDemSamplingGate.kt`; `map/NativeTileStageTelemetry.kt`。 | 同一场景分别采网络到达、解码数量/耗时、DEM revision/采样数、几何构建时间/weight、GPU cache used与实际draw witness；覆盖冷/热缓存、地形开关和倾斜。判断瓶颈前不要把HTTP完成、pending=0或桥接高程ready当成画面完成。 |
| 主图/双图总资源与相机回声 | 主图与次图各自运行WorldWindow、缓存、层与可见需求；共享网络池/磁盘浏览缓存减少重复下载，但不会合并两张图的纹理cache或所有CPU几何。双图同步相机需要区分用户操作与程序回声：hybrid桥为`applyCamera`携带`cameraSyncToken`，快照/同帧metadata附回token，新的用户手势清token，避免把对侧同步回来的帧再当新操作传播。 | 两窗同时加载会叠加GPU/CPU/解码工作；应用当前没有统一总GPU预算。减少双图同时细节/图层需遵守产品功能契约，不能为了省资源默认关层。相机同步逻辑只抑制来源回声，不应冻结用户真实手势或导航跟随。旧的逐字段“相机相等”阈值和简单`syncingCamera`不是全链路性能隔离证据。 | `hybrid/NativeBridgeCameraOrigin.kt`: `command`, `beginUserGesture`, `annotate`; `hybrid/NativeReactMapHost.kt`: camera RPC与同帧metadata; `ui/NativeDualMapPanel.kt`: `onCameraChanged`, `syncingCamera`; `map/NativeMapController.kt`: per-window cache。 | 单图转双图、同步开关、同一与不同图源、拖动一侧/双指/停手、旋转与跟随往返；记录token来源、相机事件数、每窗GPU/CPU/内存和请求。用户输入停下后检查两侧稳定，不能出现程序帧持续互相驱动。 |
| 9174原生预览视频压缩 | 9174把模拟器/设备画面编码后传给浏览器用于观察与触控；压缩率、传输时延、浏览器解码和屏幕刷新会改变预览观感。 | 编码帧数、MP4帧数/时长、浏览器播放流畅度都不是手机端FPS、帧时间或卡顿率。压缩细节也不适合评价细线锐度。视频可用于发现明显黑白闪屏/交互状态，但画质需用设备端原始截图或无损帧。 | `docs/native-android/raster-roads-contours-152-20261031.md`的预览边界；有限运动样本见 `docs/native-android/marker-selection-149-20261031.md`。 | 若要测FPS，应在目标设备本机用同一采样口径记录真实渲染帧时间/慢帧、CPU、PSS，并说明是设备、窗口、视角和操作；另用lossless截图对比细线/标签。视频仅标“视觉观察辅助”。 |

## 后续修改与验证顺序

1. 先确认Contour layer真实`render/SSE/request`调用链和世界边界根网格完整，再分开记录UI zoom与来源z，不以一次出现/缺线推断根因。
2. 在实际代码里把“UI显示门槛”和“source floor”设计为不同参数/判断：候选source floor 7必须通过空白中心、全球边界、缓存身份和z13封顶检查。当前门槛11/10/9/8仅是本次区间拆分基线，后续以最终源码与同机样本更新本文。
3. 之后调批次weight与准入速率；让单瓦片估算覆盖CPU对象与GPU批次资源，记录实际峰值。几何缓存/2 MiB准入目标不能替代堆OOM门禁。
4. 对标9176原WebView确认的细线/柔和颜色/标签避让时，先无损静帧和真机地图语义对比，再谈性能。9174视频只辅助看交互，不作FPS或线宽验收。

每轮调参都应写明：源码值、改前后同条件样本、帧/请求/解码/堆与GPU计数、画面完整性、FAIL/未验证项、设备边界。没有数据就写“未测”，不推测官方账号QPS或性能倍数。

## 155实际缓存循环证据与下一预算

固定相机采样中，等高线单瓦片约3.9–5.4 MiB，旧32 MiB缓存仅留6–7块；同一键反复消失/重现，14秒生成序号602→727，期间底图解码数不变。全部已见9块的权重已达40.52 MiB，仍有16–17项排队。这是小缓存导致重复计算的实际证据，不能归因网络慢。下一候选几何预算改为heap/4、上限128 MiB；最大2份生成结果和每帧2 MiB准入继续保持，GPU render cache192 MiB未改。代价是CPU几何可驻留更多内存；必须检查完整视口收敛、GPU是否被挤掉、主双图峰值和长期无OOM，再判断提速。
