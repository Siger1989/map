# 0.2.104-test / 双图蓝线选择、路线改名（本机交付）

2026-10-03 用户明确要求“打包apk并且发我”。本轮将已在390×857与360×780验证的预览修复交付为新APK：双图规划路线操作卡、蓝线重叠命中优先、编辑标题直接改名及撤销保存、44px上下换位键靠右。功能验证见 `dual-route-selection-20261003.md`；55项定向测试与tsc已通过，本轮不增加其它业务逻辑。

- APK：`APK/Shantu-0.2.104-test-standalone.apk`
- 包名：`com.guanyun.weather.shantu.preview`
- 版本：`0.2.104-test`，versionCode `111`；同时更新 `config/product.ts` 和 `mobile/android/AndroidManifest.xml`。
- 大小：66,089,776字节。
- SHA256：`686a9bc38bdea2509f493bc563f3be13d20558da3a1222c246acad0552f54c12`。
- 证书SHA256：`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`；原签名，v2/v3、zipalign通过。
- 最终stage：`mobile/.build/apk-20261003-075923`。完整性核验通过：1918 ZIP entries、1910 assets与该stage对应、496地形PNG像素/元数据、38私有图源、1365概览瓦片、CRC。
- 预览、production与包内已有Key一致性均为true，仅记录布尔值，未输出Key。配置与上一版兼容。
- 构建日志 `.openai/build-0.2.104-final.log`，独立报告 `.openai/package-02104-integrity.json`、`.openai/package-02104-config-check.json`，底层核验日志 `.openai/02104-*.log`。

构建命令：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -SdkRoot D:\GodotAndroid\android-sdk -JdkRoot D:\GodotAndroid\jdk-17 -StandaloneTest -DefaultMapSources .openai/default-map-sources-private.json`。

首次075704构建发现Android清单未同步版本，误命名旧103，已拒绝交付并保留为 `.openai/rejected-075704-version-mismatch.apk`。原103使用原003241/aligned.apk和原签名恢复，恢复后的SHA与原 `55f4c2c5cfb82674eef621d34e8741e6494c7a6f2d43a15af13a4c8b31bdd0eb` 完全一致。修正清单后完整重建为上述075923 stage，不复用误版本包。

临时下载：[Shantu-0.2.104-test-standalone.apk](https://proc-calendar-boxing-reproduced.trycloudflare.com/541fa3f1cc90af4214fc499e8221f198b1f5/Shantu-0.2.104-test-standalone.apk)。北京时间2026-10-03 10:00:37到期，电脑须在线。仅开放该随机路径APK，两小时自动结束；完整外网下载的字节数/SHA与本机一致，Range206通过，报告 `.openai/apk-02104-public-verified.json`。本地server PID28220、wrapper42168、tunnel10120；未改变系统代理。

工作目录D:\天气地图，分支codex/rollback-ui-0235-20260921；保留现有未提交修改，未提交/推送或发布含Key的公共Release。真实Android手指操作、键盘、安全区和覆盖安装仍待用户试机；HarmonyOS6.1原生包未交付。

2026-10-03 10:02用户要求重发，以上8:00下载地址已到期。新链接：[0.2.104 APK](https://cakes-career-susan-archived.trycloudflare.com/d04b7129fb1f7a3a0278811660722a392908/Shantu-0.2.104-test-standalone.apk)，北京时间12:01:55到期。复用同一APK并重新完成外网完整下载SHA/字节、Range206核验，报告 `.openai/apk-02104-r2-public-verified.json`；server20320、wrapper19312、tunnel6140均按新到期时间自动结束，无源码修改/重打包。
