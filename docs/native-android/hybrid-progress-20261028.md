# React UI + 原生地图施工进度

用户已批准保留原React界面和全部业务功能，只替换地图系统。最新交付改为本地APK、用户自行拷贝；不操作企业微信，不公开私人包。

## 当前边界

- 已备份 `D:\山兔-本地归档\20261028-hybrid-before-180707`，248份源码逐项哈希核验。
- 原React业务、CSS与WebTerrainMap保留；真实Android ShantuNativeMap环境选择WorldWind适配器，没有隐藏WebGL地图回退。导航小地图也已接独立原生mapId。
- 原Java定位、记录、权限、文件、返回、分享、缓存服务复用；包名/4a94签名/存储schema目标保持兼容。未清真实用户数据。
- 当前仅内部probe施工。原固定141私人APK SHA仍为ca3d673a58846d70fe98ff89165d5c9e0eabbe7d9f78d36b89cedda19b5660ad；旧原生0.1.1与141历史交付保留。
- 最终私人混合候选为0.2.142-test/code149；尚未生成合格最终交付包，不能将内部probe当正式替换包。

## 源码已接通的范围

|范围|实现与已发现修复|当前证据|
|---|---|---|
|协议/生命周期|受信origin/session/mapId/revision、取消/超时、独立地图及资源释放|Node与Android定向通过|
|React UI与触摸|透明WebView覆盖真实地图、DOM UI区域、完整指针流、绘制/拖动/长按、双指handoff|实际原UI、无地图canvas；新增手势修复待最新包复验|
|相机/3D|固定45度FOV，尺寸变更保留逻辑缩放，真实地形拾取；2D/3D保留视角修复|probe5已见真实3D天地图；本轮后续相机切换待复验|
|坐标/绘制|生产geometry为map-local CSS，移除重复origin偏移；同点绘制优先真实native地面坐标|真实矩阵非零origin/DPR2往返11/11；此前实际保存约1.4km路线|
|路线/轨迹|原routeFeatures/trackFeatures、样式、access、导航进度、起终途经点、草稿及提示复用|路线17项与native定向通过；最新原生画面待复验|
|对象点选|一次UP真实pick IDs按原Web优先级分流；只读/绘制/测量/剖面模式、照片组、节点/线点|TS定向通过；真实点击待复验|
|标记/模型|原缩放dot/icon/label阈值与选中名称、模型DEM到达刷新、真实裁切体与渲染体一致、状态回传|原生模型/地形测试通过；快速导航DOM入口已补，实际点选/遮挡待验|
|剖面/测点|当前与已保存平面、选择/游标、原测点存档与临时预览、真实DEM/模型采样，防重复采样|新增集合4项与测点定向通过；实际面板/图表/选择待验|
|照片/CAD/分享|照片128px预览与原分组/标记信息；原CAD投影几何；独立print surface+真实帧PixelCopy|源码/定向通过；GPU显示、系统选择/分享待验|
|图源/离线|39私人图源一致、主双图内置天地图、原Blob只读镜像、精确manifest、旧CacheStorage只读回访与禁止网络回退|probe5包CRC/39源/Key存在性/496地形/16KiB通过；最终包须重核|
|性能/内存|按堆预算限制每地图纹理/MVT缓存、largeHeap、默认图层先禁用；道路快照后台单worker/latest-only、有界解码与通知合并|probe5双图已显示且未再出现此前OOM；旧probe主线程快照卡顿有trace，新修复待实际复验|

## 最新验证

- 最近React私人混合构建7 PASS；之后路线/点选/测点/导航小地图/快速导航新增源码的全量TypeScript已由子任务分别PASS，统一fresh构建待跑。
- 最近Native相关Node全组81/81 PASS（含新路线/点选/测点）；之后投影实际函数11/11、快速导航/真实绘制hit5/5通过。最终统一组需再记录数量。
- compile26原生定向118项，失败0。之后增加剖面幂等/自动视角与2D/3D相机保持，需下一次统一构建复验。
- compile24中断是PowerShell5把javac过时API提示当终止错误；本机wrapper已改为按实际exitCode判断。compile25新增模型测试暴露一个旧fixture缺引号与真实裁切体错误，修复后compile26全通过。
- probe5完整性：180997832字节，SHA 7a0130515e24b83f3e65102e76596d07f5ae8cf3205eda0e75383615a6a2880c；这是内部probe，不是最终包。
- 自建API35隔离模拟器emulator-5574，物理390×1017实际WebView CSS390×857；系统insets只处理一次。用户电脑Androws、原应用数据未替换。360×780、390×480及最新组合交互矩阵待验。
- 手机上的GPS、厂商后台/锁屏、相机/系统分享、触控手感和性能未验；原生HarmonyOS仍未交付。

