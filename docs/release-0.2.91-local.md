# 山兔 0.2.91 本地私有 APK

用户明确要求把二维码识别修复打进新版 APK。最终工作区源码已构建为 `APK/Shantu-0.2.91-test-standalone.apk`，版本 `0.2.91-test` / versionCode 98，包名 `com.guanyun.weather.shantu.preview`。源码基线 ec47ec0aa5f23cba6dfa2dd576197a82b6f34efe 加本地未提交改动，分支 codex/rollback-ui-0235-20260921；本轮没有提交、推送或公开发布。

新增普通奥维明文自定义地图二维码解析、Base64 加号兼容、长截图顶部/中部小二维码重试，以及未知/专有格式的明确报错。此前 0.2.90 的 UI 修复保留。详细范围和 390/360 界面证据见 [二维码兼容记录](source-qr-compatibility-20261001.md)。原测试签名、包名与存储标识保持，用户天地图配置及 37 项原私有默认图源核对一致；不自动把整理合集的 231 项全部塞入设备，原图库容量上限仍为 100。

PASS：55/55 二维码、图源、OVMAP 和图片/相机定向逻辑测试，tsc，最终网页与 Android 构建；v2/v3 签名与原证书一致、zipalign、manifest、ZIP CRC；544 项网页资源和 dex 对照一致，496 地形 PNG 像素过滤流及非 IDAT 元数据一致，473 FABDEM 瓦片存在。私有 seed 的 37 项及字节哈希一致，天地图 Key 存在且与本机配置相同（不输出值）。

最终 staging 为 `mobile/.build/apk-20261001-011101`。编译网页在临时本地端口用原 source-01.png 成功解码并进入单项图源预览，浏览器 error 日志为 0，未点击确认保存。证据 `artifacts/screenshots/apk-0.2.91-qr-preview.jpg`；临时页与服务已关闭，原用户预览保留。测试/构建/资源日志在 `.openai/qr-0291-*.log`、`.openai/apk-0291-final-build.log`、`.openai/apk-0291-integrity.json`。

APK 大小 57,887,920 字节，SHA256 `711da7f7b20d0be248768347a720568549fe5712140c02187b01b15618568b92`。校验文件 `APK/Shantu-0.2.91-test-standalone.sha256`。

直接覆盖安装相同包名测试版，无需卸载或清数据。Android 实机扫码、覆盖安装、真实定位/后台记录、远端瓦片服务与坐标准确性尚未验证。合集中的 1 项 985 专有历史图源仍不支持，不能声称所有图源兼容。没有 HarmonyOS 6.1 原生 HAP/APP 产物。
