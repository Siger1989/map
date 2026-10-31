# 山兔安全源码同步与接续（2026-10-31）

本轮仅核对、整理和同步现有项目；没有改应用功能、路由实现、图源、版本或安装包，没有启动新模拟器任务。浮窗导航、球形浮窗与新的交通偏好仍处于讨论，未授权实施。

## 1. 当前来源与协作边界

- 工作目录：本机 `D:\天气系统`；换电脑后可放在其它路径。
- 唯一远程：`origin` → `https://github.com/Siger1989/map.git`。本轮通过GitHub仓库元数据确认 **visibility=public**，没有改可见性、分享权限或发布设置。
- 实际分支：`codex/tianditu-loading-20261027`。开工HEAD及fetch后的远端均为 `06930be99273cf0f937e92afa760a2d8c0588837`，ahead/behind为0/0；本轮文档提交接在它之后，最终SHA以Git日志及远端核对结果为准，不是main。
- 157产品实现来自 `d9eb222e4b5faed2636e07e223406f9e41d1407d`；`06930be`只补记临时外网交付。本轮也只改文档，产品构建来源未改变。
- 开工没有未提交的跟踪文件；只有旧PDF和三份Python字节码。当前三个绘制子agent均已完成，观测未见本工作树并行写入。其他compat/UI/search工作树原样保留，未切分支、合并、搬移或清理，不将它们冒充本分支最新成果。
- 目标、功能与门禁按 `AGENTS.md`、`docs/project-rules.md` 和 `docs/native-android/hybrid-*-20261028.md`；保留React界面和业务，仅地图使用原生渲染，不得用隐藏网页地图兜底。

## 2. 软件与安装包身份

当前 `config/product.ts`：**0.2.157-test / versionCode164**，包名 `com.guanyun.weather.shantu.preview`。原签名证书和 `com.guanyun.weather.MainActivity` 桌面别名保留。157是试修包，不能说真机闪烁已解决。

本轮重新读文件核对以下三份本机APK，均为165167188字节，SHA256均为 `751ddf8dedaaf3ce15d4fc7ccc72f3266384230c85bf7f3f760a757250b16f79`：

- `APK/Shantu-0.2.157-test-private.apk`
- `APK/山兔手机.apk`
- `交付包/山兔-0.2.157-test-2026-10-31/01-Android-APK/Shantu-0.2.157-test-private.apk`

原156和更早版本化包保留。安装前保存未落盘记录/草稿，再沿原包名覆盖安装；不通过卸载或换签名处理兼容问题。安装包内保留用户注册的天地图及39个私人图源。此类APK不进入公开仓库或公开Release。

## 3. 功能入口与依赖地图

| 范围 | 主要入口/依赖 | 接手注意 |
| --- | --- | --- |
| 共享界面和业务 | `app/page.tsx`；手机 `mobile/main.tsx` 复用Home与原CSS | 桌面/浏览器预览、APK平台能力和原生地图分别验收 |
| 地图适配与桥接 | `modules/map/native/NativeTerrainMap.tsx` → `NativeReactMapHost.kt` → `map/NativeMapController.kt` | `mobile-native/:hybrid`为当前个人升级包；旧`:app`原生UI原型不是交付入口 |
| 球形地图、地形与图层 | WorldWind Kotlin2.1.1；`mobile-native/app/src/main/java/com/shantu/nativeapp/map/` | 地图渲染与路由是两个独立边界；等高线、影像和DEM有各自缓存/工作队列 |
| 绘制、轨迹和节点 | `modules/tracks/`；原生overlay/投影/触控桥 | 157合并MOVE、增量长度、道路图复用、明确节点图像和同帧命中；手机手感待验 |
| 导航和离线路网 | `modules/navigation/`、`modules/offlineRouting/`、`modules/guidance/` | 本轮只核查原实现，见下一节；不得直接换供应商或追加交通偏好 |
| 标记/模型/照片/区域/收藏 | `modules/annotations/`、`modules/modelTerrain/`、`modules/photos/`、`modules/areas/`、`modules/collections/`及对应native renderer | 不改存储格式，不清空存档；贴地、点选和平台照片能力需分开记录 |
| 地图缓存 | `NativePersistentBrowseCache.kt`、`BoundedTileNetwork.kt`及离线包模块 | APP管理的持久目录为应用`filesDir/shantu-map-browse-cache`；磁盘缓存、离线包与每图GPU预算不同 |
| Android系统能力 | `mobile-native/hybrid/.../NativeReactActivity.kt`、现有`mobile/android`服务与网关 | GPS、后台记录、权限、文件/照片、系统分享各有真机门禁 |
| CAD及地形资源 | `mobile-native/app/third-party/`、`mobile-native/app/src/main/cpp/`、`public/terrain/` | LibreDWG固定源归档/许可已在Git；构建需NDK/CMake，不能漏掉原有来源署名 |

