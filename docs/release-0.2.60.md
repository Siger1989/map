# 山兔 0.2.60 测试版：收藏夹视角与跟随归位

打开收藏夹时仍可临时总览收藏对象；普通关闭后，地图恢复打开前的中心、缩放、俯仰和方向。若从收藏夹主动打开或定位某个项目，则保留该项目的聚焦视角。地图尺寸变化时不再用已关闭的收藏预览重新拉远视角。

右侧“跟随”单击继续开关跟随；鼠标双击或手机连续双点则回到可靠当前位置，缩放到适合浏览的范围并朝北。定位暂未返回时等待可靠坐标；编辑或选点期间不强制归位。地图图源、收藏内容、用户存储格式和既有路线数据没有改动。

## 安装与平台

| 平台 | 产物与安装 | 验证状态 |
| --- | --- | --- |
| Android 8.0及以上 | [Shantu-0.2.60-test-standalone.apk](https://github.com/Siger1989/map/releases/download/v0.2.60-test-standalone/Shantu-0.2.60-test-standalone.apk)，可覆盖同签名“山兔测试版” | 构建、签名、资源、逻辑测试及浏览器交互通过；真机安装和触控待验 |
| HarmonyOS 6.1原生 | 暂无HAP/APP或邀请链接 | 原生平台适配和安装验证未完成；Android APK仅供设备支持时兼容试装 |

包名`com.guanyun.weather.shantu.preview`，版本`0.2.60-test`、versionCode 67，沿用既有`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`签名。覆盖安装同系列版本无需卸载，不迁移或清空轨迹、照片、布局和收藏。源码在`codex/rollback-ui-0235-20260921`分支，未合入main。

## 验证与限制

- TypeScript 和614项逻辑测试通过；Android网页、Java、DEX和APK从最终源码构建。隔离9433浏览器以390×857尺寸实点：收藏夹内临时总览为4.21级，关闭恢复进入前14级、42°俯仰与24°方向；双击与手机双点均回到定位点、约15–16级、朝北；单击仍开关跟随，浏览器无页面错误。截图`artifacts/screenshots/20260923-favorites-follow-reset-390.png`。
- APK v2/v3签名及对齐通过，473块随包地形瓦片齐全。文件`APK/Shantu-0.2.60-test-standalone.apk`，57,826,396字节，SHA256 `40fbeca7c6ba8ef5f491f7a2ae39c3de31be9d4eed6c34686e8df806c5d21029`；同目录`.sha256`文件可核对。
- 浏览器操作不能代替Android真机双点手感、GPS、覆盖安装或持续缩放性能验收。奥维KMZ个案、天地图自动浏览缓存、UTM、Windows EXE和HarmonyOS原生安装包不在本版范围。
