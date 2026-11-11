# 山兔·优化 0.2.202-test 私人测试版

Android `com.shantu.oldengine`，versionCode 209，最低 Android 8。使用原签名和内置天地图，保留 0.2.201 本机存档。

- 测量工具直接提供“清空”，移除当前整条测量线、端点和投影，撤销可恢复。点选高亮，拖动调整，重选独立操作。
- 导航视角标为“前视／俯视”，等待定位时显示原因，去掉默认方向箭头。
- 当前位置离路时保留到可规划道路的虚线接入，保留道路段和原路线。悬浮窗和锁屏也按实线与虚线分段绘制。

本机 [0.2.202 APK](D:/天气系统/APK/Shantu-0.2.202-oldengine-private.apk) 共 165396624 字节，SHA-256 `e2f4186ca70da0daf066b5f017f1dc34878d2c927370c499060ea853da5a8de7`。应用源码 `f175a74f46972b37cdf256b8e1bda70746576713` 已同步至 `codex/old-engine-tilt-dual-20261105` 并核对远端。

97 项定向测试、TypeScript 检查通过。网页重新构建 11.21 秒，Android 优化构建 4 分 55 秒。APK 通过包名／版本、原签名、CRC、1925 项网页资源逐项比对、39 个种子、原生／网页天地图一致性、8 个原生库与 201 比对和 16 KiB 对齐检查。上一轮的两项隔离原生绘制测试与 390／360 预览证据见[导航与测距记录](navigation-access-camera-20261111.md)。

保存草稿并结束记录后覆盖安装。OPPO 的测量触控、室内接入和锁屏虚线待真机验证。HarmonyOS 原生 HAP 尚无完整可签名构建工程，本次仅交付 Android APK。

本机包已交付。经核对 GitHub 目标为 PRIVATE。202 Release 草稿已创建，首次 APK 上传超时，正在重试。以 `.openai/202-private-release/progress.json` 的发布及回读结果为准。