UI/业务及各平台完整功能矩阵见 `docs/native-android/hybrid-features-20261028.md`；表格是定位入口，不是全功能验收声明。

## 4. 本轮路由核查事实

共享React调用链是 `app/page.tsx` → `useNavigation`（`modules/navigation/useNavigation.ts`）→ `modules/navigation/provider.ts`。当前provider与141来源提交 `40fcdb14d6a30d06fdc7c9330b0884b00470b6b1` 中同一文件 **逐字节相同**，Git blob均为 `aa31db8e32e4927c94192d193d29cafd045b3e91`。

- 源码仍使用FOSSGIS/Valhalla在线 `/locate`、`/route`，`costing`保留 `auto`、`bicycle`、`pedestrian`。这是当前客户端实现范围，不代表本轮实测了外部服务所有模式/地区的可用性。
- `onlineFirstWithOfflineFallback`在`navigator.onLine=false`时直接走离线；在线fetch或读取响应发生连接失败/超时时，`requestJSON`将对应异常包装为`NetworkFailure`，然后触发离线回退。请求超时参数为25000ms；用户主动取消不按网络失败回退。
- `planRoute`的回退调用以`preference='offline'`进入`tryOfflineRoute`。离线图的profile及本地A*目前只实现`pedestrian`；驾车/骑行在此路径会抛出“离线引擎当前支持步行”的限制信息。因此最后的步行提示**可能掩盖最初在线连接失败**，这只是源码机制，尚未采到手机本次失败链。
- HTTP429和有效服务错误使用普通Error，不走该NetworkFailure回退；数据格式错误也不能当连接失败处理。
- 本轮运行既有 `navigation-online-first`、`departure-navigation` 合计7项检查，PASS；它们是本地逻辑检查，不是在线服务或手机端验收。

不能把WorldWind地图渲染引擎称为规划路线的路由引擎，不能据此认定手机失败已诊断，也不能宣称在线规划必须付费。本轮没有修改路由代码、供应商、模式或异常提示。

## 5. 构建与接续入口

GitHub当前源码树用于恢复公开项目部分，**不包含本人当前私人配置、原签名私钥、用户存档或本机APK**；第8节的历史敏感遗留不能作为安全私密备份。先按第8节通过可信私密方式迁移本机必需文件，再构建含天地图个人包；不要为构建通过生成替代签名或无Key交付包。

```powershell
git clone --branch codex/tianditu-loading-20261027 https://github.com/Siger1989/map.git
cd map
git status --short
npm ci
```

Node要求至少22.13，本机使用Node24。`npm ci`的postinstall同步地图worker及CAD网页运行时，依赖由`package-lock.json`锁定。当前原生工具链以仓库实际配置为准：JDK17、Gradle9.5.0、AGP9.3.1、Kotlin2.4.10、compileSdk37、targetSdk35、NDK28.2.13676358、CMake3.22.1。旧文档仅写SDK35的说明不足以独立构建当前`:hybrid`。

先从 `config/domestic-maps.env.example`、`config/geocloud.env.example`理解字段，再恢复本人已有`.env.local`、私人39源种子和原JKS；不填写/提交真实值到模板。`config/android-standalone-signing.json`是公开包身份/证书指纹，不是签名私钥。

在仓库根目录构建当前私人混合包（以下路径需替换为当前机器的实际位置；本轮未重新执行构建）：

