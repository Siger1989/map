# 0.2.123 本机私有APK（2026-10-13）

用户在快速预览之后明确要求“给我APK”。本轮已用最终源码全新构建 `0.2.123-test / versionCode130`，沿用独立山兔包名 `com.guanyun.weather.shantu.preview`、原4a94签名及存储格式。

## 本轮内容

- 绿色选点根据当前地图中心、缩放及视口范围判断远近；远处隐藏、靠近恢复，保留选中坐标。
- 普通标记、选点和照片服从山体遮挡，隐藏后不能误点；明确的地下模型说明保留原有透视语义。
- 3D拖动时复用标记布局、重叠查询、同帧几何投影及地形回退缩放决策；满足兼容条件时共享Blob路线遮罩，复杂transform或超预算时完整回退。
- 修正独立worktree位于`.openai`下时预览不更新源码的问题。

详细实现、两尺寸实际交互和性能证据见[3D拖动接续记录](terrain-drag-20261013.md)。未改原生定位/相机/后台、用户存档或地图资源；PC EXE继续暂停。

## 安装文件与核验

- 版本文件：原工程 `APK/Shantu-0.2.123-test-standalone-private.apk`。
- 固定入口：原工程 `APK/山兔手机.apk`，对应SHA256文件已更新；0.2.122版本包保留。
- 大小：70,248,633字节。
- SHA256：`1f955ccc8d14c51881bbf735522374e9cfe57e3fac37119fc0bc12e1e62b9342`。
- 原签名SHA256：`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`；v2/v3、zipalign、aapt版本/包名核验PASS。
- ZIP全1934项CRC PASS；1926项打包网页资源与fresh staging一致，496张地形PNG像素流一致，其中基础地形473张。没有.env、签名密钥或本机日志。
- 已有天地图Key存在且与9174预览配置相同，APK内嵌确认PASS；39图源种子与原输入逐字节一致。
- APK的classes.dex与地图worker和122逐字节一致。
- 本轮61项定向、tsc通过，版本提升后fresh网页/Android构建通过。实际打包网页390×857启动、地图画布、选点规则、无横向溢出PASS；“内置”天地图影像实际可见/选中，28次影像响应成功。原生GPS或成功回调未模拟。

本机证据：`.openai/release-123/`，包括构建日志、integrity.json、bundle-check.json、packaged-smoke.json、packaged-tianditu.json和local-delivery.json；截图同目录。原UI两尺寸证据沿用本轮已完成的定向验收，不重复扩大为全项目通过。

## 平台、安装与同步范围

Android 8.0+、可用WebGL2。把APK传到手机后直接覆盖安装同签名山兔测试版，保留应用数据，不先卸载。真机安装、实际拖动性能、GPS、相机、后台和分享仍未验收；电脑合成压力场景改善不等于手机流畅保证。

HarmonyOS 6.1原生HAP/APP仍未交付；缺少已验证平台工程、工具链和签名/分发条件。此APK不称为原生鸿蒙包，当前状态见[鸿蒙交付记录](harmonyos-6.1-install.md)。

活动源码：`codex/place-address-search-20261011`，构建基础HEAD `b38f83cbf6d1335f8dc1eea1e57294afbcc81bd4`加本轮最终源码与123版本差异；APK在提交前构建，不把基础HEAD当作最终源码提交。

源码/测试/文档同步目标为 `Siger1989/map` 的上述分支，未合main；最终远端核对记录留在本机`.openai/release-123/source-sync.json`。含Key APK仅本机自用交付，没有公开Release或云端上传。