## 下一步

1. 冻结本轮补齐源码，fresh私人React构建与原生定向回归、生成隔离组合probe。
2. 实测首帧、主/双图、2D/3D、拖动/双指、绘制保存/撤销/暂停、点选/快速导航、锁定/解锁、剖面/照片/CAD/分享与适用三尺寸。
3. 任何必需项FAIL不报告完整通过；修复后再复测。
4. 门禁完成后生成原包名/签名的私人APK，重新检查资源/签名/CRC/16KiB/配置，保留历史包，给用户本地拷贝路径。不发送企业微信、不公开私人APK。

## probe30 最新接续

- 最新统一构建：React9 PASS、TypeScript PASS、Native相关Node90/90 PASS、Android119项PASS。
- probe30内部APK完整性全通过，1925份React资源逐项与fresh9相同；181003465字节，SHA497b9b7f7d78f8cc5ad2580adbc2003e433c886314c4c5285a05f2666c8c27c3。最终原身份私人包尚未构建。
- 真正GPU操作新增PASS：主图双指放大，实际pin拾取一次选中、原快速导航起终点菜单、2.5km步行路线规划、第一人称预览、导航等待/系统定位权限、内部滚动到结束导航。模拟器默认位置触发跨洲接入的测试状态已结束；没有伪造GPS，也不记作手机GPS通过。
- Native ground anchor在DEM到达/夸张改变时按同一目标、range与角度更新眼位，真实触摸取消该锚点；新增真实WorldWind变化高程/2倍夸张/手动取消回归测试通过。实测修复前定位漂移约6km，修复后同目标稳定在约一像素网格误差内。
- Android依赖携带同名hdpi默认机器人icon覆盖了旧ic_launcher；hybrid改唯一资源名，所有density指向原shantu_logo，源PNG与用户brand哈希一致，保留原主题并配置同品牌系统启动屏。
- UI region publisher增加native resume/focus/visible重发及纯文本变更监听。probe专用只读ShantuNativeMap.inspectUiRegions可查看真实送达区域；交付身份返回空JSON。
- 测试helper已修正：DOM按钮必须elementFromPoint命中自身才可点击，内部滚动裁剪外的按钮不算可见。此前个别“导航按钮落图”来自测试点到尚未滚入视口的按钮，不作为应用失败；权限恢复后的送达区域仍需probe30复核。
- API35隔离模拟器system_server在14:49UTC重启，com.android.phone记录DeadSystemException。保留userdata，关闭并以host GPU重启同一AVD/5574；当前等待启动完成。没有新app OOM证据，不把系统故障判成app已通过。
- 剩余：probe30安装并核验真实区域、双图2D/3D/双指、绘制暂停/续画/保存/锁定、360×780与390×480、照片/CAD/剖面/分享的实际运行门禁；完成后再构建原身份149私人APK与最终检查、本地交付及源码同步。

## probe33 实测与 probe34 修复

