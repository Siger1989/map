# 山兔 0.2.63 测试版：条目输入与 KMZ 航线

标记点的自定义条目使用原生输入框，避免应用内联想弹层与中文输入法冲突；组合输入期间按Escape不会误关编辑窗。用户提供的`L016.kmz`原文件经本机只读检查，实际路线数据在`wpmz/waylines.wpml`，`template.kml`没有点线。此版从WPML按航点编号导入，原文件预览为1条路线、37个航点；导入前仍须确认，预览本身不写入本机数据。

这是无人机航线包结构。**只导入二维航点连线，不导入飞行高度和动作指令，也不表示地面可通行。**通用KML/KMZ及奥维OVKML/OVKMZ的原有解析路径保留。依据：[奥维文件格式说明](https://www.ovital.com/139064-2/)、[DJI Waylines.wpml格式](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/waylines-wpml.html)。0.2.62的剖面/路线互斥修复一并包含。

## 安装与平台

| 平台 | 产物与安装 | 验证状态 |
| --- | --- | --- |
| Android 8.0及以上 | [Shantu-0.2.63-test-standalone.apk](https://github.com/Siger1989/map/releases/download/v0.2.63-test-standalone/Shantu-0.2.63-test-standalone.apk)，可覆盖同签名“山兔测试版” | 类型、逻辑测试、浏览器交互、构建/签名/资源检查通过；真机输入法/微信关联待验 |
| HarmonyOS 6.1 原生 | 暂无 HAP/APP 或邀请链接 | 平台适配与安装验证未完成；Android APK 仅在设备支持时可兼容试装 |

包名`com.guanyun.weather.shantu.preview`，版本`0.2.63-test`、versionCode70，沿用既有`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`签名。源码位于`codex/rollback-ui-0235-20260921`分支，尚未合入main。

## 验证与限制

- TypeScript、617项逻辑测试和网页构建通过。隔离9433浏览器390×857、360×780检查自定义条目输入、组合输入Escape及实际KMZ批量导入预览；显示1条路线/0标记，未确认前本机数据未写入。截图`artifacts/screenshots/20260923-pin-attribute-ime-{390,360}.png`、`20260923-wpml-kmz-preview-{390,360}.png`。未操作用户9423标签。
- Android网页、Java、DEX、APK全新构建；APK v2/v3签名、zipalign及473块随包地形瓦片通过。文件`APK/Shantu-0.2.63-test-standalone.apk`，57,826,396字节，SHA256`e97734eca59572eea5808ac65f54921e0c96040ef7b3bfe09c3838694ed2a517`；同目录`.sha256`可核对。
- 浏览器模拟无法代替真实手机中文输入法、微信“用山兔打开”的文件授权与覆盖安装测试。私人KMZ和坐标未提交到源码或发行附件。
