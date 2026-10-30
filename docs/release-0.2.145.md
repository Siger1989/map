# 0.2.145-test 私人手机测试包

2026-10-30。用户要求打包后在自己手机试用；只交付本机私人Android APK，不公开含Key产物、不发送企业微信。模拟器不启动，未操作Unreal。本包是测试交付，手机加载速度、长时内存和完整功能体验尚未验收。

文件：`APK/Shantu-0.2.145-test-private.apk`（165116064字节）；存档同包：`交付包/山兔-0.2.145-test-2026-10-30/01-Android-APK/Shantu-0.2.145-test-private.apk`。

SHA256：`b642cb3d7e833692fcce7a794264e4795b35dd9a5e092696c13e4b2eae36f4d9`。同目录提供`.sha256`校验文件。

## 本批调整

- 原生实际绘制帧与不可变相机/视口/地形版本绑定，减少相机与矩阵跨帧拼接；保留100/33ms业务采样及尾帧。
- MOVE节流先于JSON构造，pointers按触摸/绘制需要创建；多指、取消、绘制和原React业务路径保留。
- 天地图按官方GetCapabilities有效层级请求：img/vec最高18、ter14、cva19、cia/cta/ibo18，最低均1；超过源最高级继续放大最高可用瓦片，避免虚构层级请求。
- 新增APP自建持久目录`filesDir/shantu-map-browse-cache/`，默认8GiB数据预算、按实际浏览增长，不预占8GiB或一次读进RAM；内存字节缓存仍12MiB。SQLite索引/WAL、LRU、256MiB存储余量、原子写和清理代次保护；存储失败不阻止有效地图响应。
- 原生共享加载器的天地图底图/自定义栅格及可见天地图地名/境界共用缓存。过期图片先显示、后台有界更新，常规纹理按工厂键精准失效；停用透明但仍下载的旧地名层。
- 网络天地图4个活动请求/250ms启动节奏及429退避保留。该节奏是项目配置，不是已确认的用户Key官方上限；没有用每日额度冒充QPS。

包名、原签名、桌面入口、Logo、原React界面、39图源/私人天地图配置、原数据格式保留。旧142固定包、143与144均保留。本轮未清空或覆盖用户存档；未新增缓存容量选择/专用持久缓存清理UI。独立Sentinel/GIBS等其它HTTP链及固定细节拼图更新及时性不笼统报告已全部接入/验收。

## 构建与检查

- `0.2.145-test` / versionCode152，原包名`com.guanyun.weather.shantu.preview`、原4a94…6f9f证书，非debuggable R8 optimized构建。
- 73项受影响原生单元检查PASS，0失败/错误/跳过。私人React资源重建、TypeScript、optimized APK组装PASS。
- 2165项ZIP CRC、1925份fresh React资源逐文件一致、145版本标识、私人配置/Key一致且存在、39图源与473+23高程、原证书APK签名、4份64位ELF 16KiB及zipalign检查通过。DEX含新持久缓存功能标识；原桌面MainActivity别名及非debuggable状态核对通过，未启动应用冒充运行验证。
- 交付与构建APK的SHA256一致；原固定142和原144哈希核对未变，143文件保留。校验记录`.openai/private145-integrity.json`，构建日志`.openai/private145-optimized-build-20261030.log`；私人产物未公开。
- 构建命令：私人`native-hybrid`模式Vite构建；`:hybrid:assembleOptimized -PhybridDelivery=true`。仅原本机私有配置参与打包，Key不进入源码/聊天/运行日志。

## 手机建议试验

1. 保存当前记录/画线草稿后覆盖安装“山兔测试版”，不要先卸载。
2. 先看一个新区域，来回拖回去，再退出重开看同一区域，比较本地缓存复用。
3. 放大到源最高级以后继续放大，检查底图是否保持可见；再试地名、地形、双图和绘制。
4. 首次到新区域仍需联网；这批源码检查不证明Find X8加载速度/触控/内存退出已修复。记录首次加载、回访、重启后的实际差异即可。

Android：本轮私人测试APK。HarmonyOS 6.1：原生HAP未生成/未交付，不能把Android APK说成原生鸿蒙包。EXE/DMG未重建，9174网页未切换为本包原生预览。GPS、相机、后台/锁屏、跨应用发送与长时性能继续按真机结果记录。

详细原因、方法和证据：[本批源码与加载排查](native-android/frame-touch-loading-review-20261030.md)。

换电脑接续：[145交接入口](HANDOFF-20261030-145.md)；[脱敏校验摘要](native-android/verification-145-20261030.json)。