- fresh React11、全量tsc13 PASS；Android131/131、Native相关Node100/100通过。probe33完整性：181004678字节，SHA256 `0e22ba545a92c8388b034c93667e71f5d30e254b327a4bb782aeb51f66d684e2`；2178项CRC/1925成品资产/39私人源/Key一致性/473+23地形/64位16KiB通过。不是最终交付身份。
- probe32 SIGQUIT明确主线程在地形射线 `publishDemCache→pickTerrainPosition→triStripIntersection`，证据 `.openai/hybrid-probe32-thread-dump.txt`；现已在射线前按相机/viewport/terrain/夸张/DEM revision去重，保留重试窗口与250ms节流。
- probe32双图实测有回声漂移；probe33真实双图读数已稳定到main/aux同中心[102.9,31]和zoom12（仅约1e-12浮点差），真实双指后两张均zoom12.56885687961。原生实际帧45度FOV、各自非零y视口和主图零DOM canvas有证据，未用网页地图替代。
- probe33两图进入俯视后pitch残留约1e-14，原React按钮严格pitch>0因此仍显示3D，已在原生快照把小于1e-8度的数值噪声归零，并在真实WorldWind相机测试补0→50度回归；等待probe34实测往返。
- probe33绘制真实触摸已形成三节点草稿，第二指到达发cancel且未把控图当新增节点；但此轮双指过程中出现本应用Input dispatching timed out，无完整UP，不能记通过。`.openai/hybrid-probe33-pinch-anr.txt`保存ANR，捕获时main在WebView/native等待，不能凭此把原因断言为某个函数；软件GPU与高系统负载下需复测。草稿及旧保存fixture未清理。
- 冷启动恢复新增owner token/generation幂等、共享session不重置、初始ACK与真实帧均到才onReady。client后续审查修了新owner遗留revision/frame/DEM、旧dispose/renderState ACK污染新owner缓存；fake host行为回归通过。删除新增源码正则自证测试，只保留行为测试。
- probe34采用fresh React12、统一Native相关Node101/101、最新TSC通过；原生测试/assemble正在进行。为验证软件GPU/系统负载边界，保留同一个AVD userdata切换host GPU并关闭Vulkan，待boot完成；用户Androws/141/真存档不变。
- 剩余门禁：probe34实际双图切换/稳定/手势、绘制暂停/续画/保存/锁定、360×780与390×480、照片/CAD/剖面/分享；这些完成前不交付为功能完整替换包。最终149原身份私人APK未生成，不发送企业微信、不公开私人包。

## 2026-10-29 / probe37-current：最新构建与分段实测

本节更新当前接续状态；前面的probe33/34施工记录及ANR失败证据保留。用户最终交付要求为本地私人APK自行拷贝，不发送企业微信、不公开含私人图源凭据的APK。内部probe37不能冒充原身份最终149包。

### 最新源码、构建与包完整性

- 私人React15 fresh构建PASS，日志 `.openai/hybrid-react-build15-20261029.log`；最新完整TypeScript由对应施工任务核验PASS。
- 统一Node107/107 PASS，0失败/取消/跳过，日志 `.openai/hybrid-final-node-tests16-20261029.log`；原生135/135及compile36/37通过，compile37 assemble PASS，日志 `.openai/hybrid-compile-tests36-20261028.log`、`.openai/hybrid-compile-tests37-20261028.log`。这些属于源码/构建检查，不能替代下面的运行门禁。
- 精确probe37：181309210字节，SHA256 `15c078dafbf32e9e67eeed77c4797b294d53bfa756bc16208d6e9ec8e04aa493`。核验JSON为 `.openai/hybrid-probe37-integrity-20261029.json`；2178项CRC、1925份fresh React资产、39图源逐项一致与私人Key存在性/一致性、473 FABDEM+23修补、四份64位ELF16KiB均PASS。文档不记录Key值。
- 当前probe37安装中，尚无本包运行验收；最终原包名/4a94签名code149私人APK仍未构建，固定141及用户存档保留。

### 已实际完成的probe34限定验收

