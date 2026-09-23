# 山兔 0.2.68 测试版：原路线直接反向

“导航准备”选中“原始路线”时，点“交换”现在直接交换起终点，并反转已保存道路线路的全部坐标、途经点和分段；缩略图与开始导航按钮随之切换。不会改写收藏中的原路线，也不需要联网规划。原正向转弯提示不会用于返程，返程只提示沿线前进；里程和预计用时沿用原线。若驾车需要核验单行、禁转等通行规则，可点“驾车”另行规划。收藏夹操作菜单进入导航后会关闭，避免盖住“交换”按钮。

## 安装与平台

| 平台 | 产物与安装 | 验证状态 |
| --- | --- | --- |
| Android 8.0及以上 | [Shantu-0.2.68-test-standalone.apk](https://github.com/Siger1989/map/releases/download/v0.2.68-test-standalone/Shantu-0.2.68-test-standalone.apk)，可覆盖同签名“山兔测试版” | 构建、签名、打包网页启动通过；真机覆盖安装及触控待验 |
| HarmonyOS 4.2 等可运行 Android APK 的设备 | 可尝试上方 APK；以设备实际安装结果为准 | 未在华为真机验证 |
| HarmonyOS 6.1 原生 | 暂无 HAP/APP 或邀请链接 | 原生工程、签名与分发尚未完成；Android APK 仅可作为设备支持时的兼容试装 |

包名 `com.guanyun.weather.shantu.preview`，版本 `0.2.68-test`、versionCode75，沿用既有 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f` 签名。源码在 `codex/rollback-ui-0235-20260921` 分支，未合入 main。路线/收藏存储格式与 `shantu.ui-layout.v1` 不变；同系列覆盖安装的数据保留仍需真机验证。

## 校验与限制

- 本地文件 `APK/Shantu-0.2.68-test-standalone.apk`，57,834,588字节，SHA256 `dd1b049e603c8a47c573a5a9a3587f2249f8b3393f5a1d60765a0958160951e3`；同目录有 `.sha256` 文件。
- TypeScript、632项逻辑测试、网页及Android网页/Java/DEX/APK构建、v2/v3签名、473张随包地形瓦片、打包网页启动通过。隔离浏览器390×857和360×780实点“收藏夹→导航→交换”，截图为本机 `artifacts/screenshots/reverse-original-{390,360}.png`，不随源码发布。
- `npm run check:architecture` 仍有六处既有超长模块，未为本次导航修复重构无关代码。
- 反向原线是几何跟随，并非道路规则重新计算；不保证单行或禁转可通行。真机导航、位置跟随、覆盖安装尚未验证。HarmonyOS 6.1 原生包未交付。
