# 当前安装包：山兔0.2.9-test独立版（2026-09-08）

新增气温图层、导航模式和同模式接入起点、完整路线图片/高程图/GPX/KML/高德链接分享，以及可大幅简化的离线路线二维码。修复规划按钮无说明灰色。见[功能与模块](../docs/temperature-navigation-sharing.md)及[安装/平台/校验](../docs/release-0.2.9-standalone.md)。版本16，沿用独立系列包名与签名，原系列并存，鸿蒙6.1原生包未交付。
# 历史构建基线：山兔0.2.8-test独立版（2026-09-08）

[下载APK](https://github.com/Siger1989/map/releases/download/v0.2.8-test-standalone/Shantu-0.2.8-test-standalone.apk) · [完整发行与校验](../docs/release-0.2.8-standalone.md)。新增室内网络定位、完整扫码画面与镜头切换、地图重复刷新/小幅跟随抖动修复，包含记录样式选择。见[模块接口与验证](../docs/indoor-position-and-camera.md)。

versionCode15；本机实际私钥为0.2.5独立系列4a94，沿用`com.guanyun.weather.shantu.preview`，安装名「山兔测试版」，构建传`-StandaloneTest`。可覆盖同签名独立版；与原观云系列0.2.6/0.2.7并存、不自动迁移数据。下文原系列密钥可用的描述是另一台机器的历史情况。本版类型/247项回归/9项Java策略/网页与APK构建/签名/资源检查通过，手机X8 Ultra未连接，真实室内定位/镜头/道路闪烁待验。HarmonyOS6.1原生包尚未生成，已有草稿不等于可安装交付。

# 历史安装包：山兔0.2.7-test（2026-09-08）

[下载APK](https://github.com/Siger1989/map/releases/download/v0.2.7-test/Shantu-0.2.7-test.apk) · [完整发行、校验与鸿蒙状态](../docs/release-0.2.7.md)。versionCode14，包名`com.guanyun.weather.preview`，安装名「山兔」，使用原签名，可覆盖0.2.4原系列。与0.2.5独立山兔版并存，数据不自动迁移。本机保有原系列密钥，缺少公司0.2.5独立版密钥，下文0.2.5的机器说明是历史情况。

新增手绘与收藏直接导航，保留原线形并支持导航中切换所选路线；详细行为见[保存路线导航](../docs/saved-route-navigation.md)。

已选中轨迹后，顶部「继续绘制」直接续画该条；未选中才出现选择器。包含下列新建/自动存档、逐点吸附、紧凑UI与顶部搜索更新。追加原生记录相同快照不重复提交地图数据，闪烁仍待复现。签名、资源、类型、236项回归和浏览器流程通过，无已连接真机；原生鸿蒙包尚未生成。

构建命令：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -SdkRoot <Android SDK路径> -JdkRoot <JDK17路径>`。本次使用原系列密钥，不传`-StandaloneTest`；不同系列密钥不能混用。

# 已包含：新建、选择续画与自动存档

画线默认新建，继续绘制可选具体线路，完成时自动保存时间与起点附近位置；续画保留所选记录，原始实走/时间记录仍复制为手绘。说明见[绘制存档](../docs/drawing-archive.md)。新按钮采用明确底色、边框与展开/继续图标。

# 已包含：逐点画线

画线固定为逐点连线，新建和续画不再切换平滑画；道路与节点吸附默认开启，仍可手动关闭。移除牵引杆设置，保留颜色与线宽。已包含于0.2.6，未完成真机触控验证。下文为历史安装包说明。

# 历史：山兔 0.2.5 独立测试版

同一版本新增 [矩形交线剖面与对象 Gizmo](../docs/elevation-section.md)：完整模型保留，剖面/标记共用箭头移动、圆环旋转、方块拉伸；详情滑杆读取交线点的海拔/坐标，并保存附详细信息的图片。手机主界面同步引入操控器样式；安卓返回按详情、操作、剖面逐层退出。

同一版本新增 [地图图源选择、二维码与在线 / 离线地图导入](../docs/map-sources.md)：XYZ / TMS、WMTS / WMS3857、栅格 TileJSON / MOBAC XML、栅格 MBTiles 与部分 GeoTIFF；工具和图层页均有入口。相机扫码使用受控视频权限，离线解析模块与 SQL WASM 随应用打包；不支持奥维加密 `.ovmap`。原生相机仍待真机验证。

产品面向全球，首次打开世界地图。当前安装包为 [Shantu-0.2.5-test-standalone.apk](https://github.com/Siger1989/map/releases/download/v0.2.5-test-standalone/Shantu-0.2.5-test-standalone.apk)，安装名“山兔测试版”，包名 `com.guanyun.weather.shantu.preview`。按用户授权使用独立签名与包名，可与旧版并存、数据独立；完整更新、压缩和校验见 [0.2.5 发行说明](../docs/release-0.2.5-standalone.md)。

新增 [照片全屏放大、编辑/标记、系统分享/保存、海拔和拍摄天气](../docs/photo-details.md)，同一版本；旧APK不包含这些源码更新。

同一版本新增“实走记录 → 记录精度”：默认20米，可设置5–80米的最大估计误差，后续定位点即时按设置筛选；见 [精度设置与刷新说明](../docs/recording-accuracy.md)。

versionCode 12：实走保存保留来源与逐点时间，重开后可选作照片匹配；原始记录改线另存手绘副本；新增照片文件夹导入。详见 [修复说明](../docs/recording-photos-fix.md)。本机缺少 0.2.4 的原签名，独立版使用 `-StandaloneTest` 构建。默认原包名仍固定旧证书指纹，拒绝不同证书；`-SigningKey` / `GUANYUN_SIGNING_KEY` 可指定所选版本对应的私密密钥。`-UnsignedOnly` 仅供编译检查，不能安装。

# 历史：0.2.4-test 行程照片地图

versionCode 11，沿用包名与签名，可覆盖 0.2.3。行程 → 照片支持系统多选图片，按拍摄时间匹配实走/GPX 轨迹，在地图显示缩略图和本机预览。详见 [照片说明](../docs/trip-photos.md)。安卓多选和真机 HEIC 解码待设备验证；不申请整个相册的读取权限。

# 0.2.3-test 记录位置跟随

versionCode 10，沿用包名与签名。开始/继续实走记录时自动跟随，拖动地图暂停，点击右侧定位按钮恢复；不重置原有 3D 角度和缩放。普通定位也可持续跟随。详见 [跟随说明](../docs/position-follow.md)。

# 0.2.2-test 直接输入、途经点与拖动进度

versionCode 9，签名与包名不变，可覆盖安装。路线地点可直接输入，途经点支持手机拖柄排序；行程条细长、支持拖动联动地图。安卓键盘使用 IME inset/adjustResize，已检查压缩视口，但未连接真机验收。

# 0.2.1-test 视角控制器恢复

原 3D 绿色模型与圆环控制器默认显示；包名、签名不变，versionCode 8，可覆盖 0.2.0。

# 0.2.0-test 户外实用版

新增安卓前台轨迹记录、系统文件导入导出、可续传离线地图包；默认免 Key 开源地图与精简工具。包名和签名沿用 0.1.4/0.1.5，可覆盖安装。versionCode 7。功能与限制见 [户外说明](../docs/outdoor.md)。

# 观云安卓测试版

旧包名安装包：[Guanyun-0.2.4-test.apk](https://github.com/Siger1989/map/releases/download/v0.2.4-test/Guanyun-0.2.4-test.apk)（本地产物 `APK/Guanyun-0.2.4-test.apk`），应用名“观云测试版”，包名 `com.guanyun.weather.preview`，版本代码 11。沿用 0.1.4 起的本地测试签名，可直接覆盖更新 0.1.4–0.2.3 测试版并保留其本机数据；可与原“观云”并存，不能覆盖原版，数据不会自动迁移。

## 安装与使用

1. 把最新山兔 APK 传到手机，在文件管理器打开安装；新版显示为“山兔测试版”，原“观云”/“观云测试版”及其数据保留，应用数据独立。电脑页面修改不会自动进入手机，必须安装新版 APK。
2. 要求 Android 8.0+、OpenGL ES 3 / WebGL 2，Android System WebView 或 Chrome 120+。
3. 界面与成都区域高程内置；道路、卫星图、天气、地质概览及路线服务联网获取，不要求电脑开机或登录 OpenAI。不是全国离线地图包。
4. 默认没有上拉大面板：点左下温度/海拔看天气，右下“行程 / 路线 / 工具”打开小浮窗，时间与图层位于“工具”中，点 ×、地图或返回键关闭。海拔/地质图例常驻小色带。
5. 地图单指平移，双指捏合缩放/旋转、双指并排上下滑动调俯仰。右下绿色模型上下拖动调角度，底点不动；椭圆环滑动转向。
6. “路线 → 道路规划”：选驾车/骑行/步行，在起终点栏直接输入并选择搜索结果，或点图钉在地图选点；可添加最多 8 个途经点，拖右侧手柄调整顺序，点“规划路线”。显示实际道路路线、距离、预计耗时；顶上的路线摘要可重新打开详情。包含转向列表；支持当前位置和持续定位显示；尚无语音导航、实时路况；道路与手绘均有沿途天气，右侧可主动定位并显示行程位置。
7. “路线 → 手绘轨迹”：先用偏离手指的准星和放大镜精确定点，再拖绿色环平滑画；也可切换逐点连线。单指画、双指直接控图，支持节点吸附、可选道路/山路吸附、细线/颜色、撤销和本机保存。已保存线路可点选编辑、续画、反向、合并相接线路，节点可长按移动。点“统计 / 天气”看全程里程、高程剖面/爬升下降，设置出发时间和速度获取沿途天气。数据只存本机。
8. “标记”可放地点和米制几何模型。列表与编辑分开，参数分为尺寸 / 外观 / 位置 / 更多；手机面板限高 38dvh / 320px，内容内部滚动。点“地图调整”收起面板，长按模型移动并同步坐标；列表页保留新建、显示开关、对比与导出。
9. 左侧细长行程条可直接拖动，地图同步预览沿线位置，显示里程、预计抵达时间与附近采样天气；真实 GPS 进度独立显示。
10. “行程”提供实走记录、数据导入导出与离线包；操作和覆盖范围见 [最新详细说明](../docs/release-0.2.2.md)。地形裁切剖面已停用，界面不显示入口；轨迹的高程统计图仍保留。

1∶20 万地质云仍缺授权。路线使用 FOSSGIS / Valhalla 公共测试实例，地名搜索使用 Photon；均无生产可用性承诺，后续销售应改为自有后台或有服务保障的提供方。目前其他地图/天气来源仍含非商业资源，不能直接作为已完成商用授权的销售版本。

## 模块与接口

- `main.tsx` / `index.html` / `vite.config.ts`：静态客户端复用网页组件和各模块的样式。产物 `mobile/dist/`，原生 HTTPS 本地资源来自 APK assets，不加载 localhost。
- `android/src/com/guanyun/weather/MainActivity.java`：WebView、安全区、生命周期、外部链接和返回键。原生已避让的系统栏不再重复传给网页；返回键优先关闭浮窗，其次结束轨迹编辑/选点。包含联网及用户主动触发的定位权限；Android 键盘通过 IME inset/adjustResize 避让。
- `NativeBridge.java` / `RecordingService.java` / `RecordingStore.java` / `AppFiles.java`：受限命令桥、带持续通知的定位前台服务、原生记录存储与系统文件导入导出。浏览器仅前台记录；安卓锁屏定位代码已接入，实际持续性受系统和厂商省电策略影响，待真机验证。
- `LocalGateway.java`：固定 APK 资源域 `appassets.androidplatform.net`。地形范围内读取本地瓦片，其他区域请求固定 S3；地质概览代理 Macrostrat；卫星日期读取 NASA 元数据；地质云明确未授权。与网页端共享约定的请求接口。
- `DataTransport.java`：固定 HTTPS 源、超时/响应体限制、瓦片校验、日期解析与 64MiB 私有缓存。路线/地名通过网页端 HTTPS+CORS 请求，由 navigation 适配器管理，没有把 Token 放入包内。
- `scripts/build-android.ps1`：Vite / AAPT2 / Javac / D8 / 无损 PNG/ZIP 压缩 / zipalign / 测试签名；从 Manifest 读取版本，验证签名、473 张地形与 23 张修复瓦片并输出 SHA-256。`-StandaloneTest` 切换独立包名与证书，保留对应私密密钥才能持续覆盖同一路版本。测试签名不用于正式发行。
- 新的功能模块边界、公共服务条件和回滚说明见 `docs/mobile-controls-and-routes.md`。

## 构建与验证

独立山兔版在项目根目录运行 `npm run build:apk -- -StandaloneTest`；原包名构建仍用 `npm run build:apk` 且需要原签名。默认 SDK 为 `D:/GodotAndroid/sdk`（platform 35 / build-tools 35.0.0），JDK 17；脚本支持 `-SdkRoot` / `-JdkRoot` 参数。网站单独运行 `npm run build`。

检查覆盖 TypeScript、天气/地质回归、导航响应与边界、牵引算法/轨迹存档、旋转边界、安卓返回脚本；实际调用路线三种方式及中文搜索。APK 检查包含启动 Activity、版本、v2/v3 签名、静态 worker、覆盖索引、473 张地形瓦片，以及不混入 .env/密钥/开发文件。

本轮未完成新版真机安装、WebView 渲染、牵引手感与性能验收。编译、服务响应和签名通过不代表真机交互已经实测。

0.1.2 详细交互、统计定义、模块接口及验证：见 docs/track-drawing-and-journey.md。

0.1.3新增道路天气色带、路线收藏、定位与方向切换，并修复手机绘制坐标：见docs/navigation-weather-location.md。定位由用户按钮触发，需要系统允许位置权限。


## 后续鸿蒙安装交付

用户在2026-09-08要求以后生成APK时也提供鸿蒙可用的安装交付，已加入项目AGENTS.md。现已确认目标为朋友的 HarmonyOS 6.1 手机，并明确要求原生包、希望直接分享安装，具体机型未知。已核查 uni-app/uvue 路线：可评估独立 web-view 容器复用现有 React 地图，仍依赖 DevEco 工具链和华为签名。用户暂时无法登录华为下载工具，也没有或不确定开发者账号；本轮仅完成路线与限制说明，没有创建原生工程或生成 HAP/APP。详见 [HarmonyOS 6.1 适配与安装](../docs/harmonyos-6.1-install.md)。

当前仓库原生代码为Android Java/WebView，没有HarmonyOS原生工程。兼容安卓的鸿蒙设备需测试APK实际安装；原生鸿蒙/NEXT需新增原生工程与定位、后台记录、文件/照片、分享等桥接，完成签名及设备安装验证后再随版本发布。测试产物与正式上架包按所用分发流程区分，不能仅更改APK扩展名。

华为官方说明：[鸿蒙应用开发与提交](https://developer.huawei.com/consumer/cn/app/submit/)、[HarmonyOS 5及以上下载安装方式](https://consumer.huawei.com/cn/support/content/zh-cn16061787/)。第三方兼容环境对APK的支持以实际环境为准，不作为本项目原生鸿蒙适配已完成的依据。