| 项目 | 结果与实际范围 | 证据与边界 |
|---|---|---|
| 2D→3D切换 | PASS：实际pitch从0切到62度 | `probe34-2d.png`；覆盖该状态切换，不扩大为全部相机模式通过 |
| 绘制双指与保存 | PASS：host GPU/禁Vulkan下取得完整第二指/结束流，绘制cancel与navigation交接正常；此有限会话无本应用ANR，实际保存584m路线 | `probe34-drawing-current.png`、`probe34-drawing-finish-360.png`；此前probe33 Input dispatching timed out仍是历史FAIL，不能被本段抹除或据此声称手机性能通过 |
| 360×780完成/详情/返回/锁定 | PASS：完成绘制、查看详情、返回、锁定与解锁；测试临时10秒设置已恢复原值 | `probe34-main-360.png`、`probe34-drawing-finish-360.png`、`probe34-locked-360.png`；仅覆盖指定状态 |
| 390×480剖面建立与持久化 | PASS：两次真实原生拾取建立1699m勘探线、2点保存，收藏仍存在 | `probe34-section-points.png`、`probe34-section-completed.png`、`probe34-section-390x480.png`；详情图表窗口已打开，但截图偏早，稳定后的曲线/文字/选点视觉未验 |
| GPX真实系统选档/合并 | PASS：经实际SAF选择并合并191m合成轨迹 | `probe34-picker.png`、`probe34-gpx-imported.png`；位置/时间为隔离fixture，不代表实际GPS或运动记录 |
| 照片读取/匹配/保存 | 分段PASS：两张EXIF JPEG经原React流程读取、时间匹配并保存 | `probe34-photos-import.png`、`probe34-photos-added.png`、`probe34-photos-state.png`；地图渲染随后因detail Blob进入wire而失败，不能记完整照片PASS |
| CAD原UI导入与保存 | 分段PASS：真实SAF读取3图元，确认WGS84、转换坐标并保存参考图层 | `probe34-import-cad-before.png`、`probe34-cad-summary-click.png`；原生叠加画面仍待37实测，不能由保存成功推定显示通过 |

截图目录均为 `artifacts/screenshots/hybrid-map-20261028/`。隔离素材及真实元数据核验在 `.openai/hybrid-fixtures/fixture-manifest.json`，不向真实用户存档注入fixture；合成坐标和海拔不得作为系统GPS或DEM实测。

### probe37已修源码、必须继续复验的边界

- 照片wire序列化helper只移除地图传输不需要的detail Blob；照片持久存档与原清晰副本保留。必须在37上重新验证缩略图、分组、地图点选和照片详情，不能把读取/保存的分段PASS代替地图渲染。
- 原照片label/透明file input的命中区域已修；survey-hit-line复用真实stroke分段区域，避免水平/竖直零高/零宽bbox被剔除，同时保留bbox空角和祖先裁剪范围内的地图操作。源码/定向测试PASS，37实际触摸待验。
- 新DEM前置门禁、精确瞄准及触摸锚点修复已进入37；运行时的实际矩阵/DEM不能伪造。需继续复查主/双图静止、定位/瞄准、2D/3D和完整绘制手势，未把源码接线当实际通过。
- 分享已限制为请求的轨迹/标记，避免把当前规划线夹入另一条轨迹的输出；请求回归通过，独立原生print帧、最终图片及系统保存/分享仍需37实际验证。
- 继续验收CAD原生叠加、剖面稳定图表/交线选点、390×857/360×780/390×480适用状态与实际返回。任何必需项未验或失败，不宣称全功能/视觉通过，不据此生成最终替换包。
- 真机GPS、后台/锁屏、相机与跨应用分享、手机触控手感和性能、HarmonyOS均未验收；保留用户Androws、原141及历史包，不清真实用户数据。

## 2026-10-29 / probe37与38实际复验、probe39分享FAIL、最终40待验

本节为当前接续，更新前节“37尚无运行证据”的时间点；历史记录与probe33 ANR不删除。只交付用户本地自行拷贝的私人APK，不发送企业微信、不公开含私人配置的包。

### 源码与精确候选边界

- 最新私人React16构建PASS，日志 `.openai/hybrid-react-build16-20261029.log`；调度修复完整TSC PASS，`.openai/hybrid-projection-scheduler-tsc-20261029.log`。
- 最新统一Native相关Node110/110 PASS，0失败/取消/跳过，日志 `.openai/hybrid-final-node-tests17-20261029.log`。其中生产调度helper的3项行为回归覆盖80ms持续frame仍在180ms发布最新状态、DEM到达后无新frame也更新、初始ACK/cleanup保护。
- compile38原生139/139与assemble PASS，用时2m30s，日志 `.openai/hybrid-compile-tests38-20261028.log`；probe38精确包核验见 `.openai/hybrid-probe38-integrity-20261029.json`。
- compile39为诊断包assemble PASS，用时1m05s，日志 `.openai/hybrid-compile-tests39-20261028.log`；精确核验见 `.openai/hybrid-probe39-integrity-20261029.json`。39构建时包含React15，React16在之后生成，不能将新的调度修复当作39已有运行证据。
- 最终40须在原生/分享修复完成后重新组合React16并验证；当前未生成原身份code149最终私人APK。固定141哈希仍保留。源码尚未commit/push；接续时的382份暂存工作不是已提交或远端同步的证据。

