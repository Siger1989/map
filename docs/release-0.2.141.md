# 0.2.141-test：标记缩小保留与名称提前

用户要求更新APK，本轮从最终源码全新构建私人Android包。标记加载范围随视口扩大，修复固定30km上限造成的远点消失；名称从相机原始zoom11提前到9，继续缩小显示图案/9px圆点。主图、双图共用规则，原有地形遮挡保留。实现范围见[标记修复记录](marker-visibility-20261026.md)。

## 私人APK交付

- 版本 `0.2.141-test`，versionCode `148`，包名 `com.guanyun.weather.shantu.preview`。
- 原签名SHA256 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`，v2/v3与zipalign验证通过。可覆盖同包名、同签名测试版；真实手机覆盖安装及数据保留尚待用户验证，不要先卸载旧版。
- 大小 `70,306,068` 字节，SHA256 `ca3d673a58846d70fe98ff89165d5c9e0eabbe7d9f78d36b89cedda19b5660ad`。
- 交付路径：`交付包/山兔-0.2.141-test-2026-10-26/01-Android-APK/Shantu-0.2.141-test-private.apk`。
- 固定入口 `APK/山兔手机.apk` 与 `APK/Shantu-0.2.141-test-private.apk` 均与上述哈希一致；上一固定包另保留本机归档，历史139及更早版本未删除。
- 已注册天地图Key与39项私人图源保留，凭据仅比较存在性/一致性，不写源码、聊天或日志。仅私人包交付，本轮没有生成无Key安装包，也没有将私人APK上传公开Release。

## 最终产物验证

| 项目 | 结果 | 证据/边界 |
| --- | --- | --- |
| TypeScript、版本与标记定向逻辑 | PASS | `npx tsc --noEmit`；四个测试文件25/25，`.openai/release-141/targeted-tests.log` |
| fresh网页与原生构建 | PASS | 独立stage `mobile/.build/apk-20261026-174519/`；签名、manifest与473基础地形检查通过 |
| 包内资源与完整性 | PASS | 1927项网页资源与最终stage逐项一致（地形PNG按优化规则比较），DEX一致；1935个ZIP条目CRC通过；`.openai/release-141/private-integrity.json` |
| 私人配置 | PASS | 生产Key存在且与包内JS相符，39项种子文件字节完全一致；主图/双图内置天地图入口均实测可见 |
| 天地图单张影像 | PASS（单次网络探测） | 本轮1次请求HTTP200，19,671字节有效图像。只证明此次单瓦片服务返回，不等于Android长期加载、额度或限流验收 |
| 最终APK解包主图 | PASS（隔离浏览器） | 390×857、360×780，原始zoom9→8→7→5→3→9；中心点保留，47km点在缩小范围内保留，名称提前出现；无横溢、无pageerror |
| 最终APK解包交互/双图 | PASS（隔离浏览器） | 两尺寸点击选中/再次进入编辑/返回不改zoom，双图zoom7圆点/47km点保留、zoom9名称显示、退出成功；主审亲看截图 |
| 9174预览与本包 | PASS（资源对齐） | 使用本次最终APK提取的JS/CSS更新quality预览；390×约857外框、禁止网页全屏。Key配置一致；浏览器不具备Android原生桥接，真实设备能力不能由此验收 |
| 真机与其它平台 | 未验证/未更新 | Android覆盖安装、触控、密集标记性能/GPS/后台待真机；EXE133、Mac140未重建；原生HarmonyOS安装包仍未交付 |

截图：`artifacts/screenshots/apk-141-markers-20261026/`。完整隔离浏览器矩阵 `.openai/release-141/marker-qa-results.json`，内置入口 `.openai/release-141/sources-qa.json`。生产网页在隔离浏览器没有Android桥接，不声称39种子已在该浏览器自动导入；包内种子和原生加载资源已按字节核验。测试点不写入用户实际存档。

版本调整仅 `config/product.ts`、`mobile/android/AndroidManifest.xml`；标记功能涉及三个运行时模块和两个测试文件。未修改定位、路线、存储格式、私有Key或原签名。源码同步目标仍为 `origin/codex/place-address-search-20261011`，未合入main；远端同步状态由最终交接记录。
