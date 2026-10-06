# 0.2.107-test 私有 APK 交付记录（2026-10-06）

用户要求接入国家气象数据网的国内雷达实况，并打包最新 APK。本版将原“降雨图”入口改为“雷达实况图”，显示 CMA 全国组合反射率完整原图，保留 dBZ 色标、底图、南海插图、观测时次与署名；支持最新/前后帧、更新、放大与返回。温度、风和路线天气仍是原有预报来源。

**范围限制：没有地图配准信息，尚未完成雷达与地图的地理叠加。dBZ 不是毫米雨量。当前匿名取数可用，长期免费及公开嵌入许可未核实；本包仅本机私有交付，不上传公开 Release。**

## 验证

- 主代理独立核验：目录 HTTP 200、80 帧，07:54 北京时间图片 HTTP 200、929326 字节、PNG 有效；用户 9174 预览通过新 3108 本地 API 显示 08:00 帧。最终 APK 的网页 stage 在隔离 9183 预览取到 08:06 帧。图片请求严格使用 HTTPS，不新增 Android 明文访问例外。
- 源码 390×约857、360×780：原图成功加载、历史/最新切换、刷新保留历史选择、100% 完整原图、200%/300% 水平和垂直滚动到边缘、关闭/返回通过。双图两尺寸入口通过；360 实际检查上下图开关都能打开同一查看器，关闭查看器后两个开关均关闭。旧雨量格网得到 null 数据并隐藏，不以国外预报回退冒充国内雷达。
- 受控故障注入 9182：真实同一帧 `222048976` 第一次图片请求人为返回 503，界面显示失败；点击更新后，同一帧真实 1349×1208 PNG 成功显示。该测试不代表官方服务发生过故障。
- TypeScript PASS；CMA 接口及 UI 专测 11/11 PASS，前端相关 63/63 PASS。桌面 JDK17 harness 调用原生 DataTransport HTTPS 路径取到真实 PNG；APK Java/D8 编译 PASS。源码、浏览器和桌面 JVM 检查均不等同 Android 真机验收。
- 全局 architecture 检查 FAIL：10 项超行数均已在构建基准 HEAD 存在，无新增违反文件，未扩大为无关重构。最终 stage 启动日志另有 MutationObserver 非 Node 参数异常；外层及应用 iframe 的有效 error 监听均未捕获该异常，来源未定位。雷达路径验收通过，不宣称页面零异常；详见 UI 质量记录。
- 实际截图：`artifacts/screenshots/cma-radar-20261006/`。日志：`.openai/cma-main-final-tsc-20261006.log`、`.openai/cma-main-final-tests-20261006.log`、`.openai/cma-frontend-targeted-tests-20261006.log`、`.openai/cma-native-harness/native-getRadarImage-20261006.log`。

## 安装包

- 文件：`APK/Shantu-0.2.107-test-standalone.apk`；66105916 字节。
- SHA-256：`cbd51ebd1d16210e20f6fbd2f2be2cab5a6c50a6c2a94400d2189b0255fb8d58`。
- 版本：`0.2.107-test` / versionCode `114`；包名 `com.guanyun.weather.shantu.preview`，保留配置签名身份。网页版本与 Android 版本一致。
- 最终 stage：`mobile/.build/apk-20261006-083308`。v2/v3 签名、配置证书匹配、zipalign、CRC PASS；1907 assets 与最终 stage 一致（1411 项逐字节、496 张 terrain PNG 像素/非 IDAT 元数据一致），38 个私有图源与1365张概览存在。Key 一致性检查仅记录布尔值，未输出凭据。
- 构建/核验日志：`.openai/apk-02107-build-20261006.log`、`.openai/package-02107-verify.log`、`.openai/package-02107-verify.json`。旧 0.2.106 候选包保留，但不含本次 CMA 接入。

## 待完成与同步

Android 触控、GPS、后台、设备网络与 HarmonyOS 原生包未验收。本版没有修改轨迹编辑源码；用户报告删点/拖点后需缩放才刷新，并回复发生在“上个版本”，具体手机视图仍未明确。浏览器短路线、1000点 GPX、二维/三维/双图暂未复现，不能称已修复。真实用户存档、PDF、地质资料均保留。

源码同步目标为 `origin/codex/rollback-ui-0235-20260921`，未合入 `main`。构建时基准 HEAD 是 `d9fa1d15761ec8555f4db235e1557e2b10f3e42b` 加本轮工作区改动；实际提交与推送结果以本轮最终回报及分支 HEAD 为准。接入协议和来源边界见 [CMA 接入记录](cma-radar-integration-20261006.md)。
