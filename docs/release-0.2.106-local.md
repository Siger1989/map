> **2026-10-06 来源纠正与发布暂缓：**已构建APK的技术、签名与资源核验通过，但雨量数据仍来自 Open-Meteo；NSMC仅用于卫星云图。当前包不满足用户提出的国内降雨来源要求，不能称完整目标已交付。用户已确认目标为“国内雷达／实况降水”；NSMC卫星WMS能力响应HTTP 200，但所检查响应未发现降雨/QPE/雷达图层，此结论仅限该WMS。真实国内数据API与接入尚未完成。不得改名冒充或默认回退国外来源后称国内已完成。APK与既有代码、用户资料均保留，当前暂缓发布。工作区改动与APK均保留，尚未提交或推送；私有Key不披露。
# 0.2.106-test 本地私有 APK 交付记录（2026-10-06）

目标版本：`0.2.106-test` / versionCode `113`。本轮由用户明确转入最新私有 APK 交付；此前快速预览阶段的暂不出包限制不再适用。本记录仅用于本机私有交付，不公开上传含私有图源配置的 APK。

## 源码与界面验收

- 定向检查：`npx tsc --noEmit` PASS；天气、降雨、视口、云图重试、定位重试/跟随、图层偏好和双图相关测试 PASS 86 / FAIL 0。日志：`.openai/apk-latest-20261006-checks-tsc.log`、`.openai/apk-latest-20261006-checks-tests.log`。
- 主代理在 9174 源码预览完成 390×857、360×780 核验：页面无横向溢出；雨图平滑可见，不是固定25点方框。折叠图例约180×54px、summary约44px；展开约180×144px，说明区实际可滚动，未遮挡左右地图工具或底栏。
- 两种尺寸下打开路线规划后，关闭按钮可返回；路线任务期间雨图隐藏，返回地图后恢复。截图：`artifacts/screenshots/apk-02106-20261006/rain-folded-390.png`、`rain-expanded-390.png`、`route-return-390.png`、`rain-folded-360.png`、`rain-expanded-360.png`、`route-return-360.png`。
- 定位权限在浏览器中被拒绝，界面使用有明确标注的 IP 估算回退；这不是 GPS 验收。手机触控、真实 GPS、朝向、后台行为与 HarmonyOS 原生包均未验/未交付。预览提示部分高程瓦片未加载，不能据此称网络地形加载通过。

- 390尺寸另实测卫星云图加载到实际观测时次，面板248×480px（约x8/y56）、无横溢；关闭云图和面板后雨图恢复，云图开关回到原关闭状态。截图：`artifacts/screenshots/apk-02106-20261006/cloud-panel-390.png`。这是成功加载样本，不证明失败重试恢复；失败重试由定向逻辑测试支撑。
## 构建与产物核验

构建与产物核验：PASS。APK：`APK/Shantu-0.2.106-test-standalone.apk`，66,097,724字节，SHA-256 `3a3df105a6aa667cb175b93e85950513b600403868c7afa0313f3dea3dddb077`；stage `mobile/.build/apk-20261006-003506`。包名 `com.guanyun.weather.shantu.preview`，版本 `0.2.106-test` / code `113`。原配置证书匹配、v2/v3签名、zipalign、CRC 均 PASS；stage/APK 1,907项资源一致（1,411项逐字节，496张 terrain PNG 像素及非 IDAT 元数据一致）。38个私有图源、1,365张概览资源存在；Key、preview、production 与 compiled version 布尔一致 PASS，sidecar 匹配。完整记录：`.openai/apk-latest-20261006-build.log`、`.openai/package-02106-verify.log`、`.openai/package-02106-verify.json`。
构建后仅移除了 modules/weather/rain.ts 末尾多余空行，业务逻辑未变；APK为上述stage的既有构建。
源码分支 `codex/rollback-ui-0235-20260921`；构建时 HEAD `d9fa1d15761ec8555f4db235e1557e2b10f3e42b` 并包含本轮本地天气等改动。提交/推送由主代理继续复核，本记录不标为已推送或已合入 main。APK 保持本机私有交付，不上传公开 Release。
用户 PDF、`地质资料/`、私有配置与用户存档均须保留。