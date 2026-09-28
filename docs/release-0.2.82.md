# 山兔 0.2.82 测试版

版本 `0.2.82-test`（versionCode `89`），Android 8.0（API 26）及以上。

本版优化路线分叉操作的地图更新，并移除左侧行程点栏、压紧路线卡同时保留六个操作、将剖面线置于地图界面下方。横屏时地图工具贴合右侧安全边界，摇杆移至右下角，收藏夹改为左列表、右地图。路线删除确认框保持一屏显示，无内部滚动条。

单元测试 730/730、TypeScript 检查通过。390px 浏览器中，分叉新增、结束、连续撤销和不保存退出通过；857×390 横屏浏览器中，右侧工具与摇杆位置及间距、收藏左右布局通过。删除确认在857×390/350、390×844、360×780均约179px高，内容无需滚动，原有按钮保留。

包含最终界面修改的 APK 已重新构建，v2/v3原签名及zipalign通过；543个网页文件、496张terrain PNG与新暂存资源一致（含473张FABDEM主地形瓦片），最终文案、CSS及分叉快路径已入包。发布状态以 CURRENT_STATE.md 为准。

[下载 APK](https://github.com/Siger1989/map/releases/download/v0.2.82-test-standalone/Shantu-0.2.82-test-standalone.apk)，沿用包名 `com.guanyun.weather.shantu.preview`，直接覆盖安装同包名旧测试版。

- 大小：57,863,260 bytes
- SHA-256：`c15207b2762d06ff5f7bd472920409568bf57541d8a5ca2ce40bfbce40c6d806`
- 签名证书：`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`

分叉操作的桌面基准、优化范围和设备验证限制见[性能记录](performance-0.2.82.md)。本版不提供 HarmonyOS 原生 HAP/APP；Android APK 在 HarmonyOS 6.1 上的兼容安装也未验证。
