# 山兔 0.2.61 测试版：打开地图自动取得大致位置

已授权定位的 Android 测试版打开地图后，会短时同时请求系统网络定位和 GPS。网络位置先到时显示大致位置、按误差把地图带到附近；之后 GPS 可更新位置点。用户已开始浏览地图或进入编辑/导航时，不会被迟到的定位拉走。首次未授权不会自动弹权限，点“跟随”仍可请求授权；普通网页版不会自动弹浏览器定位权限。

启动观察在可靠 GPS 返回或 20 秒后结束，主动跟随不受这个计时器影响。系统网络定位可能利用基站和 Wi-Fi，应用不能保证只用基站或保证某一设备必定返回网络位置。实现决策与官方依据见[启动定位施工说明](startup-network-position.md)。收藏夹视角恢复、双击跟随归位等 0.2.60 功能继续保留；轨迹、照片、收藏、布局及地图图源没有迁移。

## 安装与平台

| 平台 | 产物与安装 | 验证状态 |
| --- | --- | --- |
| Android 8.0及以上 | [Shantu-0.2.61-test-standalone.apk](https://github.com/Siger1989/map/releases/download/v0.2.61-test-standalone/Shantu-0.2.61-test-standalone.apk)，可覆盖同签名“山兔测试版” | 类型、逻辑测试、浏览器模拟和构建/签名/资源检查通过；真机定位与覆盖安装待验 |
| HarmonyOS 6.1 原生 | 暂无 HAP/APP 或邀请链接 | 平台适配和安装验证未完成；Android APK 仅可在设备支持时兼容试装 |

包名`com.guanyun.weather.shantu.preview`，版本`0.2.61-test`、versionCode 68，沿用既有 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f` 签名。源码位于`codex/rollback-ui-0235-20260921`分支，尚未合入 main。

## 验证与限制

- TypeScript 与逻辑测试通过；Android 网页、Java、DEX、APK 全新构建。隔离 9433 浏览器模拟 390×857：已授权网络粗位置先聚焦、GPS 后更新；未授权无自动请求，手动跟随可调用定位；用户先滚轮缩放则不自动跳视角。无页面异常。截图`artifacts/screenshots/20260923-startup-network-location-390.png`，未操作用户 9423 预览标签。
- APK v2/v3 签名、zipalign 及 473 块随包地形瓦片通过。文件`APK/Shantu-0.2.61-test-standalone.apk`，57,826,396 字节，SHA256 `5bca95b201f50c2a812dfbe685de5bc9ddaff03adfde3d5e42e6d6c3a5a2668e`；同目录`.sha256`可核对。
- 模拟权限和坐标不等于 Android 真机的基站/Wi-Fi 返回或 GPS 精度。真实设备上粗略权限、定位开关、室内首次定位时间和电量影响仍待验；不宣称 HarmonyOS 原生包已交付。
- [测试Release](https://github.com/Siger1989/map/releases/tag/v0.2.61-test-standalone)已公开；标签指向本版APK源码`d620091b0eec7d03122869ddf5fc98ed037a1b65`。GitHub APK和校验文件均为uploaded，APK线上大小和SHA256 digest与本地一致；未进行真机安装验收。
