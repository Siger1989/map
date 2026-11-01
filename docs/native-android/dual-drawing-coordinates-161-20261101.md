# 161 私人试修：双图、绘制与坐标
> **当前新候选结果**：`9067da62082202c63855d11a08679e0c2bd88b84759d64cec4a430f196b86da7`已本机保存，固定/版本化/归档一致，旧160保留。MuMu3等高线ON双图179.81秒4轮、OFF双图117.38秒2轮均无OOM/FATAL/mmap失败；ON拦截z7一次并真实细分，maxLevel/deferred均0。最终7姿态130条stroke检查及相机/revision恢复PASS，恢复单图静止5秒frame增量0、尾queue/active0。新guard相关34项PASS，和此前检查去重合计9套80项Kotlin；104Node/TSC/私人构建与包审计PASS。Find X8的161仍未验收，道路曲线原生探针LIMITED，不称全部闪烁/功能/视觉已验收。下方9ba失败记录为旧候选历史。

> **2026-11-01 / 161旧9ba候选持续双图OOM FAIL，禁止交付；固定160未替换**：候选161/code168，165175092字节，SHA256 `9ba4d5a04944976c1d1ba1772b62acbd6c5f1d3681fe129f909cf8622b4d0811`。178秒正常双图操作第4轮捕获目标进程93MiB/140MiB大数组分配失败及OutOfMemoryError/阻塞GC。失败前FloatList容量从24539478增长到36809217个float，分配147236880字节失败；应用恢复不改变该候选的稳定性FAIL。主动栈采样`.openai/native161-before-guard-geometry-stacks.json`记录到`FloatList/IntList → MvtBatchedLineTile → NativeContourLayer`，与这次数组OOM相关；失败瞬时没有栈，采样栈不是唯一手机根因证明。坐标复制与节点拖动/撤销PASS仍有效，道路曲线路径LIMITED，Find X8手机161未验收，均不能覆盖持续双图OOM。新guard未进入旧9ba候选；其后9067候选的指定复测结果见上方，不能把新结果覆盖旧失败。手机160反馈任意两个图源双图都卡仍为P0；不称唯一根因。证据`.openai/native161-dual-normal-final-sustained-*`及上述本机栈采样，旧160/159/158/157、数据和Unreal保持。

## 用户反馈与优先级

用户确认手机正在使用160。多图源双图卡死/闪退是当前P0；“数据量大”是用户推测，未取得手机崩溃栈，不能写成已确诊OOM。画线与节点拖动卡顿、远景路线和普通道路偏粗、地名偏大，以及标记坐标/海拔/复制、Google格式坐标搜索保留在同批范围。浮窗另行讨论。

四张原始Library照片在本执行器不可读取像素；协调端给出的图像观察仅作为线索。root亲自查看了本机实际160双图PNG：下图可控矢量地名明显偏大且有遮挡；这不等同查看过用户原图。

## 原因、方法与边界

### 双图

160每个NativeMapController独立建立RenderResourceCache；它的容量是按需使用上限，不是启动即分配。MuMu早期每窗上限258203648字节，双窗有两份预算。进程共享HTTP/磁盘缓存并不代表共享EGL/渲染资源。161旧9ba候选较早短流程曾完成，但178秒持续双图复验第4轮已明确OOM FAIL；早期样本不能证明持续稳定。

161复用WorldWind现有多WorldWindow共享RenderResourceCache/EGLContextFactory机制，用进程lease池管理并存窗口，预算不随窗口数量翻倍。最后lease释放只丢池引用，旧窗口的最后EGL context销毁由SDK清旧资源；新一代缓存与旧资源清理隔离。没有手动清共享纹理，也没有停用浏览磁盘缓存、降低画质或加大预算。该方案没有避免独立CPU几何数组增长：旧9ba失败前FloatList容量由24539478增至36809217个float，147236880字节分配失败。