### 新增实际运行结果

| 项目 | 结果 | 证据与实际范围 |
|---|---|---|
| 原照片label→系统选档 | PASS（probe37入口） | 不依赖DOM诊断触发，原React照片label直接打开真实SAF；不把选档入口成功外推成照片地图拾取通过 |
| 照片wire与原清晰副本 | PASS（probe37序列化/持久数据）；GPU点选未验证 | 2张持久照片仍在，检查到detail为821B且保留；wire为1组2照片，无detail Blob序列化错误。中心点选命中重叠PIN，不能据此认定照片GPU对象不存在或照片丢失 |
| CAD原生叠加 | PASS（probe37指定内容） | 4个native features，`HYBRID QA WGS84`文字实际可见，截图 `probe37-main-settled.png`；不是完整CAD格式/批处理验收 |
| 3D精确瞄准/编辑/绘制完成 | PASS（probe37有限会话） | 手指Y−44的实际瞄准坐标提交2节点，撤销及替换有效；双指完整流cancel一次后UP，无该会话ANR，完成保存2.4km；不作为真机手感/长期性能通过 |
| 主/双图2D→3D50度与静止同步 | PASS（probe37指定状态） | 实际readMaps中心/zoom稳定，截图 `probe37-dual-3d-settled.png`；仍需最终40最新组合确认 |
| 稳定剖面图表、缩放与返回 | PASS（probe37指定状态） | 主审实际查看 `probe37-section-chart-settled.png`，剖面曲线和附带平面等高线显示；缩放/全图/返回/完成编辑通过，替代前节“早期截图未稳态”限制，不外推所有测点/导出分支 |
| 真实天地图3D与DEM就绪 | PASS（probe38指定视角） | zoom12/pitch55山地画面清晰，`probe38-3d-zoom12-settled.png`；真实frame/cache DEM revision一致，网格ready且读到高程，不能据此宣称手机FPS或全部视角画质通过 |
| 近景3D前景分块 | 未解决 | 实际近景仍见分块；raster/cache-ready为源码排查假设，尚无证据定为DEM原因。正在增加不包含URL/Key的诊断，须定位并复测 |
| 独立原生分享打印 | **FAIL（probe39最终图像）** | 管线首帧2530ms、source_ready501ms、最终帧581ms、PixelCopy309ms均走完，但实际1200×2773的 `probe39-route-share.jpg` 为暗空底图和过细路线。收到图像/PixelCopy成功不是底图及描边验收通过 |
| 实际系统分享选择器 | PASS（probe39入口）；未发送 | 真实按钮打开 `com.android.intentresolver`，未选择收件应用或发送，已按Back返回；不记录为跨应用交付成功 |

截图根目录为 `artifacts/screenshots/hybrid-map-20261028/`。以上为主代理在精确probe上的指定状态证据，不构成全UI或所有功能保留验收。

### 下一步与剩余限制

1. 分享print map、真实底图就绪和原描边匹配正在修复；保持SHARE FAIL，须在最终40实际看到正确底图/完整路线和可用输出后才能改结果。
2. 新生产调度器保留首个180ms定时器，持续frame只合并最新状态；DEM-cache事件也重新调度，created=false不启动同步，初始ACK后补排，cleanup取消。源码/3项行为测试PASS，未据此宣称probe38实际丢照片或最终40已验；持久照片与PhotoPanel未更改。
3. 合并最新React16与原生修复，fresh最终40核对源码/配置/资产，再复验照片GPU显示和点选、近景分块、主双图、剖面/图表、分享以及适用三尺寸。
4. 未满足上述门禁前，不记全视觉/全功能PASS，不生成或交付完整替换版。原身份149未构建，旧141与存档保留；真机GPS、后台/锁屏、相机、手机性能及HarmonyOS仍未验收。


