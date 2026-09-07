# 山兔 0.2.5 独立测试版

[下载 APK](https://github.com/Siger1989/map/releases/download/v0.2.5-test-standalone/Shantu-0.2.5-test-standalone.apk) · [Release、SHA-256 与安装说明](https://github.com/Siger1989/map/releases/tag/v0.2.5-test-standalone)

## 安装与数据

安装后名称为“山兔测试版”，包名 `com.guanyun.weather.shantu.preview`，版本 `0.2.5-test` / code 12。由于当前电脑没有旧 0.1.4–0.2.4 测试版的私有签名，按用户要求使用本机测试签名制作独立应用。可与旧观云/观云测试版并存，不需要卸载旧应用；数据各自独立，不会自动迁移。旧版已有的 GPX/JSON 导出内容可按支持范围手动导入；照片预览等并不包含在普通轨迹备份里，应保留旧应用。

手机需要 Android 8.0+、OpenGL ES 3 / WebGL 2、Android System WebView 或 Chrome 120+。下载 APK 后用系统文件管理器打开，根据系统提示允许该来源安装。

## 本次包内更新

- 矩形剖面持续保存、显隐/删除，比例尺与宽高档位；交线彩色测点可拖动、备注并随图片导出。
- 共用对象 Gizmo，标记/模型编辑；路线预览镜头拖动修复、公里读数与 GPS 进度显示。
- 路线收藏分组、导航与接回原路线、独立图层窗口、地图图源导入。
- 照片全屏查看/标注/分享、海拔与拍摄天气；实走来源/时间保护、文件夹导入和记录精度设置。
- 山兔全球入口，以及已核查的鄂陵湖附近异常地形修复。

详见各模块文档与 `CURRENT_STATE.md`。这些功能来自此前已同步源码，本轮只改安卓构建及发行流程。

## 无损压缩与校验

最终已签名 APK 为 **55,019,071 字节（55.02 MB / 52.47 MiB）**。SHA-256：

```text
4cd978cebdc6062af14e9a8537318b5a76ae4fc1f6bde1a15d28ee4dfdf50525
```

同一次构建、签名和对齐之前，APK 从 55,214,513 压到 54,966,979 字节，减少 247,534 字节（约 0.45%）；随后对齐和签名增加必要开销。地形原本已压缩，因此未追求大幅减小体积。保留全部 473 张 FABDEM 与 23 张修复瓦片，没有量化海拔、降分辨率或删除离线资源。

`scripts/optimize-apk.mjs` 仅在打包时合并/重压缩 PNG IDAT，校验 CRC 与解压后的过滤字节完全一致；PNG 之外的资源保持原内容。ZIP 中 PNG 和 Android 资源表保持不压缩，其他条目压缩；之后执行 zipalign 和签名。依赖现有 Node/fflate，无新增运行依赖。原始 `public/` 和 `mobile/dist/` 文件不改。

本轮通过 TypeScript、216/216 逻辑测试、网页与完整安卓构建、v2/v3 签名、最终对齐与 Manifest 检查。独立使用 Pillow 对比 APK 和构建目录的全部 496 张 PNG，逐像素与元数据相同；其余 29 项资源 SHA-256 一致，总计 525 项。原包名构建遇本机不匹配密钥仍按预期拒绝。

没有连接 Android 真机；尚未验收实际安装、WebView 渲染、触控、GPS/锁屏记录、耗电及相机权限。数据许可和覆盖限制继续适用，测试版不等于可直接商业发行。

## 重建与模块边界

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -StandaloneTest -SdkRoot 'C:\Android\Sdk' -JdkRoot 'C:\Java\jdk-17' -SigningKey 'C:\Private\guanyun-test.jks'
```

`-StandaloneTest` 使用 `config/android-standalone-signing.json` 的公开包名、标签及证书指纹，临时生成 Manifest 并同步照片分享 provider。Java 类名、业务代码、原 Manifest、`config/android-signing.json` 与存储键保持原样。`-SkipCompression` 可对照未压缩流程；`-UnsignedOnly` 仍只能生成不可安装的检查包。

独立版证书 SHA-256 为 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`。以后覆盖更新这一路独立版必须保留对应私有密钥，通过可信私密方式跨电脑迁移；密钥不上传 GitHub。默认不加 `-StandaloneTest` 仍为原测试包名及原签名校验，不能用当前密钥覆盖旧版。

本轮新增压缩脚本、对应测试、独立签名公开配置与本说明；修改构建脚本及 README/跨设备/状态说明。没有删除业务功能、文件或数据资源；地图、导航、剖面、照片、GPS 算法不改。回滚这些构建和说明文件即可恢复原构建流程，已安装的应用和数据不受 Git 回滚影响。
