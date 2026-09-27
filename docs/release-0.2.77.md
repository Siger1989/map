# 山兔 0.2.77 测试版

本版将记录、路线规划与编辑、剖面及点位编辑、标记编辑、图层窗口的间距和控件高度收紧。沿用 0.2.76 的全部生产按钮、标签和交互逻辑，窗口仍能访问原有设置。常规按钮至少 36px，主要操作至少 44px；图层较长的设置继续在窗口内滚动。

- APK：Shantu-0.2.77-test-standalone.apk
- 版本：0.2.77-test，versionCode 84
- 包名：com.guanyun.weather.shantu.preview；沿用原独立测试版签名
- Android：8.0（API 26）及以上
- 大小：57,859,164 bytes
- SHA256：6226F66E653DA148083529C166B884A4E7B07272509FA36F32E44555E5DBE98A
- 签名证书 SHA256：4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f

验证 PASS：TypeScript、688/688 测试、全新 Android 网页和 APK 构建、v2/v3 签名、zipalign、包内 543 个网页/地形文件与构建暂存文件一致（地形 PNG 按无损解码流与元数据核对）。在手机预览核对了工具、路线规划、图层三个正式窗口的原有控件；未改 JSX 按钮定义。Windows 测试环境需要指向已安装 JDK，并把临时目录设为完整路径，避免桌面网页测试的短路径与真实路径比较不一致。

浏览器检查不能替代 Android 真机触控、性能、GPS 或覆盖安装验收。HarmonyOS 6.1 原生 HAP/APP 尚未生成。请覆盖安装同包名旧测试版，不要先卸载；源码位于 `codex/rollback-ui-0235-20260921`，尚未合入 `main`。

构建源码提交：`98778e15cdaa164717870998adb8e56bc7a51662`。[公开预发布](https://github.com/Siger1989/map/releases/tag/v0.2.77-test-standalone) 的 APK、SHA256 和安装说明三个附件已核对远端大小与 digest，APK 远端 SHA256 与本地一致。
