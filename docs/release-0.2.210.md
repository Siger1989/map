# 山兔·优化 0.2.210 私人 Android 更新

本次把第三人称行程模拟从预览带入 Android。打开已保存轨迹或规划路线的「行程模拟」，设置出发、到达时间，点「播放」或「录制整段」。

- 镜头默认从运动箭头后方约 90 米跟随，按实际山脊和地表高度调整俯仰与距离。箭头表示当前模拟位置和行进方向，青色为已走路线，金色为前方路线。
- 天地图卫星影像优先细化箭头附近和前方路段。拖动行程进度时，路线位置、时间与日月方位一起更新。录像使用同一镜头和实际绘制的行程帧。
- 青城山山地和公路示例各从应用的网页预览导出 15 秒并解码 181 帧。公路录像的天空占可视画面 27.3%–28.4%。证据见[第三人称行程模拟复测](sky-journey-20261120.md#第三人称行程模拟复测)。

Android 安装身份为 `com.shantu.oldengine`，版本 `0.2.210-test`，构建号 217，最低 Android 8.0。先保存正在记录的行程，再覆盖安装。HarmonyOS 6.1 原生 HAP 本次未交付。

## 构建与交付

应用源码见[隔离分支提交 3ddb54d](https://github.com/Siger1989/map/commit/3ddb54d52383f75f6d2b3a9571d359a7422a5cf2)。TypeScript、26 个定向测试、终版 Web 构建及其 Android 资源源站冷启动检查通过。生产构建中的收藏入口、路线详情、进入行程、播放、暂停、时间轴拖动和退出已在浏览器验证。

本机交付件为 `D:/天气系统/APK/Shantu-0.2.210-oldengine-private.apk`，共 165592967 字节，SHA-256 为 `00781c4a9bb5bca9a5d064b343b717023a40a48e380687eb28b47ebc09e17c38`。同目录有校验文件，209 历史安装包已保留。

已发布至[私人 Release](https://github.com/Siger1989/shantu-private-delivery/releases/tag/v0.2.210-private)，可用授权账户[下载 APK](https://github.com/Siger1989/shantu-private-delivery/releases/download/v0.2.210-private/Shantu-0.2.210-oldengine-private.apk)。已核对服务端资产大小、散列，并完整下载回读确认与本机安装包相同。

签名 APK 使用原证书。1942 份 Web 资源与本轮构建逐字节一致；原生和 Web 的天地图配置、39 项内置图源、右侧私人预览以及 35 项已保存材质参数均已核对。由 APK 提取的资源在 Android appassets 源站成功启动并启用原生地图适配层。四种 ABI 的八个原生库与 209 逐字节相同，CRC、ZIP/ELF 16 KiB 对齐检查通过。

Android 15 隔离模拟器从 209 覆盖升级至 210，保留原首次安装时间。从设备回读 base.apk 的 SHA-256 与交付件相同。强停后重新启动，原生地球卫星影像和首页按钮均可见。安装与画面证据在 `artifacts/screenshots/android-journey-210/`。