```powershell
$env:JAVA_HOME = '<JDK17目录>'
$env:ANDROID_HOME = '<AndroidSDK目录>'
$env:GRADLE_USER_HOME = '<ASCII路径的Gradle缓存>'
npx vite build --config mobile/vite.config.ts --mode native-hybrid
& '.\mobile-native\gradlew.bat' -p mobile-native '-PbuildStage=<源码同盘的ASCII构建目录>' ':hybrid:assembleOptimized' '-PhybridDelivery=true' --no-daemon --console=plain
```

实际APK输出为`<buildStage>/hybrid/outputs/apk/optimized/hybrid-optimized.apk`。本机暂存为`D:/ShantuNativeTools/mobile-native-build`，Gradle缓存/便携工具也在`D:/ShantuNativeTools`。缺少Key/种子/签名或证书不符必须停止，不能交付不一致替代包；Windows非ASCII工具/资源路径遇到aapt2问题时使用已验证的ASCII暂存路径，参见`mobile-native/README.md`。

原生交互预览入口是 `http://127.0.0.1:9174/native-app-preview.html`，服务脚本 `scripts/android/native-marker-regression/preview-server.py`，需显式指定目标ADB设备。它传输实际APK视频并注入触控，不是网页地图。`npm run dev:apk-preview`启动的`phone-preview.html`是浏览器参考，不能称为原生APK性能/真机证据；9174当前占用时不能抢端口或替换现有服务。浏览器参考的`/api`还需独立API服务（默认代理3108）。

## 6. 验证边界与未完成问题

| 层次 | 已有证据 | 尚不能宣称 |
| --- | --- | --- |
| 源码/软件 | 157既有TSC、31 Node、17 Kotlin、fresh私人React/R8 optimized构建PASS；本轮确认日志存在且PASS、运行路由逻辑7项PASS，产品源码未改 | 没有重跑整套测试或重新出包；额外旧外壳manifest版本断言1项FAIL仍保留，见157交接 |
| 包完整性 | 本轮三份157文件大小/完整SHA一致；此前原签名、CRC、39源、1925fresh React、473+23 DEM、4份64位ELF/16KiB检查PASS | 包完整性不证明地图性能或全部功能通过 |
| MuMu3 | 157此前实际三点画线、MOVE抬手末点与10组静止姿态记录；后半段无新增影像解码，临时点已撤销 | 156同机也未复现持续循环；不能由此声称手机闪烁解决，视频不是FPS证据；本轮未重新操作/重装模拟器 |
| 手机真机 | 用户明确156静止、3D倾斜/关闭等高线和部分2D高度仍闪，画线卡/节点错位，属于FAIL | 157下载已提供不等于已安装/复测；157静止闪烁、节点拖动、长线、主双图内存和GPS/后台仍待真机验收 |
| UI/其它平台 | 原React视觉及既有指定场景证据保留 | 本轮未重测390×857/360×780全矩阵；HarmonyOS原生HAP未交付，EXE/DMG未重建 |

157渲染预算是非低内存设备取旧heap/2（8–192MiB）与物理内存1/16的较大值，封顶512MiB，未知/低内存保留旧算法；每张地图分别计量，不是预分配。模拟器实际读到约246.2MiB；**真机静止闪烁根因仍未坐实**，不能继续无数据叠加预算。具体改动见 `docs/HANDOFF-20261031-157.md` 和 `docs/native-android/performance-design-and-tuning.md`。

优先复现：记录实际APK版本、手机型号、图源、地形/等高线状态，在用户反馈高度静止30–60秒，分别检查2D和3D轻倾斜、等高线开/关、旋转后停手；再测试连续画线、节点选中/高亮/拖动和道路吸附。不要覆盖或删除原路线。采真实帧、解码/上传、每图GPU容量/使用、堆/PSS、相机/DEM序号、请求/排队，区分LOD、地形、缓存淘汰与相机回声。

路由复现应先记录`navigator.onLine`、请求阶段（locate/route）、网络异常或HTTP状态、超时/取消、选择模式、是否进入离线及覆盖包，保留最初失败。没有这组真机证据前不改引擎或认定付费问题。业务日志不得带私人Key、完整含凭据URL或真实用户路线数据。

## 7. 下载交付的三种状态