## 2026-10-29 / 149私人候选实际运行，分享细节未通过

> **2026-10-29 / 142私人候选已构建，尚未交付**：原React界面/业务+原生地图的新原身份候选为com.guanyun.weather.shantu.preview / 0.2.142-test / code149，`.openai/hybrid-delivery149-candidate.apk`，180143662字节，SHA256 `de07fc1dcf67a177956d74b0f55ef5e188c694f468cf377345932acb4e60eae1`。原4a94签名、2178项CRC、1925份freshReact21资源、39+39图源/私人Key一致、496高程、四份64位ELF16KiB与zipalign通过；原生149/149、Node120项合并验证、TSC23通过。最终包已在独立AVD安装，内置天地图真实入口/原生3D及系统SAF导入GPX通过；未覆盖用户Androws、固定141或真实存档。只供本机拷贝，不发送企业微信、不公开私人APK。源码尚未提交推送。
>
> 新实测：probe45照片自动1组2张/实际触摸打开原查看页及1/2→2/2/返回通过；首次真实ACK丢弃后保持未ready，约10.4秒自动收到revision2真实ACK再就绪，未手动恢复。probe43静止frames358→474而bitmapDecode264不变，证实指定静止场景不再持续解码，不能外推手机FPS。**分享仍FAIL**：最终149首次冷缓存报渲染失败，第二次1200×2773成图描边和二维码正确但底图多数仍低清、仅左下1块高清；主地图相机完全保持。证据 `delivery149-route-share.jpg`。正在排查原生打印的GPU/SDK请求队列就绪与1200×1250纹理预算，不能把bitmap解码/pending0等同细节真正渲染，不据此交付替换包。既有PASS/FAIL历史以下保留。真机GPS/后台/相机/触控/性能、全量状态矩阵及HarmonyOS仍未验收。


## 2026-10-29 / 最终142私人本机交付

> **2026-10-29 / 私人142已本机交付**：按用户最新要求自行拷贝，不发送企业微信、不公开APK。最终 `APK/山兔手机.apk` 与 `交付包/山兔-0.2.142-test-2026-10-29/01-Android-APK/Shantu-0.2.142-test-private.apk` 完全一致，180488627字节，SHA256 `7833d6fa8c60c52b9b1ee8b76d07e4b24e2ba959c6597249c7e4cd242b2317c4`。com.guanyun.weather.shantu.preview / 0.2.142-test / code149，原4a94证书、旧MainActivity桌面别名与存储标识保留。原React业务界面+WorldWind原生地图；39图源、私人天地图与496高程保留。旧141交付存档哈希仍为ca3d673a...；用户Androws与真实存档未动。完整修改、证据及限制见 `docs/release-0.2.142.md`。
>
> 最终170项原生回归零失败/错误/跳过，120相关Node合并验证、TSC23/React21、2178项CRC/1925资源/Key一致性、64位16KiB及zipalign通过。精确最终包已覆盖安装独立AVD：原桌面入口能解析启动，既有测试GPX与TDT选择保留；390×857真实3D/DEM20网格81920点ready、地图DOM画布0；最终高清分享图已实际查看，主相机不变。瓦片稳定身份修复消除指定静止场景反复解码；前台请求4路仍受TDT4/250ms与退避保护。照片真实点击1/2→2/2、约10.4秒丢首ACK自动恢复及其它既有关键流程见记录。分享低清的历史FAIL已通过精确最终包复验替代；未扩大为全页/全部设备验收。
>
> 源码工作分支 `codex/tianditu-loading-20261027`；私人产物只在本机，公开源不含Key。真实手机流畅度/触控、GPS、后台/锁屏、相机与跨应用发送仍待真机；HarmonyOS原生HAP未交付，EXE/DMG未重建，9174网页与原Androws预览未自动替换。安装前先保存RAM画线草稿/记录，覆盖“山兔测试版”，不要先卸载。以下保留历史，不把旧候选或旧FAIL视为当前最终包。
