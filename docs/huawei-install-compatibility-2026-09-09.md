# 华为手机安装兼容性核查（2026-09-09）

## 最新截图已定位：HarmonyOS 4.2.0.189启动被应用拦截

用户补充系统4.2.0.189与“需要更新系统网页组件”页面。后者是山兔`MainActivity.java`生成的本地页面：APK实际上已经安装并启动，程序尚未尝试加载地图，就因`WebView.getCurrentWebViewPackage().versionName`首段小于120返回。此前“缺少失败原文”的状态已过时。

`getCurrentWebViewPackage()`返回的是组件包信息，不能把所有厂商的包版本规则当作Chromium内核主版本。[Android API](https://developer.android.com/reference/android/webkit/WebView#getCurrentWebViewPackage())。当前截图没有暴露实际UA/内核版本或WebGL能力，因此不猜测华为组件具体内核号。

0.2.17修复移除这处门槛，使用真实能力检查，并在软件内补必要网络取消接口、旧布局能力和公共地图worker编译。[MapLibre官方支持检测](https://maplibre.org/maplibre-gl-js/docs/examples/check-if-webgl-is-supported/)、[Vite构建目标](https://vite.dev/config/build-options)、[Lightning CSS兼容转换](https://lightningcss.dev/transpilation.html)。保留真实图形初始化失败的诊断，不以隐藏错误假装地图可用。当前目标是让现有4.2系统运行APK，不要求系统升级；与下面6.1原生交付是不同问题。

以下是收到本轮截图之前的包级调查记录。最新验证与安装入口见[0.2.18发行说明](release-0.2.18.md)，已一并整合收藏栏和无等待的单指响应。

用户最初报告P70 Pro安装失败，另有Pura X Max；随后确认两台系统分别为HarmonyOS4.2和6.1。当时尚未收到失败页面、完整系统构建号或设备日志。

## 当前结论

| 系统 | 山兔目前的安装路线 | 核查结论 |
| --- | --- | --- |
| HarmonyOS 4.2 | 使用现有 Android APK | 包级检查没有发现最低系统、签名或 APK 自带 CPU 库导致的明确阻断；不能据此声称该手机已安装通过。需要失败原文定位。 |
| HarmonyOS 6.1 | 原生鸿蒙包为目标；APK 经卓易通兼容试装为备选 | 当前交付只有 APK，没有已验证的原生 HAP/APP 或邀请链接。兼容容器能否接收和运行此包需要实测。 |

华为将 HarmonyOS 4.X 与 5 及以上的安装指引分开；5 及以上允许通过下载或分享取得 APK，但是否可安装取决于卓易通实际支持。不能把 6.1 的系统版本直接代入 Android API 数值，也不能通过降低 APK 的 targetSdk 把它变成原生鸿蒙应用。[华为安装故障说明](https://consumer.huawei.com/cn/support/content/zh-cn00445299/)、[HarmonyOS 5 及以上下载安装](https://consumer.huawei.com/cn/support/content/zh-cn16061787/)。

## 本次实际检查的发布包

- GitHub 公开测试 Release：`v0.2.14-test`；APK `Shantu-0.2.14-test.apk`，55,219,775 字节。
- 下载文件 SHA256 与 GitHub 资产 digest、现有发行说明三者一致：`a5a13e86c26671a819082950669748cc40da53ed8d03217f029e0358eda917ff`。这证明本机下载完整，不代表朋友收到的文件相同。
- 对实际 APK 执行 aapt2：包名 `com.guanyun.weather.preview`，版本 `0.2.14-test / code21`，minSdk 26，targetSdk 35，无 maxSdk；OpenGL ES 3.0，摄像头非必需。
- 对实际 APK 执行 apksigner，API 26—35 范围验证通过，v2/v3 签名有效；证书 SHA256 为 `a3aa453c7fa05d8a5d54a11c648edbcc02297b064db50e44bcfea2b0b91cd29c`，与仓库原系列签名配置一致。zipalign 检查通过。
- ZIP 内 532 项，包含 `classes.dex`，没有 `lib/` CPU 专用原生库。未发现仅打包 x86 或仅打包某一 ARM ABI 的问题。
- Android 外壳与 package.json 未发现 GMS/Firebase/Google 定位 SDK 或 `System.loadLibrary` 依赖；定位使用 Android `LocationManager`。当前没有证据表明需要朋友安装谷歌服务来解决安装失败。
- 源码入口：`mobile/android/AndroidManifest.xml`、`scripts/build-android.ps1`、`config/android-signing.json`、`mobile/android/src/com/guanyun/weather/ForegroundLocation.java` 和 `RecordingService.java`。

minSdk 26 表示 Android 8.0 最低要求；targetSdk 35 不表示只能在 Android 15 安装，Android 官方明确允许向下运行到 minSdk。没有理由仅凭此数值降低目标版本。[Android uses-sdk 文档](https://developer.android.com/guide/topics/manifest/uses-sdk-element)。

[下载本次核验的 APK](https://github.com/Siger1989/map/releases/download/v0.2.14-test/Shantu-0.2.14-test.apk) · [Release](https://github.com/Siger1989/map/releases/tag/v0.2.14-test)。本机核验日志保存在 `.openai/huawei-apk-*-20260909.log`，不提交日志或 APK。

## 鸿蒙 4.2：按失败文字处理

先收集完整报错、文件名和失败阶段；不要先卸载旧版或清除路线数据。

| 看到的提示 | 下一步 |
| --- | --- |
| 文件无法打开，实际后缀为 `.apk.1` | 文件管理中仅去掉末尾 `.1`，恢复 `.apk`；或从上方 Release 重新下载。 |
| 无效 APK／解析失败 | 核对是否拿到完整 APK、文件大小与版本；重新从发布链接下载。仍失败则记录原始错误码，不能直接归因芯片。 |
| 更新不兼容／签名不一致 | 核对已装版本、包名和证书；保留旧数据，优先使用相同签名的更新包。华为市场的签名提示与系统更新拒绝需要根据完整文字区分。 |
| 纯净模式／增强防护／外部来源限制 | 属于安装来源校验路径，先确认收到的是本项目原始发布包，再按手机实际安装提示处理；本轮未修改任何手机安全设置。 |
| 已安装，点击后闪退／地图空白 | 转为启动或网页内核兼容性调查，记录 WebView、WebGL、资源请求和崩溃日志，不能继续只查安装签名。 |

依据：[华为安装错误说明](https://consumer.huawei.com/cn/support/content/zh-cn00445299/)、[华为“签名不一致”提示](https://consumer.huawei.com/cn/support/content/zh-cn00775981/)、[分享 APK 后缀说明](https://consumer.huawei.com/cn/support/content/zh-cn16061787/)。错误码含义以手机实际安装器为准。

原系列 APK 与 `0.2.11` 独立版包名不同；不同包名可以并存，不能仅因“独立版签名不同”就认定发生同包覆盖冲突。当前不知道朋友是否安装过旧版。

## 鸿蒙 6.1：原生交付还缺什么

本机 `mobile/harmony` 仅有六个既有未跟踪 uvue/UTS 草稿，没有可验证的最终 HAP/APP。草稿保留未改；不能把它们作为可安装工程或已完成适配的证据。

适配路径继续沿用独立鸿蒙容器复用 React 地图：验证 ArkWeb/WebGL、WASM/Worker 和本地资源网关，再接定位与后台记录、文件照片、权限、分享和返回。Pura X Max 还应验折叠/展开时地图尺寸、面板与触控位置；这是后续运行验收项，不是已证实的安装失败原因。

给异地朋友分发优先完成合法签名后走华为邀请测试链接，无需朋友连接本机 USB。华为发布证书存在安装渠道限制，不能把构建出的发布包当作任意附件直接安装。[邀请测试](https://developer.huawei.com/consumer/cn/doc/doccenter-dev-faq/faqs-appgallery-22)、[发布证书安装限制](https://developer.huawei.com/consumer/cn/doc/doccenter-dev-faq/faqs-package-structure-65)。

工具链与账号获取的上一轮阻碍见 [原生适配说明](harmonyos-6.1-install.md)；本轮没有重新登录开发者账号、办理签名、搭建工程或创建邀请。APK 卓易通试装仅验证兼容路径，安装成功后仍需单独验证地图、导航、文件和锁屏记录。

## 本轮范围与下一步

仅新增本说明并更新 `CURRENT_STATE.md`、`docs/harmonyos-6.1-install.md` 的安装入口与状态。未改业务代码、包名、版本、签名、用户数据或右侧浏览器；无业务删除、UI实施、重新出包或真机验收。执行发布资产完整性、实际 APK 元数据/签名/对齐检查和文档差异检查，没有重跑与只读调查无关的业务测试。

下一步等待鸿蒙 4.2 的失败原文和实际文件名，才能判定是否需要修包；鸿蒙 6.1 继续按原生适配与签名分发路线推进，当前仍未交付。
