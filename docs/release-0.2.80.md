# 山兔 0.2.80 测试版

本版减少地图菜单与路线编辑的重复工作：菜单开关避免同步全部路线、标记和剖面；选点局部更新，单条保存路线几何变化复用背景；空备注不遍历坐标，收藏数据校验使用有界缓存。收藏行内距与显隐滑选即时反馈同步修复。详见[性能证据及限制](performance-0.2.80.md)。

- APK：`Shantu-0.2.80-test-standalone.apk`
- 版本：0.2.80-test，versionCode 87
- 包名：`com.guanyun.weather.shantu.preview`；沿用原独立测试版签名
- Android：8.0（API 26）及以上
- APK 大小：57,859,164 bytes
- APK SHA256：`b1113ade792e05c6599525069132bde26b483bfd41204dd844be76ead403fc4d`
- 签名证书 SHA256：`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`

验证 PASS：全量 707/707 测试、TypeScript `tsc --noEmit`、独立测试版 Android 全新构建、APK v2/v3 签名、zipalign；APK 内 543 个网页文件逐项匹配本次构建暂存，496 张 PNG（含 473 张 FABDEM 主地形瓦片）像素与元数据一致。包名 `com.guanyun.weather.shantu.preview`、versionCode 87 与原独立测试证书一致。

浏览器最终菜单同步计数、选点、分叉新增与撤销、退出不保存验证PASS，收藏390px/360px行内距与显隐滑选验证PASS。OPPO Find X8 Ultra 等 Android 真机上的菜单响应、收藏触控、路线操作、定位、渲染、性能与覆盖安装尚未验收。天地图地名为栅格注记，模糊问题完成排查，尚未改善文字清晰度。HarmonyOS 6.1 原生 HAP/APP 尚未生成。
