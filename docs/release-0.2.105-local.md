# 0.2.105-test 本机交付记录（2026-10-05）

本轮本机私有测试包已构建、核验并完成短时下载验证。APK 为 `APK/Shantu-0.2.105-test-standalone.apk`，包名 `com.guanyun.weather.shantu.preview`，版本 `0.2.105-test` / versionCode `112`，大小 66,097,968 字节，SHA-256：`d7688de0c6cb5a33b234f06c897c60858a19da20cb99f9aa386a18b28d92e851`。

最终 stage 为 `mobile/.build/apk-20261005-115642`。核验 PASS：APK ZIP CRC、zipalign、原签名证书兼容；stage `web/` 与 APK `assets/` 的 1,910 项资源集合完全相同，其中 1,414 项逐字节一致，496 张地形 PNG 的 CRC、非 IDAT 元数据块和解压后 scanlines/像素一致（地形 PNG IDAT 允许无损重压）。包含 38 个私有图源种子及 1,365 张概览瓦片。preview、production 和 APK 内图源 Key 一致性检查通过，文档与报告只记录布尔结论，不记录 Key。

主代理报告 84 项定向测试通过（58 项业务定向测试及 26 项平台/工作流测试），`tsc`、网页构建和 Android APK 构建通过。1539 个构建源码文件在构建前后 SHA 快照无变化。主代理在 9174 源码预览复跑 route/cloud/recorded/marker/position/search：390/360 视口通过（recorded 主复跑为 390，代理另做两尺寸检查）。最终 APK stage 在 390/360 完成版本/主页无溢出、标记隐藏后编辑器保留、双图 2-pane 和零 pageerror smoke。route/cloud 双图最终 QA 在本轮补齐，没有修改这两项功能的产品逻辑。源码同步还包含 routeShare 扩展名导入修复及 EOx attribution 补齐。

构建后只对既有两个源码文件做了 EOF 多余空行清理：`modules/mapSources/sharedTileFetch.ts` 和 `modules/weather/satelliteCloud.ts`。变化仅为文件末尾换行格式，不影响逻辑；因此 1539 文件快照是构建时记录，未在这项纯格式清理后重跑构建。

短时私有下载已核验整包长度与 SHA-256 匹配，并通过 Range 请求返回 HTTP 206；证据在本机 `.openai/apk-02105-public-verified.json`。下载服务有效期截至 2026-10-05 14:06:29（北京时间），电脑需在线。随机令牌下载地址不写入文档。

Android 真机安装、触控、GPS、朝向及后台行为没有本轮验证；未交付 HarmonyOS 原生包。APK 内含私有图源配置，只能用于私下测试，不得上传公共 Release。工作分支为 `codex/rollback-ui-0235-20260921`，构建前 HEAD 为 `ec47ec0aa5f23cba6dfa2dd576197a82b6f34efe`；最终提交、推送或合入 main 状态由主代理另行核对，本记录不宣称已发布到 main。