OOM前主动栈采样`.openai/native161-before-guard-geometry-stacks.json`实际记录`FloatList/IntList → MvtBatchedLineTile → NativeContourLayer`，与OOM数组增长相关；但OOM瞬时无栈，这条采样不证明唯一根因，也不代表已确认Find X8的崩溃栈。当前新guard方案按每tile最多65536 segments/logical vertices限制几何；每个点展开20 floats，生成前估算与检查，并在生成中检查取消；超预算时用quadtree细分，目标是保留30m等高线与原样式，不通过关闭图层或降低画质回避。guard正在构建和测试，尚无PASS或交付证据。

精确2.1.1 AAR核对：context create/destroy同步，WorldWindow绘制锁同一个cache实例；不能称所有异步缓存路径都完全线程安全。共享后GL绘制会串行，需实测吞吐与持续操作。各窗口CPU地形数组/MVT styled caches仍独立，此修改不能作为手机闪退根因已定位的证据。

### 绘制与拖节点

编辑节点此前每个MOVE都立刻逆投影、查找吸附目标并触发预览；161每动画帧只消费最新MOVE，UP同步消费最终点再提交一次，取消丢弃待处理事件。此处理不改变长按、真实地形拾取或双指取消语义。

吸附此前反复投影整套候选节点/道路端点。161在固定真实投影下建立有界屏幕索引，MOVE只检索邻近候选；道路仍做原18轮非仿射精判、原14/22像素吸附/释放、真实路网路径计算与中间弯点。节点半径14px、点选半径不变。索引有效期取client实际投影帧、MVP、viewport、CSS倍率、DEM revision、地形夸张及controller generation；同一相机revision也允许DEM替换，另加dataVersion使实际高程更新必然失效。相机/高程变化重建，重建地图先清旧路网状态。6000坐标纯逻辑对照验证结果一致及投影调用减少，不冒充手机延迟/FPS。

### 线宽、颜色与文字

路线/轨迹/导航和描边以保存的基准宽度/透明度乘连续zoom系数，避免每帧累乘。zoom6/10/14/16的宽度系数为0.12/0.30/0.70/1，透明度系数0.35/0.55/0.85/1；近景保留原样式比例。原生可控普通道路也单独缩细/淡化，河流与原可见门槛保持。

可控矢量地名、道路编号/名称、水名/山名及halo缩为原0.84倍。栅格CIA/CVA/CTA及其它图片中烙入的文字、道路不能单独调字号/线宽；不自动切图源或注记模式。SDK Android Font会将SP转物理像素，但MVT collider高度使用原pixelSize，存在碰撞框单位不一致；当前没有受支持的应用扩展点单改碰撞器。本批未修改SDK依赖，该遮挡边界仍保留，不能说全地名避让已修完。

### 标记与坐标搜索

选中标记左上卡片增加该点的WGS84经纬度、DEM地面海拔与复制；未取得海拔显示未知，不借用手机位置海拔或0。拖动不逐MOVE发高程请求，释放查询最终点，切标记/换坐标/关闭会取消旧结果。仅读，不写标记或轨迹存档。

复制及搜索遵循用户选定Google Maps十进制度格式`纬度, 经度`，内部仍为`[经度,纬度]`。复制保留完整十进制精度，显示6位；合法输入本地定位、不发地名API；负数/0/范围与错误格式本地校验，普通地名含London/Portland等仍走原搜索。格式选择不表示GCJ02转换授权。合法极区坐标与路线模块Web Mercator纬度域不同，不将路线范围擅自扩至90度。

实际APK首轮复制失败：原共享函数只处理macOS/浏览器，Android WebView拒绝网页剪贴板。已在现有GuanyunNative桥增加可信前台原生写入及1MiB保护，TS按真实boolean决定成功，不伪造回调；不新增权限，macOS/浏览器原分支保留。Android系统剪贴板回读、完整精度Google顺序、复制后搜索回到原点均在同161先前候选实测PASS，新9067沿用同一React/原生剪贴板源码。复制反馈时首轮卡片曾超出8px，减少信息块内部gap/padding后实际约197.86px、scroll/client均196，无裁切。

### 图源偏移审计

已证实一处原生/Web不一致：Web会应用用户保存的内置TDT raster datum覆盖，原生此前只为custom读取该值。161按各图当前`tianditu:<base>`显式选择，将同一datum应用于内置底图及对应栅格注记；默认WGS84走旧直取，显式GCJ02/BD09复用已有NativeRasterProjection重采样与共享网络，不伪装custom source、不改source ID/业务坐标/用户轨迹。

