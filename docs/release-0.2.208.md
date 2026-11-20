# 山兔·优化 0.2.208 私人测试包

Android 目标版本 `0.2.208-test`，构建号 215，包名 `com.shantu.oldengine`，最低 Android 8.0。

- 工具中的日月观景可查看观察点、日期、太阳和月亮的方向与山脊升落时间。Android 实景使用后置摄像头与设备姿态。支持的手机可用气压计辅助估计相对海拔。
- 标记详情可在标记位置查看日月和山脊时间轴。保存轨迹和规划路线可进入第一人称行程模拟并保存录像。
- 地图和观景保留已有私人内置天地图。日月计算使用 Astronomy Engine，地点时区索引用 PhotoStructure 元件，索引上游为Timezone Boundary Builder。时区数据源署名为 © OpenStreetMap contributors，数据采用 ODbL。详见 [Astronomy Engine](https://github.com/cosinekitty/astronomy) 和 [地点时区索引](https://github.com/photostructure/tz-lookup)、[时区边界数据许可](https://github.com/evansiroky/timezone-boundary-builder#licenses)。

安装前先结束记录并保存草稿。按照 Android 安装提示覆盖现有同签名的「山兔·优化」。

HarmonyOS 6.1 原生 HAP 本次未交付。本机和仓库均缺少能独立构建及签名的原生鸿蒙工程，原生发布需要合法签名和官方邀请测试渠道。卓易通兼容试装仍需目标设备实测。详见 [华为发布签名说明](https://developer.huawei.com/consumer/cn/doc/harmonyos-guides/ide-publish-app/) 和 [华为测试渠道说明](https://developer.huawei.com/consumer/cn/doc/App/agc-help-public-test-overview-0000002259136294/)。

## 构建及安装包检查

私人构建及证据核验进行中。功能浏览器证据见 [日月观景与行程模拟](sky-journey-20261120.md)。后摄姿态、气压计、手机录像保存和实际山景仍需真机验收。
