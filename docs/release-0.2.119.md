# 山兔 0.2.119-test / code126

2026-10-10 APK 构建和交付核验完成。本发行版本为 `0.2.119-test`、versionCode `126`，Android package `com.guanyun.weather.shantu.preview`；源码和公开APK对应标签 `v0.2.119-test-standalone`，发行入口见下文。

## 本轮内容

- 路线摘要整合起终点、交换和导航方式；切换方式或交换起终点会重新规划，失败时保留上一个有效结果。活动导航应用新规划结果时更新引导。
- 手动缩放后位置跟随保留当前缩放；地图拖动、用户旋转和俯仰按浏览意图暂停跟随。
- 道路导航确认偏航后，从最新有效且仍偏离路线的位置，按当前导航方式自动重规划。无效定位、已移动后不再匹配的结果和已取消请求不会进入活动引导；保留原计划引用、导航开始时间及已走里程。轨迹导航继续沿用原轨迹接回语义。
- 主图和双图切换底图时保留各自图层设置；修复双图退出焦点造成的地图滚动偏移。
- 本版累积保留 0.2.118 已有的整合钻孔 Excel 导入、出图和模板能力；Windows EXE 未重建，仍为 0.2.118。

## 代码与浏览器验证

- 83 项定向检查通过：跟随/偏航 25 项、路线卡片 16 项、图源/双图 42 项。
- `npx tsc --noEmit`、最终 Web 构建及差异格式检查通过。
- 浏览器实测 390×857 与 360×780：路线卡片、实际换模规划、单双图图层开关及双图退出后的地图位置通过。

浏览器和逻辑检查不替代设备定位验收。真实 GPS、Android 连续导航、偏航重算、后台行为和触控仍未在设备上验证。本版 APK 不是原生 HarmonyOS 安装包。

## APK 产物与核验

公开APK：

- 文件：`.openai/release-119-public/Shantu-0.2.119-test-standalone.apk`
- 大小：70,219,877 字节
- SHA256：`57df57d35c54ecaf96d89236784104e5bd4fa4249bb22e692b3d0240d2503e1b`
- GitHub发行页目标：[v0.2.119-test-standalone](https://github.com/Siger1989/map/releases/tag/v0.2.119-test-standalone)

私有用户APK：

- 固定入口：`APK/山兔手机.apk`
- 版本归档：`APK/Shantu-0.2.119-test-standalone-private.apk`
- 两文件核验一致，大小均为 70,219,961 字节
- SHA256：`559a5b1b5fbe770ba4f5f4da4409c6a7f2647b24fca02c196447b1f644441014`

构建报告核验通过：aapt 显示版本 `0.2.119-test` / code126 及 package `com.guanyun.weather.shantu.preview`；沿用原签名证书；zipalign、完整资源清单、473 项 terrain 资源及 ZIP 可读性通过。私有包 seed 与 Key 核验通过；公开包不含 Key 或私有 seed。签名材料与凭据不进入公开产物或源码发布。

## 源码与发行核验

- 分支：`codex/rollback-ui-0235-20260921`；源码版本通过标签 `v0.2.119-test-standalone` 解析，未合入 `main`。
- [GitHub发行入口](https://github.com/Siger1989/map/releases/tag/v0.2.119-test-standalone)。当远端发行资产 SHA256 与上方公开APK一致时，发行资产核验通过。
- 远端实际执行凭据见本机 `.openai/release-119-github.json` 与跨电脑接续记录；源码提交以发行标签解析结果为准。

|项目|状态|
|---|---|
|APK构建、签名及交付核验|通过|
|公开APK SHA256与大小|已核验，见上文|
|私有APK与固定入口一致性|通过，见上文|
|公开配置无Key及私有seed|通过|
|GitHub发行入口与源码标签|发行入口与源码标签见上文；实际发布结果由远端核验|
|远端源码commit SHA|通过发行标签解析|
|真实GPS / Android设备验收|未验证|
|原生HarmonyOS安装包|未交付|
