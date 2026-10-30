# 144性能施工与实测记录（未验收）

2026-10-30。用户已确认 Find X8 运行的是143测试包，仍特别卡；143真机流畅度FAIL。本轮沿用原React界面和原生WorldWind地图，保留私人天地图、地形、高清、道路/注记及业务功能入口。**144仍是隔离候选，不替换固定142包，也不宣称手机卡顿或内存退出已修复。** 本文按实验阶段保留数据，v4与optimized的后续进展见末节。用户最后选择先只查源码、模拟器晚点再开；Unreal保持运行，MuMu保持关闭。

## 已施工

- 原生帧回调改为单槽latest-wins，只保留最新真实矩阵，至多一个待发布任务。普通浏览业务快照100ms；双图、绘制、定位动画/导航、拾取、标记/轨迹/剖面编辑保留33ms。该间隔不限制WorldWind原生绘制帧率。
- 普通浏览视角稳定180ms后再做DEM、吸附和地面锚点刷新；补一帧真实重绘，防止按需渲染停止后丢末帧。实际任务仍按实时策略处理，不能用诊断消融开关省掉功能。
- JS相机状态仍实时更新给原有调用方；localStorage和地址栏写入合并为160ms静置/最长1000ms，主图owner释放前flush，比较图不写主图视角。
- DEM/吸附的大JSON事件移到共享单线程后台编码。每地图、每事件类型仅保留最新待编码值；主线程回调再次核对session、entry identity、channel token，旧结果/销毁后结果丢弃。不可变快照按identity去重，避免主线程为去重遍历完整坐标JSON。
- 地图释放和会话重建均取消帧/静置任务、清邮箱并关闭编码器。未改布局、图源内容、缓存上限、画质或用户存储格式。

## 包和检查

后台编码阶段的v3隔离候选为144/code151、`com.guanyun.weather.shantu.preview`：

- 本机 `D:/ShantuNativeTools/perf-native144-v3.apk`，180500736字节。
- SHA256 `d8db7a5c172565212bda7eaffa431615b15c098fb0beedba73d7f4580bf87eca`。
- 186项原生测试，零失败/错误/跳过；27项相机、投影、手势相关Node测试通过；JS改动的TypeScript检查通过。
- 2178项ZIP CRC、1925份fresh React资产、私人配置/Key存在与React一致性、39图源种子一致、4份64位ELF 16KiB、zipalign通过。v2签名验证通过，证书仍为原4a94…6f9f。
- `APK/山兔手机.apk`仍为原142，SHA256仍为7833d6fa…2317c4；原143、141及中间候选保留。144没有作为合格交付包放入固定入口，没有公开上传私人APK。

## 无应用注入的连续拖动

MuMu实例3，4核/4GiB，物理1256×2760/dpi515，WebView391×834，原生地图1256×2679；同一中心102.9/31、zoom12、pitch55、天地图高清、地形/道路/注记开启。保持磁盘缓存，预热后冷启进程；测量前确认宿主进程maps中没有Frida。独立adb-shell Java驱动一次DOWN、约16ms MOVE、20秒后一次UP，走正常Activity触摸通路。CPU是宿主加所属WebView renderer、100%=四核占满；内存为两进程PSS之和。帧数据选SurfaceFlinger实际地图SurfaceView层。

| 版本/轮次 | FPS | P95桶ms | P99桶ms | ≥54ms慢帧 | 拖动CPU均值 | 拖动峰值PSS MiB |
|---|---:|---:|---:|---:|---:|---:|
| 网页141 r1 | 56.49 | 33 | 50 | 0.36% | 44.22% | 299.28 |
| 网页141 r3 | 56.89 | 33 | 33 | 0.27% | 42.88% | 304.21 |
| 原生143 r1 | 15.33 | 200 | 300 | 36.09% | 55.32% | 411.63 |
| 原生143 r2 | 15.95 | 250 | 300 | 26.53% | 51.52% | 440.23 |
| 144中间v1 r1 | 54.26 | 33 | 50 | 0.55% | 26.57% | 406.19 |
| 144中间v1 r2 | 53.70 | 33 | 50 | 0.46% | 27.06% | 393.36 |
| 144中间v2 r1 | 39.61 | 50 | 66 | 1.74% | 27.70% | 409.61 |
| 144中间v2 r2 | 43.70 | 50 | 66 | 1.46% | 28.52% | 409.47 |
| 144中间v3 r1 | 32.17 | 66 | 118 | 5.89% | 32.10% | 392.96 |
| 144中间v3 r2 | 37.52 | 50 | 102 | 3.50% | 28.29% | 363.86 |

所有低分保留，不以v1的54FPS冒充后续候选性能。网页r2与Gradle构建重叠，单独标记排除，未选入正式比较。143→144v1先按A/B/B/A交错完成，后续版本/网页为连续补测，时间、JIT、缓存与主机负载不能视为完全一致。

