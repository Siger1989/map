# 山兔 0.2.69 测试版：标记即时保存、断点定位与自由画线

地点标记编辑的顶部按钮改为“分享”，名称、备注、坐标、颜色、图案及自定义条目修改后即时保存。分享内容包含点信息及自定义条目；照片附件不随文本分享。保存路线导航若提示线段断开，地图会放大到最近的实际缺口，用红色虚线、两端标志和距离标出位置，关闭提示即可清除。路线编辑默认自由画线，固定显示自由画线、道路吸附、节点吸附和线条样式，展开样式时主操作仍在固定位置。

## 安装与平台

| 平台 | 安装方式 | 验证状态 |
| --- | --- | --- |
| Android 8.0及以上 | 下载 [Shantu-0.2.69-test-standalone.apk](https://github.com/Siger1989/map/releases/download/v0.2.69-test-standalone/Shantu-0.2.69-test-standalone.apk)，可尝试覆盖同签名“山兔测试版” | 构建、签名和打包网页启动通过；真机覆盖安装和触控待验 |
| 支持安装Android APK的HarmonyOS设备 | 可尝试上方Android APK，以设备实际兼容情况为准 | 未在华为真机验证 |
| HarmonyOS 6.1 原生 | 暂无HAP/APP或邀请链接 | 原生工程、签名和分发尚未完成；上方APK不是原生鸿蒙包 |

包名 `com.guanyun.weather.shantu.preview`，版本 `0.2.69-test`、versionCode76，沿用既有签名证书 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`。源码在 `codex/rollback-ui-0235-20260921` 分支，未合入 `main`。标记/路线存储格式、照片文件和 `shantu.ui-layout.v1` 未改；同系列覆盖安装的数据保留仍待真机验证。

## 校验与限制

- 本地文件 `APK/Shantu-0.2.69-test-standalone.apk`，57,834,588字节，SHA256 `72e21c1d3ad88ded583281e00fa186e541b89040eaaa80a51f54809472201b12`；同目录有 `.sha256` 校验文件。
- TypeScript、638项逻辑测试、网页及Android网页/Java/DEX/APK构建、v2/v3签名、zipalign、473张随包地形瓦片、打包网页启动通过。隔离浏览器390×857和360×780验证标记保存/分享、断点定位/清理和编辑工具栏布局；真机中文输入法、地图渲染、拖线手感、导航及覆盖安装待验。
- `npm run check:architecture` 仍报六处既有超长模块，本次未为出包改动无关模块。
