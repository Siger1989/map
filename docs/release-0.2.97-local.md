# 0.2.97-test 本机私有测试包（2026-10-02）

目标：统一首页顶部/底部/工具材质，恢复双图内已保存轨迹的选中和编辑，保留全部已配置图源。版本code104，包名`com.guanyun.weather.shantu.preview`。这次由用户明确要求打包并发手机；不作为奥维加载效果达标结论。

## 改动

- 顶栏恢复共享64%透明度与blur18px/saturate1.1；顶部背景采样向上扩展54px，clip回原栏高，地图、控件、相机位置不偏移。旧“单独关闭顶部滤镜”方案撤销。浏览器Vite曾返回旧CSS；重启一次并启用当前进程轮询后，核对实际加载CSS。
- 双图browse不再常驻pickingActive；上/下图复用路线、线段、节点和拖动回调，选线后可在双图内进入既有编辑流程。工具栏及未保存保护共用原实现。
- 节点框选拆为两图各自的canvas范围与投影，编辑入口44×44。分支绘制沿用准星画线手势。
- 地图读取诊断补充tracksVisible、实际renderedTrackLines及loadedTrackFeatures，区分存档点数与真实画面。

## 证据和验证边界

390×857实点：上图选线→编辑→选中/拖动节点→保存→下图同步；下图清选择→选线→编辑→选节点→拖动→撤销→再次移动→保存。GPX原轨迹遵循已有保护规则，第一次编辑生成副本，后续修改同一副本；未动用户9174存档。

360×780实点：下图选线与编辑、节点框选、未保存退出确认和继续编辑；退出对比保持相机与草稿。390×857从下图拖动落点累计15公里，再从上图追加分支顶点、结束分叉、保存通过，两图同步。

截图：`artifacts/screenshots/loading-reuse-20261001/topbar-uniform-final-{390,360}-20261002.png`、`dual-track-edit-lower-390-20261002.png`、`dual-track-box-lower-360-20261002.png`。顶部/底部实际computed同rgba(24,32,31,0.64)、blur18px/saturate1.1；后续主视图已恢复实际卫星加载。

浏览器测试不等于Android触控、覆盖安装、GPS、后台记录或加载速度验收。本轮推荐“超强”源的上游连接在电脑直连与代理均超时；尚不能保证该图源手机可用，也没有同手机奥维对照证据。远景概览仅填缺口，不代替高清细节。

## 构建与资源

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -SdkRoot D:\GodotAndroid\android-sdk -JdkRoot D:\GodotAndroid\jdk-17 -StandaloneTest -DefaultMapSources .openai/default-map-sources-private.json
```

本机JDK/SDK路径显式覆盖旧默认路径。签名须与原证书`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`一致，v2/v3与zipalign通过。38项私人seed逐字节对应本机配置，天地图既有Key只校验存在及一致性，不输出值；独立浏览器未伪造Android桥接。打包1365张全球z0–5卫星概览、496张地形PNG（含473主瓦片）；资源逐项比stage，地形PNG允许无损重压，逐项比较解压像素和非IDAT元数据。

APK和临时下载元数据保留`.openai`/`APK`本地；不上传公开GitHub Release，不提交或推送本轮改动，不合入main。临时分享仅单个随机路径APK，限时2小时，支持断点续传；电脑需在线。

## 最终产物和检查

- APK：`APK/Shantu-0.2.97-test-standalone.apk`；66,069,296字节（约63MiB）；code104。
- SHA256：`d42a48c5bd8461756b1e1c7e5934f0eaf53eaba78e77c002e5dd858f9fb85148`。
- stage：`D:/天气地图/mobile/.build/apk-20261002-022431`。
- PASS：tsc；双图/隐藏入口26/26；网络/校正/地形56/56（显式JDK17）；第一组运输/浏览缓存/兜底38项中37通过、1因默认JDK路径跳过，原生解析检查后续使用有效JDK重新运行通过。没有用测试计数代替视觉。
- PASS：v2/v3签名与原证书匹配、zipalign、1918 ZIP项CRC、1910资源对应stage、496地形PNG解压像素/元数据、1365卫星概览摘要、38 seed原字节、天地图Key配置/包内值一致（仅布尔值）。
- 最终stage浏览器：下图选线→编辑→点选/拖动节点→保存→退出对比实际通过，相机8.76级/0度保持。截图`dual-track-edit-final-apk-20261002.png`。源预览390×857、360×780上述交互与框选/退出保护通过。
- QA服务自身曾遗漏`.mjs`的JavaScript MIME，导致模块Worker不能解码、GeoJSON缺线；现已修正QA服务，Android LocalGateway原已正确覆盖.js/.mjs，无需更改APK原生服务。记录此问题，避免把验收工具错误当产品故障。
- 本地下载与外网整包下载均与上方SHA256一致，Range16字节返回206通过。临时手机链接仅在`.openai/apk-0297-public-download.json`，2026-10-02 04:25:57北京时间到期；不把随机下载令牌写入受版本控制文档。
- 当前分支`codex/rollback-ui-0235-20260921`保留原有142项工作区变更；本轮未Git提交/推送，未合入main。实机速度/覆盖安装待用户验收。