后续检查发现另一UnrealEditor进程占主机3D引擎约75–81%；其启动时间08:50:56，覆盖v3 r2拖动08:52:40–08:53:02。GPU观测保存到指标目录。不能把共享GPU条件下的波动直接归因于某段源码，也不能由该证据替08:48的v3 r1或更早v2低分找确定原因。用户已选择保留Unreal运行，因此后续只做内部排查，不把共享GPU的FPS当最终验收。最终FPS门禁需要隔离资源竞争后再做交错对照。

v3停手后约30秒静置CPU均值约0.1%，末段PSS约349–361MiB。仅说明这段测试没有持续忙循环，不能据此证明长时间内存稳定或Find X8 OOM已解决。当前原生内存仍高于网页；本轮热缓存拖动也不能证明首次联网影像加载已经变快。帧间隔是SF直方图桶，未测实际触摸到画面的延迟或最差连续1秒，不能冒充完整FrameTimeline验收。

## 分段诊断与功能复验

计时诊断临时注入、测后卸载，仅用于定位，与无注入FPS分开。v2一次`publishSnapGeometry`长达190.1ms，包含四角投地、快照准备、JSON去重/封装和发送；不能将整段耗时全部归给JSON。v3一段8秒拖动诊断中，该方法5次、最长4.1ms，`emitBulkEvent`8次、最长3.9ms；`postEmit`仍出现45.4ms，`publishLatestFrame`最长61.1ms。样本数、视图/缓存和主机负载不同，不计算“提速倍数”，剩余UI桥接长任务仍需处理。

| 项目 | 当前证据/状态 |
|---|---|
| 普通拖动末帧与持久化 | v2、v3实际拖动后JS最终camera和保存视角一致，PASS |
| 双图同步 | v2实际上图拖动后两图center/zoom/pitch一致、双图ready，PASS；联动事件有明显延迟，性能FAIL；v3组合仍待复验 |
| 绘制 | v2实际start/move/end到达、落一草稿点、返回暂停并恢复普通入口；自己的测试落点已撤销；v3组合待复验，不称完整绘制性能通过 |
| 跟随与2D/3D | v3用模拟器现有定位开启跟随，切2D再切3D仍显示跟随中，PASS；不是Find X8 GPS/方向/后台验收 |
| 异步DEM/道路吸附数据 | v3停稳后20网格、DEM revision追平真实帧，中心高程可用、道路ready/25条，PASS |
| JS地形逆投影 | 同一真实缓存点forward project成功，但inverse返回terrain-intersection-unresolved，FAIL；尚未确定是否本轮引入，不能据此宣称完整功能保持 |
| 真机/长时/冷网加载/双图与绘制性能 | 未验收 |

本轮没有达到研究报告建议的稳定55FPS、P95≤33ms和慢帧<1%组合门槛，**不得报告“非常流畅已实现”或替换用户固定包**。继续顺序：隔离主机GPU竞争完成相同条件交错复测；保留功能下处理主线程发送/实时任务链；复现并归因真实地形逆投影FAIL；长时内存与首次加载分开量测；最后才交Find X8实际验收。

指标见 `artifacts/performance/mumu-144-20261030/`，完整本机脚本、图片和诊断日志在 `.openai/smoothness-implementation-20261030/` 与 `.openai/continuous144-20261030/`。这里记录实际未完成项，不以编译和单测代替体验验收。

## 后续：v4、优化构建和用户指定的源码排查阶段

### 已完成的源码修复

真实山地fixture证明：原`unprojectWgs84`的无阻尼Newton在高坡非线性剖面间反复过冲，DEM缓存与帧revision均有效，仍在10轮后返回unresolved。本轮保留快路径，加最多256步、最多24轮二分的夹逼回退；进入有效覆盖后遇no-data仍返回blocked。真实fixture在本机往返误差0.543m；Git只保存合成地形单测，没有提交真实高程网格。超出采样预算仍可能blocked，不能保证所有地形逆投影均成功。

DEM缓存改为replace时按原分辨率优先级排序，采样不再每次filter/sort，双线性插值不用临时四值数组。重叠精度与no-data向粗网格回退有定向断言；50万次采样的Node微基准中位数95.85→55.13ms、checksum一致，仅说明该纯函数热路径开销下降，不当手机FPS。

v4 debug：`D:/ShantuNativeTools/perf-native144-v4.apk`，181492078字节，SHA256 `fbc1013244ef53a9996efc3bb27b09dd88f0748bf4c14bbc658b7b6d223eb483`。TypeScript与42项相关Node检查通过；原生源码沿用已通过的186项结果，fresh React重组、CRC/私人配置/签名/16KiB通过。

### 长拖动后高CPU尚未归因

v4追加10×20秒单指流，94个拖动样本覆盖234.5秒，PSS329.3–394.0MiB，没有单向增长。随后67.9秒静置CPU均值24.65%，其中应用主进程24.28%、WebView renderer0.37%；不能把问题归给React渲染器，也不能说停手CPU已修复。主进程Java Heap约79→81MiB，Native Heap约38.6→23.6MiB，仍不能证明手机不会OOM。该轮附带的SF观测22.75FPS/CPU41.43%/拖动峰值381.75MiB，受主机竞争影响，不作为公平FPS验收，但保留低分。

