# 帧配对、触摸分配修复与手机加载慢排查

2026-10-30。用户授权修复两处源码问题，要求模拟器保持关闭、Unreal保持运行。手机反馈为首次打开和拖到新区域均加载慢，随后要求超过图源最高级继续显示最高分辨率影像，并要求优先查官方/同类方案、用简单语言解释原因和方法。源码与73项定向检查完成后，用户明确要求立即打包自行手机试用，故新增145/code152私人测试包；既有144包不自动包含本批改动，手机当前安装版本本轮未重新核验。保留私人天地图、原React业务、主双图、图源配置、真实存档和既有安装包。

## 修复范围

- `NativeReactMapHost.installTouchBridge`：先判断原24ms MOVE发送门限，再构造touch JSON；pointers按touch或绘制需要惰性创建并在同次事件复用。被节流的普通浏览MOVE不再构造上述JSON。绘制MOVE仍逐次处理，down/up/pointer-down/cancel、点击/长按、WorldWind导航和手势取消路径保留。
- `NativeMapController`、`NativeReactMapHost`、新增frame witness/capture gate：按100ms普通浏览、33ms实时任务节奏安排一次性元数据工厂，在主线程`endRendering`的当前RenderContext准备点实际捕获不可变相机、CSS位置/尺寸/比例、原生视口、地形及DEM/snap版本；将witness放入该帧draw queue，GL从该帧DrawContext读取MVP和viewport。发布不再拼接稍后读取的当前相机/视口。
- 捕获排队后相机/视口改变时，工厂在真正准备帧时读取最新值；已绑定帧之后的新捕获不能替换其元数据。保留有界尾采样；CSS与原生视口尺寸尚未收敛时不确认捕获，等待实际布局/帧进展，避免持续重绘。地面工作仅在其原有采样条件允许且当前状态仍匹配时执行；地面锚点调整相机后等新真实帧。
- WorldWind Android 2.1.1本机依赖确认：`WorldWindow.doFrame`由主线程Choreographer调用`engine.renderFrame`；GL `onDrawFrame`调用`engine.drawFrame`。`endRendering`允许主线程相机读取；`endDrawing`不得调用强制主线程的cameraSnapshot。
- 当前状态与捕获帧的相机一致性使用不可变真实eye姿态（位置、高度模式、朝向、俯仰、滚转、FOV）精确比较，避免再次地形拾取及按经纬度绝对值放大的相对容差。正常GL帧不构造尺寸签名；只有尺寸过渡待检查时才排主线程处理。

## 追加：最高级继续放大

根因之一是原生内置天地图底图和固定细节provider统一填了最高19级，与既有React图源表不一致。新增`NativeTiandituZoomPolicy`按图层限制源请求上限：vec/img18、ter14、cva19、cia/cta/ibo18；固定级别也钳制到对应上限。共享builder显式开启`useAncestorTileTexture`，超过源最高级继续显示/放大最后级或已加载的祖先纹理，不请求虚构高层级。该策略不创造新细节，也不保证服务本身在每个地区最高级都有数据。

