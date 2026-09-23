# 山兔 0.2.58 测试版：中心标记与隐藏 UI

地图中心准星和标记按钮重新显示。右侧按钮顺序为“方向 → 标记 → 跟随”；在隐藏 UI 模式下仍能看见准星、点击标记。点击后显示添加标记面板，供选择图案和编辑信息。剖面与路线窗口不再额外隐藏这两个控件。路线几何、图源、高程计算、标记数据和用户保存内容没有改动。

## 安装与平台

| 平台 | 产物与安装 | 验证状态 |
| --- | --- | --- |
| Android 8.0及以上 | [Shantu-0.2.58-test-standalone.apk](https://github.com/Siger1989/map/releases/download/v0.2.58-test-standalone/Shantu-0.2.58-test-standalone.apk)，可覆盖同签名“山兔测试版” | 构建、签名、资源与浏览器检查通过；真机安装和触控待验 |
| HarmonyOS 6.1原生 | 暂无HAP/APP或邀请链接 | 原生平台适配与安装验证未完成；Android APK不能当作原生鸿蒙包 |

包名`com.guanyun.weather.shantu.preview`，版本`0.2.58-test`、versionCode 65，保持现有`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`签名。覆盖安装同系列版本，不需卸载，不迁移或清空轨迹、照片、布局、收藏等本机数据。此版本在`codex/rollback-ui-0235-20260921`分支，未合入main。

## 验证

- TypeScript、614项逻辑测试通过；Android网页、Java、DEX、APK从当前源码新构建。打包网页在独立Chromium中完成主页启动。
- 390×857及360×780浏览器检查控件的显示、尺寸和点击命中；隐藏UI时中心准星与三个右侧按钮可用，点标记后打开添加面板。剖面和路线编辑的控件位置已检查。没有用这些浏览器结果代替真机触控验收。
- APK签名v2/v3有效，沿用既有证书；ZIP 551项CRC、473块地形瓦片和包内版本/控件资源通过核对。没有把私有文件、日志或签名密钥打入安装包。

本地APK：`APK/Shantu-0.2.58-test-standalone.apk`，57,818,204字节，SHA256：`da2b7d0871afcac809a6693c52a330241cefecaa4192ffa2d3e0667317d35ca5`。[SHA256校验文件](https://github.com/Siger1989/map/releases/download/v0.2.58-test-standalone/Shantu-0.2.58-test-standalone.sha256)。持续缩放的真机卡顿、部分地形异常、GPS/传感器、微信文件关联和覆盖安装仍未在手机上复测；本轮地图控件修改不声称解决这些问题。