MuMu随后日志为正常`ExitEmuDirectly`，不是山兔崩溃证据。保留userdata重开实例3，一次补测因ADB读取瞬断中止并单列作废；下一轮完整取得静置线程栈及URL-free诊断计数。复测67.8秒静置CPU0.42%、PSS327.5→304.4MiB；其后4次诊断中原生frames始终7360、位图decode始终630、DEM job inactive、网络active/queued均0，纹理驻留178.4/192MiB。此视图没有持续重绘或反复解码，但第一轮高CPU没有稳定复现，具体线程/根因仍未捕获。不能把低分或高CPU样本删除后宣布修复。

### 发布优化仅为独立候选

143及此前144包均为DEBUGGABLE；hybrid原本只给debug配置个人签名，没有R8优化变体。[Android官方性能环境指南](https://developer.android.com/topic/performance/appstartup/setup-env)明确提醒debug构建不适合性能诊断，建议启用R8且可关闭混淆以保留诊断类名。这里是构建条件差异，不是已经确认“高CPU全部由JIT引起”。

新增独立`optimized` buildType：继承release，debuggable=false、R8=true、不缩资源、`-dontobfuscate`，保留JNI与JavascriptInterface入口，个人构建沿用原签名。原debug不改。CAD JNI预备任务仍复用原debug so，不把Java/Kotlin优化说成C/C++库也已优化。

优化候选：`D:/ShantuNativeTools/perf-native144-opt1.apk`，165099680字节，SHA256 `c6fd28c6b950aa2f1be4ac63c0dda41eb93e68078bbf67944d1fe4ae1d7cd747`。原身份144/code151/原4a94证书，非debuggable；2165项CRC、1925份fresh React、私人Key/39图源、64位16KiB/zipalign均通过。安装包体积降低不代表运行内存同比降低。

保持Unreal运行的一轮内部观测：30.69FPS、P95桶66ms/P99桶102ms、≥54ms慢帧9.42%、拖动CPU30.75%、PSS峰值325.88MiB，静置CPU0.094%、PSS约303.2MiB；另有冷启进程样本峰值493.3MiB，不能只报拖动的低峰值。GPU竞争仍存在，未做公平交错对照，也没有Find X8结果，仍不满足流畅门槛。

优化包实际冒烟：主图天地图/3D ready、当前视图24网格DEM与frame revision一致、投影/逆投影ready、道路44条ready、原Java系统bridge的权限/缓存能力/采样设置/记录状态读取、原生320×320分享JPEG生成与像素检查均通过。第一次手写分享测试用了错误bounds wire格式，改回既有`[southwest,northeast]`后通过，非产品修复。最后双图复验开始前MuMu再次正常关闭，未将失败的环境调用当作功能失败或通过；optimized双图/绘制/JNI完整流程/其它功能仍待验。

### 只读审查发现的下一步（尚未施工）

用户最后选择“先只查源码，模拟器晚点再开”。此后未重启模拟器、未继续构建或编辑产品代码。源码确认两项待处理点：

1. `NativeMapController.endDrawing`捕获实际MVP，Host稍后才读当前`cameraSnapshot`；期间相机若变化，会存在新camera与旧矩阵拼在同一事件的窗口。不是每帧都错，也未证明它造成低FPS。应在主线程帧准备阶段按业务采样节奏捕获同帧不可变camera/viewport/projection，再用类似现有print-frame witness的方式绑定到实际GL绘制；不能在GL调用强制main-thread的`cameraSnapshot`，也不能简单丢所有revision落后帧导致手势中业务饿死。需增加捕获与发布间改相机/改viewport的定向一致性断言。
2. `installTouchBridge`每个MOVE先构造pointers与JSON，之后才检查既有24ms发送间隔。普通浏览中被丢弃的MOVE仍产生分配。可将门限检查前移，绘制所需pointers按需构造，保留原事件类型/频率；收益需实测，不以源码推断帧率。

停手高CPU后续需抓问题发生当时的线程CPU/Java栈，以及DEM gate PLAN、snap observer/worker、后台编码、实际GL frame、bitmap decode、cache/network增量，当前资料不足以选择某条链硬改。只读审查未发现新增的确证R8 keep缺口；WorldWind唯一命中的GeoPackage日期反射不在目前可达引用链，依赖AAR内consumer rules未完整核验，不能写成全路径通过。

用户随后催促尽快打包，已把现有optimized候选拷贝为 `APK/Shantu-0.2.144-test-private.apk`，SHA256重新核对一致，同时提供校验文件和本机测试说明，供用户提前手机验证；未把它标成最终修复或完整验收通过。固定142和原143保留，私人包未公开。见 `docs/release-0.2.144.md`。**性能任务未完成，提前提供测试包不改变上述FAIL/未验证状态。**
