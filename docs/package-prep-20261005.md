# 0.2.105 最终核验与交付补记（2026-10-05）

最终 APK `APK/Shantu-0.2.105-test-standalone.apk` 已由主代理构建及核验：66,097,968 字节，SHA-256 `d7688de0c6cb5a33b234f06c897c60858a19da20cb99f9aa386a18b28d92e851`，包名 `com.guanyun.weather.shantu.preview`，版本 `0.2.105-test` / code112。ZIP CRC、zipalign、原签名证书兼容均 PASS。stage 与 APK 共 1,910 个 assets，其中 1,414 项逐字节一致，496 张 terrain PNG 的 CRC、非 IDAT 元数据和解压像素一致；另核对 38 个私有种子、1,365 张概览瓦片及 Key 一致性布尔值。

84 项定向测试、tsc、网页构建和 APK 构建 PASS。1539 个构建源码文件的前后 SHA 快照一致。主代理在 9174 源码预览复跑 route/cloud/recorded/marker/position/search：390/360 视口通过（recorded 主复跑为390，代理另做两尺寸检查）。最终 APK stage 的390/360版本/主页无溢出、标记隐藏后编辑器保留、双图2-pane与零pageerror smoke PASS。route/cloud 双图最终 QA 本轮完成，未改对应产品逻辑。构建后对 `modules/mapSources/sharedTileFetch.ts` 与 `modules/weather/satelliteCloud.ts` 仅清理 EOF 多余空行，属于纯格式变更，无逻辑影响，不因此重建。

短时私有下载整包和 Range206 核验 PASS，长度及 SHA 与本地包相符；证据 `.openai/apk-02105-public-verified.json`，截至北京时间 2026-10-05 14:06:29 有效，电脑需在线。随机令牌链接未写入文档。真机安装、触控、GPS、朝向、后台行为未验，HarmonyOS 原生包未交付；含私有图源配置的 APK 不得公开发布。分支 `codex/rollback-ui-0235-20260921`，构建前 HEAD `ec47ec0aa5f23cba6dfa2dd576197a82b6f34efe`；提交/推送/main 状态由主代理核对。

以下内容保留构建前的准备记录，最终结果以上述核验补记及 `docs/release-0.2.105-local.md` 为准。

# 0.2.105 打包准备（2026-10-05）

本次预定产物为 `APK/Shantu-0.2.105-test-standalone.apk`，包名 `com.guanyun.weather.shantu.preview`，版本码 `112`。`config/product.ts` 与 `mobile/android/AndroidManifest.xml` 已同步为 `0.2.105-test` / `112`；测试 `node --test tests/drawing-section-workflow.test.mjs` 通过，12/12，其中包含产品版本与 Android 清单一致性检查。

## 0.2.104 基线与打包条件

已读取 `AGENTS.md`、`CURRENT_STATE.md`、`docs/release-0.2.104-local.md`、`scripts/build-android.ps1`、`docs/continue-development.md` 和 `mobile/README.md`。现有 0.2.104 APK 实测包名和版本为 `com.guanyun.weather.shantu.preview`、`0.2.104-test` / `111`，SHA-256 为 `686a9bc38bdea2509f493bc563f3be13d20558da3a1222c246acad0552f54c12`。Android v2/v3 签名均通过，签名证书 SHA-256 与独立测试包配置相符；仅记录证书指纹，不接触私钥内容。历史最终 stage 为 `mobile/.build/apk-20261003-075923`。

上一包发行记录报告了 1910 个 APK assets、496 张地形 PNG、38 个私有图源种子、1365 张概览瓦片，以及 preview、production 与 APK Key 一致。当前 preview 和 production Key 仍已配置且相互一致；检查只输出布尔值，不显示 Key。私有种子文件 `.openai/default-map-sources-private.json` 存在，供本机测试包构建使用。

Android SDK 与 JDK 均存在，使用以下绝对路径：

- SDK：`D:\GodotAndroid\android-sdk`
- JDK：`D:\GodotAndroid\jdk-17`
- `aapt2`、`zipalign`、`apksigner`：`D:\GodotAndroid\android-sdk\build-tools\35.0.0`
- Java：`D:\GodotAndroid\jdk-17\bin\java.exe`

主代理构建命令：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -SdkRoot D:\GodotAndroid\android-sdk -JdkRoot D:\GodotAndroid\jdk-17 -StandaloneTest -DefaultMapSources .openai/default-map-sources-private.json
```

脚本会生成新的 `mobile/.build/apk-<timestamp>` stage。完成构建后，把真实 stage 路径传给核验器：

```powershell
python .openai/package-02105-verify.py --apk APK/Shantu-0.2.105-test-standalone.apk --stage mobile/.build/apk-<timestamp> --private-sources .openai/default-map-sources-private.json
```

核验器要求 APK `assets/` 与 stage `web/` 文件集合完全一致；除 `terrain/*.png` 外，其余每项逐字节比较。地形 PNG 会逐块验证 CRC、比较全部非 IDAT chunks 原字节及 inflate 后的完整 scanlines，兼容无损重压 IDAT，同时保证元数据和像素不变。报告分别记录 `assetsCompared`、`byteForByteAssets` 和 `terrainPngsPixelsAndMetadata`。另校验 ZIP CRC、0.2.105/code112/包名、zipalign、v2/v3 签名证书、概览瓦片与 SHA 清单、38 个私有种子，并用布尔值核对 preview/production/APK Key。通过后写入 `.openai/package-02105-verify.json`；不要把该本机配置 APK 上传到公共 Release。

## 交付方式与当前边界

既有本机交付方式是临时单 APK 下载隧道：只暴露 APK 随机路径，设置短有效期；接收端完成文件全量下载后核对字节数和 SHA-256，并请求小段 Range 确认 HTTP 206。此前记录使用约两小时有效期。若本轮采用此方式，应从新构建 APK 和本轮核验报告读取哈希，重新启动临时服务并验证新链接；旧链接已过期，不能复用。本报告不创建下载服务或外网链接。

本准备任务没有运行 Android 构建，没有更改 APK、私钥、Key 文件，没有启动端口或隧道，也没有 Git 提交、推送或公开发布。真实设备安装、触控、键盘及覆盖安装仍需单独记录验证状态。
