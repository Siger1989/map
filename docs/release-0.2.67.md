# 山兔 0.2.67 测试版：路线操作与收藏夹显隐

路线规划始终标出起点、终点，并高亮当前要输入或在地图选取的一项；选完起点自动提示终点。当前规划路线可以在地图上点开操作卡。收藏夹中点击导航路线会恢复路线摘要，地图上显示的收藏路线也可以点开，继续导航、调整、分享或取消。

收藏夹文件夹名称行支持左滑隐藏全部、右滑显示全部；同一行提供整组显隐按钮和状态。“隐藏”分类集中查看被隐藏的对象。整组操作复用原有显隐字段，不改变坐标、照片、轨迹或收藏备份格式。

## 安装与平台

| 平台 | 产物与安装 | 验证状态 |
| --- | --- | --- |
| Android 8.0及以上 | [Shantu-0.2.67-test-standalone.apk](https://github.com/Siger1989/map/releases/download/v0.2.67-test-standalone/Shantu-0.2.67-test-standalone.apk)，可覆盖同签名“山兔测试版” | 构建、签名、打包网页启动通过；真机覆盖安装及触控待验 |
| HarmonyOS 4.2 等可运行 Android APK 的设备 | 可尝试上方 APK；是否支持以设备实际安装结果为准 | 未在华为真机验证 |
| HarmonyOS 6.1 原生 | 暂无 HAP/APP 或邀请链接 | 原生工程、签名与分发尚未完成；Android APK 仅可作为设备支持时的兼容试装 |

包名 `com.guanyun.weather.shantu.preview`，版本 `0.2.67-test`、versionCode74，沿用既有 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f` 签名。源码在 `codex/rollback-ui-0235-20260921` 分支，尚未合入 main。存储键与 `shantu.ui-layout.v1` 不变；同系列覆盖安装的实际数据保留仍需真机验证。

## 校验与限制

- 本地文件 `APK/Shantu-0.2.67-test-standalone.apk`，57,834,588字节，SHA256 `8409e4ad2632e3c69b7ae8b09c9a832a7dc1bf21383dc0090a3f3be79abab68d`；同目录提供 `.sha256` 文件。
- TypeScript、629项逻辑测试、网页构建、Android网页/Java/DEX/APK构建、签名、zipalign、473张随包地形瓦片与打包网页启动检查通过。390px手机预览已实点验证路线步骤提示；打包网页的启动截图为本机 `artifacts/screenshots/20260924-route-0.2.67-packaged-390.png`，不随源码发布。
- `npm run check:architecture` 仍因六个既有超长模块未通过；本版没有顺手重构这些模块。收藏路线点线、文件夹左右滑、覆盖安装与真机定位/输入法尚未在手机上验收。网页预览与自动测试不能代替真机结果。