这只修复显式覆盖被忽略，不证明解释了所有偏移。未知图源datum、影像配准与天地图搜索返回基准仍需具体样本；未发现标记/轨迹/GPS/双图业务链路的确定经纬反转或双转。不能把全部国内源统一平移。

## 本轮检查与原生证据

- TypeScript PASS；相关Node104/104、混合版Kotlin共9套80项去重PASS（含原生剪贴板3项；原49项加新34项，3项pool测试重叠）。
- 原`:app:testDebugUnitTest`入口编译被既存NativeCollectionTransformTest语法/重复声明阻断，未修改无关测试；实际交付`:hybrid`的选定测试入口通过。
- 新鲜私人React/optimized、原签名/39源/1925份fresh资产/CRC/16KiB核验PASS；旧OOM失败候选165175092字节，SHA256 `9ba4d5a04944976c1d1ba1772b62acbd6c5f1d3681fe129f909cf8622b4d0811`。本机初版60970…及二版a558…的失败/中间证据保留，不能混成最终包。
- 旧9ba候选实际Android MotionEvent：小幅20MOVE、快速6MOVE、节点吸附到既有端点均有预览/抬手提交；仅目标节点变化，两外端点保持，真实节点吸附精确重合并按原业务合并重复点。撤销、保存退出再进入已操作，QA路线已删且基线恢复。坐标复制与节点拖动/撤销这些定向操作PASS；注入耗时包含传输、同步注入和显式停顿，不是触控延迟/FPS结论，也不覆盖后来持续双图OOM FAIL。
- 原生可用内容区391×834和360×779（约360×780）下选中卡片/复制/起终点/完成入口完整，宽276、高197.86，scroll=client196；窄屏实际PNG经root查看，设备wm尺寸已还原。照片、坐标、用户ID及完整原生证据仅本机保留。
- 真实道路探针最初只有离屏包络内道路而无安全触控目标，后续瓦片补齐可选到2827顶点道路；整段接续样本触发原计算上限，未取得该样本成功曲线证明，故道路曲线路径为LIMITED。没有提高CPU预算或用直线顶替。节点真实吸附与道路索引纯逻辑一致性另行PASS。
- 早期160/161双图短流程可完成，不能代表旧9ba候选持续稳定；最新178秒、第4轮持续操作已OOM FAIL。此前退出回单图/请求队列清空的样本不能覆盖本次失败。完整本机原始证据`.openai/native161-*`仅本机；图形内存统计MuMu为0，不能把PSS写成GPU显存。
- 手机160反馈FAIL保留；Find X8手机161尚未验收。新9067候选本机指定双图与原生线宽复验通过并保存，固定入口已更新161，旧160/159/158/157保留，无新外网地址、无公开私人Release，不动Unreal及真实数据。

## 调整入口

`NativeRenderMemoryBudget.kt`：共享渲染容量；`NativeRenderResourceCachePool.kt`：窗口lease；`projectedRoadIndex.ts`：64px网格、每段最多64格的overflow回退；`projectedPointIndex.ts`：32px网格；`interaction.ts/latestFrameValue.ts`：最新MOVE与抬手flush；`geometry.ts`：DEM实际数据版本；`zoomLineWidth.ts`、`NativeOverlayStyle.kt`及`NativeRoadStyle.kt`：缩放线宽/透明度；`NativeCartographyLayers.kt`：矢量文字0.84比例。8GiB持久浏览缓存与20槽网络没有在本批改动；20是本机并发槽，不是天地图账号官方配额。

官方依据：[Google坐标输入顺序](https://support.google.com/maps/answer/18539?hl=en)、[WorldWind精确2.1.1源码](https://repo.maven.apache.org/maven2/earth/worldwind/worldwind-android/2.1.1/worldwind-android-2.1.1-sources.jar)、[Android内存管理](https://developer.android.com/topic/performance/memory)。外部资料说明机制，不证明当前手机退出原因。
