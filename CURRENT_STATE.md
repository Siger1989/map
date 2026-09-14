# 当前状态 — 2026-09-14 / 0.2.27

## 本轮目标与成果
- 用户要求检查迭代变慢、整理冗余，并按附图分模块添加户外功能。已完成首批结构整理与记录/分析/批量导入实现；完整逐项状态见 docs/upgrade-plan-20260914.md，未把整张图宣传为完成。
- 本地 codex/sync-20260910；上游 origin/codex/huawei-webview-touch；起点7e974ad。工作区原先干净、已ff核对。未合main，旧stash与其他工作树保留。
- 新增 dataTransfer / routeAnalysis / workbench；文件交换610→7非空行兼容入口，OutdoorPanel独立四标签，主页面2947→2831非空行；导航启动/定位生命周期和轨迹拼装迁到明确接口。
- 记录增加外置控制、省电/标准/高频/自定义、按距离、静止降频/移动恢复及导航自动开始（默认关闭）；速度/坡度着色及50米坡度分析；GPX/KML/KMZ/JSON整批校验与合并。
- 减少无效GPS复制、状态变更重建几何、后台快照轮询、原生重复序列化。新增结构检查；历史进度完整归档并与基线逐字核对，见 docs/history/progress-through-0.2.26.md。
- 文件/接口/回滚说明见 docs/architecture.md、各新模块README、docs/release-0.2.27.md。稳定测量/勘探几何、模型精调、地图手势、天气地形数据和存档键未变。

## 验证
- 437/437逻辑PASS，TypeScript PASS，结构检查PASS，网页构建PASS，Java采样策略10检查PASS。
- 390×844、360×780独立本地浏览器：批量预览→确认→收藏2项→详情；坏批次失败仍2项；省电/按距离完整重载保留；外置入口44px触控。普通行程300×200 / 286×200；窄屏详情340×756，无页面横溢；当前控制台error为空。
- 截图 artifacts/screenshots/ui-0227；详细过程 design-qa.md。此前地图请求短暂502后恢复，未据此改数据源。
- 最终默认 npm run build:apk -- -StandaloneTest PASS。修复本机旧PowerShell的Get-FileHash缺失，使用.NET流式哈希共用实现。
- 最终APK APK/Shantu-0.2.27-test-standalone.apk：0.2.27-test/code34、57690301字节；SHA256 ae82db8083ac60a056e2917a287ecb0935b2a4dc2d5a253841af3c28c90fa4ca。
- v2/v3、原独立4a94签名、zipalign、540项ZIP CRC、473地形和新增JS/DEX标识PASS。SHA256及安装说明已准备；日志均在.openai且不进Git。

## 发布与下一步
- 当前准备提交推送及发布 v0.2.27-test-standalone；尚未宣称远端同步成功，完成后补充远端SHA/资产digest。
- Android真机安装、GPS、锁屏耗电、手指触控未验。HarmonyOS6.1原生HAP/APP未交付；本轮未更新Windows/Mac ZIP。
- 原生离线路由/专门返航、奥维坐标适配、队伍/SOS/PTT、照片混排等仍待后续；需要道路图、奥维样本及队伍服务部署/分享范围。主页面和TerrainMap仍有历史结构债务。