1. **本机文件：已交付路径并重新校验。** 第2节三份157文件一致；历史156仍在。
2. **聊天附件/Library：无附件ID或永久云端文件ID。** 不能将临时隧道称为聊天附件上传成功。
3. **授权的临时外网单文件通道：已实际交付并核对。** `.openai/private157-external-download-proof.json`记录2026-10-31 18:55:22（上海）完整外网下载165167188字节及SHA一致；本轮再次Range返回206、1024字节且APK头正确。计划到期为2026-11-01 06:52:32（上海），依赖开发电脑/服务在线，不能作为永久链接或手机安装证明。URL、随机路径、进程状态和脚本只在`.openai/private157-download*`本机保留，不写GitHub；到期后先查本机状态，不擅自重开或发布公开包。

不能将“无附件ID”写成全部下载未交付，也不能沿用102–104版过期临时地址。本轮将当前文档里的旧随机地址替换为省略说明、保留原到期与核验记录；改前文档在`.openai/source-sync-20261031-before-docs/`，Git提交历史没有改写。

## 8. 安全检查、未上传与待备份

本轮先检查开工公开树4822份文件（约285MB），再复核最终暂存树，核对已知本机私有值、高置信凭据模式、排除文件类型及新暂存内容；检测仅报告类型/路径，不打印值。旧文档发现随机下载地址，已只在当前文档省略；这不等于消除了Git历史中的记录。

**历史遗留：可达Git历史仍可取回`.env.local`及`mobile/.build/guanyun-test.jks`的旧记录。** 本轮仅报告，不删除或轮换凭据、不清历史、不强推，不证明这些旧凭据仍有效，也不声称完成全部历史秘密审计。公开仓库源码同步不等于全量备份或凭据泄露已处理。

| 未上传类别 | 安全本地保留位置 | 仍待备份/验证 |
| --- | --- | --- |
| 真实环境、私人Key/Token与私人图源 | `.env.local`、`.openai/default-map-sources-private.json`、生成的`mobile-native/app/build/generated/privateAssets/native-private-config.json`；均忽略 | 原始环境和种子需可信私密迁移；本轮没有核验独立加密/异机备份，生成配置可再生 |
| 原签名私钥 | `mobile/.build/guanyun-test.jks`或本人`GUANYUN_SIGNING_KEY`指定位置；本机文件存在且被忽略 | 原私钥须可信加密备份；缺失不能重新生成替代或从GitHub恢复成“安全私有来源” |
| 含私有配置APK、校验与归档 | `APK/`、`交付包/`；157及历史包保留 | 未上传公开Release；尚未核验独立异机副本 |
| 用户个人数据、照片、轨迹、离线包和持久缓存 | 实际手机/模拟器APP私有存储；浏览器各自IndexedDB/本地存储；本机既有导出原位保留 | 本轮未从真机导出完整工程/原片/未落盘草稿，不能称已备份；缓存可再生不代表个人记录可再生 |
| 本机证据、截图、构建与临时下载状态 | `.openai/`、`artifacts/screenshots/`、`mobile/dist-hybrid/`、`D:/ShantuNativeTools/mobile-native-build`及Gradle缓存 | 私人证据/地址不公开；公开去标识数字摘要已在`artifacts/performance/native157-static-sweep-20261031/` |
| 旧生成PDF及Python字节码 | `output/pdf/shantu-status-2026-09-22.pdf`、`scripts/macos-dmg/__pycache__/`、`tests/__pycache__/` | 保留未跟踪；PDF是旧报告，不冒充必需源码；字节码可再生，无须纳入源码备份 |

空凭据模板、构建脚本、锁文件、源码、定向测试、既有授权资源与许可均在版本管理中；开工未发现遗漏的未跟踪必需源码/模板。本轮没有额外创建重复开发任务。

## 9. 本次同步完成条件

本轮仅文档改动，提交前检查暂存文件范围、敏感类型/路径、相对链接和`git diff --cached --check`，再次读回本交接；正常推送到实际开发分支后用`git ls-remote`核对完整SHA与本地HEAD一致。不合并main、不强推、不更改权限、不公开私人APK。本轮报告中的最终完整commit应由这次真实核对产生。
