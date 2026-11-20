# 山兔·优化 0.2.208 私人测试包

Android 目标版本 `0.2.208-test`，构建号 215，包名 `com.shantu.oldengine`，最低 Android 8.0。

- 工具中的日月观景可查看观察点、日期、太阳和月亮的方向与山脊升落时间。Android 实景使用后置摄像头与设备姿态。支持的手机可用气压计辅助估计相对海拔。
- 标记详情可在标记位置查看日月和山脊时间轴。保存轨迹和规划路线可进入第一人称行程模拟并保存录像。
- 地图和观景保留已有私人内置天地图。日月计算使用 Astronomy Engine，地点时区索引用 PhotoStructure 元件，索引上游为Timezone Boundary Builder。时区数据源署名为 © OpenStreetMap contributors，数据采用 ODbL。详见 [Astronomy Engine](https://github.com/cosinekitty/astronomy) 和 [地点时区索引](https://github.com/photostructure/tz-lookup)、[时区边界数据许可](https://github.com/evansiroky/timezone-boundary-builder#licenses)。

安装前先结束记录并保存草稿。按照 Android 安装提示覆盖现有同签名的「山兔·优化」。

HarmonyOS 6.1 原生 HAP 本次未交付。本机和仓库均缺少能独立构建及签名的原生鸿蒙工程，原生发布需要合法签名和官方邀请测试渠道。卓易通兼容试装仍需目标设备实测。详见 [华为发布签名说明](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-publish-app/) 和 [华为测试渠道说明](https://developer.huawei.com/consumer/cn/doc/App/agc-help-public-test-overview-0000002259136294/)。

## 构建及安装包检查

- APK `D:/天气系统/APK/Shantu-0.2.208-oldengine-private.apk`，165589469 字节。SHA-256 `2f98c508be39e1348510722d06fc950515c221a1b6ce09f2b4dd0bab0f2c05e3`，同目录有校验文件。
- 最终 Web 与 Android 构建通过。逐字节核验 1942 份 Web 资产，以及包名、版本、沿用签名、私有天地图 Web/原生配置一致、39 项内置图源种子和 35 项个人材质参数。已确认双图视图放行规则、相机气压和录像桥进入包，开发预览页不随包分发。
- CAD 源文件和构建配置与 207 相同。最终签名包复用 207 已验的四个 CAD 库，连同四个 SQLite 库，8 个库在四种 ABI 下均与 207 逐字节一致，APK 原生库直存、ZIP 16 KiB 对齐、64 位 ELF 16 KiB 对齐、条目唯一性及 CRC 核验通过。207 安装包的校验值未变。
- 功能源码 [2a7bab7](https://github.com/Siger1989/map/commit/2a7bab7080389868f1167d2a6bbb20621b5cf920) 已同步到隔离分支。33 项定向测试、TypeScript 检查及主图/双图标记入口定向验证通过。见 [浏览器验证记录](sky-journey-20261120.md)。
- 本机已交付。后摄姿态、气压计、手机录像保存和实际山景仍需真机验收。已在专用私人仓库发布。APK 与校验清单的服务端大小和 SHA-256 均与本机一致，完整 APK 下载回读通过。发布前后仓库均为 PRIVATE，207 草稿原样保留。有效账号可使用 [208 私人 Release](https://github.com/Siger1989/shantu-private-delivery/releases/tag/v0.2.208-private) 或 [下载 APK](https://github.com/Siger1989/shantu-private-delivery/releases/download/v0.2.208-private/Shantu-0.2.208-oldengine-private.apk)。