已查[WorldWindKotlin官方源码入口](https://github.com/WorldWindEarth/WorldWindKotlin)及本机精确2.1.1 SDK源码/字节码：Mercator builder的maxZoom为包含上限（numLevels=maxZoom+1），最后级与缺图后代可复用祖先纹理。新增测试直接构造真实SDK LevelSet，检查最高级、级数及上方不存在额外level。React/MapLibre本来按source.maxzoom做overzoom；没有证据证明`ovmapTiles.ts`保护性错误本身有问题，因此没有删除错误保护或伪造成功。实际手机最大放大画面尚未验证。

本轮另以本机已有Key读取天地图官方WMTS GetCapabilities，仅输出脱敏层级范围，未打印请求URL/Key：img=1..18、vec=1..18、ter=1..14、cva=1..19、cia/cta/ibo=1..18。与源策略一致，注记/境界的minZoom也改为1，避免无效z0请求。此元数据核验不证明每个地区每张瓦片都有内容，也不提供QPS额度信息。

## 加载慢：开工时确认的代码行为与推断边界

1. **底图请求启动节奏受限。** `BoundedTileNetwork`天地图最多4个活动请求，但新请求至少相隔250ms，约每秒启动4个；缓存命中不受此联网节奏限制。若有20张未缓存天地图瓦片，在无其它争用的理想条件下，第20张最早也要在首张开始约4.75秒后才能启动，网络返回和解码尚需额外时间。这沿用已有web loader的限流契约，不能单独解释原生相对网页的差异；多余请求会放大等待。实际瓦片数量和手机网络耗时未测，不能把这个例子当手机实测。
2. **存在透明但仍加载的旧注记层。** Host对内置天地图把controller旧labelLayer的opacity设0，实际可见注记交给`NativeCartographyLayers`。但`setLegacyRasterLayersVisible`仍启用旧labelLayer，`applySelectedSource`仍加入旧注记surface，`setRasterLabelOpacity`仅改alpha。本机实际SDK的`AbstractLayer.render`、`AbstractRenderable.render`及`TiledSurfaceImage`纹理获取路径不因opacity=0停止请求。因此旧注记在适用视图中仍可请求/解码不可见瓦片，争用共享底图网络池、缓存和纹理预算。代码路径已确认，手机本轮具体额外请求量和占时未测。
3. **可见注记有独立下载链。** `NativeCartographyLayers.TiandituRasterSource`有自己的4线程/4许可，`createCachedBitmap`返回null，没有复用BoundedTileNetwork的应用层缓存、inFlight合并和共享天地图启动节奏。WorldWind自身仍有纹理缓存，不能说所有缓存都没有；冷启或纹理淘汰后的额外网络工作是待测影响。
4. **高清和地形增加条件性工作量。** 高清使用detailControl=0.5，倾斜视图会需要细化瓦片；固定栅格级别另有细节拼图。地形底色需要DEM采样和bitmap生成，本地DEM有孔洞时可补取公开Terrarium。用户手机当前各项设置和耗时分解尚未取得，不将这些条件性工作直接定为根因。
5. **现有计数有边界。** `firstFrameRendered`不代表可见底图已完整覆盖；`queueWaitMs`从取得天地图host许可之后才开始计时，且不包含天地图启动间隔等待，不能用该单项排除排队瓶颈。此前144拖动/静置观测没有覆盖手机首次联网加载。

用户追加大容量缓存要求后，已在源码实施下节的持久缓存、共享可见注记调度和停用不可见旧注记。画质/地形功能保留；未凭猜测加大请求频率。冷启、暖启和新区域的真实手机耗时仍需按无URL计数拆分等待、网络、解码和可见覆盖时间；**源码修复不等于手机加载速度或内存退出已验收。**

## 追加：APP自建大容量持久浏览缓存

- 使用APP自己的`filesDir/shantu-map-browse-cache/`，默认瓦片数据预算8GiB，按实际浏览逐步增长，不预分配8GiB、不整包读入RAM。与原`cacheDir/shantu-native-map-tiles`及用户`native-offline-tiles`离线包分开，旧缓存保留只读回退，轨迹/照片/离线包不删除。普通RAM字节缓存预算仍12MiB。
- `NativePersistentBrowseCache`采用散列文件名/分片目录、SQLite索引与累计容量、LRU、原子写和待删除日志；URL/Key不以明文写入索引或文件名。大目录读写不逐瓦片扫描全目录；磁盘读写在IO dispatcher进行；保留256MiB可用存储余量，写入失败只跳过缓存，不把有效下载变成失败。用generation拒绝清理前已开始的旧请求回填。
- 保留24小时freshness，读取不延长存储时间。过期瓦片保留、普通浏览可先显示并后台刷新；刷新是单worker、有界队列、按URL去重/失败冷却，先让出前台请求。cache-only或选定离线包模式不联网刷新；主动离线下载不把stale条目当新鲜下载。选定离线包优先且不泄漏其它浏览缓存内容。
- 原生天地图底图/自定义栅格与可见天地图注记/境界共用`BoundedTileNetwork`持久缓存及调度；`createCachedBitmap`走直接缓存读取。旧透明注记层只有legacy图层可见且alpha>0时启用，杜绝不可见瓦片继续竞争请求。未将独立Sentinel/GIBS影像等所有其它HTTP链笼统声称已经接入。
- 普通原生图像工厂以弱引用参与有界刷新通知；成功后用原工厂对应的ImageSource精准失效WorldWind纹理并请求重绘，不清空整个GPU缓存；地图销毁注销监听。固定细节拼图有独立Bitmap patch缓存，其后台更新当前已显示patch的及时性仍需下一轮定向验证，不能把常规图层接线证明扩大到所有导出/拼图路径。
- 本轮仅后端/接入变化，未新增容量选择或专用持久缓存管理UI。现有React“路线附近自动缓存”设置是另一实现，没有冒充本次原生8GiB全局浏览缓存。默认容量及低空间保护可由构造配置调整，用户控制入口后续单独适配与验收。

先核对[Android持久文件与临时缓存的官方区分](https://developer.android.com/training/data-storage/app-specific)，再选择filesDir；SQLite采用[Android官方性能建议](https://developer.android.com/topic/performance/sqlite-performance-best-practices)的WAL/NORMAL和索引。亦检查本机精确WorldWind 2.1.1的`CachedTileSource`、`TileStore`、`AttachCache`和`GpkgTileStore`：它们按SDK TileSource/特定TiledImageLayer接入，而本项目用自定义NetworkBoundImageFactory和共享网络调度。直接套整层attachCache会替换现有工厂入口，因此保留上游同类持久索引/SWR方案，用独立字节缓存适配现有调度与取消契约，未另造地图渲染引擎。

## 官方查询与现有缓存边界

以下64MiB是本轮开工时的实现；用户随后明确要求APP自建大容量持久缓存，现已接入默认8GiB的独立自动浏览目录并通过本节末的定向源码检查。不开模拟器，实际手机效果仍待验。

- 已先查公开网页和同类SDK方案。网页搜索工具访问天地图主站超时后，用本机正常HTTP读取成功核对[官方地图服务文档](https://lbs.tianditu.gov.cn/server/MapService.html)、[官方开发许可/配额说明](https://lbs.tianditu.gov.cn/authorization/authorization.html)。官方说明存在服务配额和个人/企业开发者认证；此公开页面没有列出用户Key的准确QPS/同时请求数/单批下载上限。控制台未取得可用登录态，本轮未读取账号配额。每日调用量、并发、每秒启动量和离线批次上限分开，不拿第三方转述或应用自身数字当官方上限。HTTP公开页面核对材料仅保存在`.openai/tianditu-official-review-20261030/`，不发布凭据。
- 开工时原生自动浏览缓存：`cacheDir/shantu-native-map-tiles`，RAM12MiB、磁盘64MiB、24小时有效期、URL散列文件；系统可清理cacheDir。现已新增前节8GiB持久目录并接入可见天地图地名，旧目录只读回退。独立用户离线包为`filesDir/native-offline-tiles`，总上限8GiB且有管理UI；React自动浏览缓存及其设置是另一条实现，不能代表原生已接好相同配置。
- 请求提速尚未修改：当前4个活动请求/250ms启动节奏是项目保守策略，非已查明官方上限；此前历史曾实测429。下一轮在统一缓存/停止无用请求后，结合账号额度与无凭据计数做受控提速，保留Retry-After和退避；不能拿日配额推算允许每秒速率。

## 验证

- 新增定向测试覆盖捕获工厂执行时机、延迟绘制与后续捕获隔离、一次性消费、100/33ms门限和尾样本。复核原触摸/多指路由，执行原生定向编译与单元测试；结果见本节后续记录。
- 未启动模拟器、未接入或操作手机，未变更Unreal。真机加载耗时、实际触控、双图/绘制组合、性能和完整视觉均未验证；不得据此称144手机已修复或功能已完整验收。

最终定向编译与73项受影响单元测试全部PASS，0失败/错误/跳过，包括帧工厂执行时机/延迟绘制隔离、有界尾帧、多指触摸规则、真实SDK最高级、持久重开不重下、过期先显/刷新通知、有效HTTP响应不受缓存写失败影响、离线选包隔离、LRU/存储空间/损坏条目/清理generation与URL-Key散列索引。`git diff --check`通过。未改TS/CSS，因此未重复无关web全套检查。

其中7项存储测试和1项网络重开/过期先显/刷新通知重点复验先以8/8通过。初次失败定位为Windows测试长名称形成的临时数据库路径无法打开；仅缩短测试标识，保留全部断言、正式8GiB/256MiB策略，使用Robolectric native SQLite执行。未关闭手机端WAL或预留保护来迁就测试。日志：`.openai/persistent-cache-short-path-r2-20261030.log`、`.openai/frame-touch-persistent-cache-20261030-final.log`。

用户随后授权的145私人测试包已本机交付：版本/原签名、私人Key一致/39源、fresh1925资源、2165项CRC、4份64位ELF16KiB/zipalign与旧包保护检查通过；未启动模拟器或应用。具体文件、哈希和手机试用边界见[145发行说明](../release-0.2.145.md)。此交付不替代真实设备加载速度/完整功能与视觉验收。
