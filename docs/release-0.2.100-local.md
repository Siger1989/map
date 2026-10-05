# 0.2.100 私有测试 APK：双图分叉优化

用户在双图性能检查完成后明确要求打包。使用最终本地源码全新构建，版本 `0.2.100-test` / versionCode `107`，包名 `com.guanyun.weather.shantu.preview`。沿用已有签名、38 个私有图源和已有天地图 Key；保留用户数据标识。本包仅用于用户私有交付，没有公开到 GitHub Release。

## 本次修改

包含分叉元数据增量复用、双图线路生成复用、仅提交变化的地图要素、稳定投影与吸附网格复用，以及地图源错误后的有界恢复。原始坐标、颜色备注和撤销语义保持，详细证据见 [双图分叉性能记录](dual-branch-performance-20261002.md)。

相同最终功能源码的 126/126 定向测试、TypeScript 检查、网页构建、1200 条随机路线与旧算法对照通过；390×约857、360×780 浏览器的上下图分叉、撤销、移动窗口、保存再打开、未保存保护已验证。打包阶段仅更新 `config/product.ts` 与 `mobile/android/AndroidManifest.xml` 版本，再完整构建网页/Android。

## 最终产物与核验

- 文件：`APK/Shantu-0.2.100-test-standalone.apk`
- 大小：66,081,584 字节。
- SHA256：`01399a95fd98c7a2b8ba6734c030b81a4ffada3a05daf25ead9fbff1a944c7f6`。
- 暂存：`mobile/.build/apk-20261002-183833`。
- v2/v3 签名、包名/版本、zipalign、ZIP CRC 均 PASS；原证书 SHA256 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f` 匹配。
- 1910 项最终资源一致，496 张地形 PNG 像素及元数据一致，38 项私有种子字节一致，1365 张概览瓦片哈希通过。预览/production 天地图配置及包内配置一致，只记录布尔结果。
- 主 agent 在回环 9292 使用本次最终暂存资源复核两尺寸双图显示、390 绘制/暂停/退出与返回；两尺寸无横向溢出。截图 `artifacts/screenshots/branch-performance-20261002/apk-02100-dual-{390,360}.jpg`。
- 构建日志 `.openai/build-0.2.100-local.log`；独立核验 `.openai/package-02100-integrity.json`、`.openai/package-02100-config-check.json`、`.openai/02100-{aapt,apksigner,zipalign}.log`。

构建命令：`powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -SdkRoot D:\GodotAndroid\android-sdk -JdkRoot D:\GodotAndroid\jdk-17 -StandaloneTest -DefaultMapSources .openai/default-map-sources-private.json`。

## 交付边界

浏览器操作及本机 JS 基准不能代表 Android 触控/帧率。真实手机覆盖安装、GPS、后台记录、温升与流畅度仍待验证；HarmonyOS 6.1 原生包未交付。已有架构行数预算失败继续单列，没有扩展为无关重构。

工作目录 `D:\天气地图`，分支 `codex/rollback-ui-0235-20260921`，HEAD `ec47ec0aa5f23cba6dfa2dd576197a82b6f34efe`。保留全部此前本地修改，本轮没有新增提交/推送/合入 main；原 9174 用户存储及 9291 合成性能测试预览保持，9292 最终资源检查结束后已关闭。

临时单 APK 手机链接有效至北京时间 2026-10-02 20:40:55，电脑须在线；完整 URL 见 CURRENT_STATE 顶部及 `.openai/apk-02100-public-verified.json`。本机直连核验60秒超时，使用仅命令级既有代理重试后，外网整包 SHA256/大小与 Range206 验证 PASS。未更改持久网络配置；未承诺手机所处网络可直连。
