# 当前状态 — 2026-09-14 / 0.2.29

## 0.2.29修正完成、APK已构建，准备同步发布
- 用户原顺序：先完成本地功能→打包→布局窗口。0.2.28已经发布；随后用户指出左右UI重叠、定位/海拔灰色及坡度缺高程，优先完成本次修正。
- 修正position/routeDisplay/routeAnalysis/controls：绿色可用/激活状态；编辑时允许只定位、不带动镜头；显示设置解除误禁用；定位提示移顶、坐标限宽，编辑底部按钮上移；左进度条按顶部路线卡实高避让，右海拔/方向盘/展开工具分区。
- 新useTrackElevation共用DEM；RouteAnalysisSummary此前只分析原文件，现缺高程时补读地形且提示来源/失败原因。仅显示派生副本，不改变原轨迹坐标、时间、存档。删除useRouteDisplay重复请求流程，保留elevation兼容入口。
- 449/449应用逻辑、4/4布局模型/保存接口检查、tsc与结构检查PASS，APK及网页资源构建PASS；390/360/266编辑UI截图已保存。无高程GPX通过离线缓存DEM读取约496米、坡度0.3%；浏览器定位超时，不代表真机GPS验收。
- APK/Shantu-0.2.29-test-standalone.apk：0.2.29-test/code36；57710867字节；SHA256 230f68d558587230335932e22e38ace9d3f52c2a1db2346330bb33abe2825d6b。原4a94证书，v2/v3/zipalign/541 CRC/473地形/新增修正JS与许可PASS。开发编辑器未混入APK。
- 新布局工具tools/layout-editor；npm run dev:layout，http://127.0.0.1:9241/__layout；相对位置/尺寸/比例/字号/隐藏、撤销、JSON保存/交换。config/ui-layout-draft.json保持空草稿，未把测试布局当用户偏好。
- 布局真实iframe/选择框/属性面板已显示；第一次拖动暴露子选择器“>”被拒，已修正并加入回归。此后Codex浏览器连接连续超时，最终拖动/尺寸/保存后重开端到端未验收，不能称已完整验收。open_in_codex请求亦未返回，不声称窗口已成功交付。保存API实际本机HTTP往返/中文/拒绝异源与坏文件保护通过。
- 图示18项及index.html打包APK/Shantu-0.2.29-feature-guide.zip；截图目录artifacts/screenshots/ui-0228。18～23为本次修正，24为已标注的0.2.27采样设置图，其余0.2.28流程图；固色照片/构造轨迹明确为验证数据。
- 详情docs/release-0.2.29.md、tools/layout-editor/README.md。队伍/SOS/PTT无服务暂缓；步行离线路网和地图分别下载；奥维需明确坐标系；真机、后台/锁屏、原生HarmonyOS仍未交付验收。
- 当前分支codex/sync-20260910→origin/codex/huawei-webview-touch，不是main。0.2.29提交/发布待下一条核对。预览服务本任务PID1600/7020，端口9241/3108仍在运行，清理前查命令行。

# 当前状态 — 2026-09-14 / 0.2.28

## 0.2.28历史交付与反馈
- 用户最新顺序：本地功能完成→先APK打包→布局窗口。队伍/SOS/PTT按无服务器明确暂缓。
- 功能与模块/限制见docs/release-0.2.28.md；448/448逻辑、TypeScript、结构检查PASS；网页和APK构建PASS。390/360/266 UI检查，实际图示artifacts/screenshots/ui-0228/。
- APK/Shantu-0.2.28-test-standalone.apk：57710867字节，0.2.28-test/code35；SHA256 63706b0c1ccd97801809afd209a05bf4563c1541bd3e754c45d19f9aa3315a7d。原4a94证书，v2/v3/zipalign/541项CRC/473地形/新功能JS与许可核对通过。
- 浏览器公开路网1026节点通过导入/校验/1.1km步行算路；地图包311/311、41.4MB通过续传和仅缓存冷启动；照片2/2匹配、重点与混排长图生成；Ovi构造样例通过。用户原生Ovi/真机/鸿蒙原生未验。
- 修复冷启动默认卫星覆盖仅缓存模式、区域外道路搜索结果、缓存无window兼容、并发容量预留、坐标/记录按钮重叠及极窄屏工具避让。
- 本地分支codex/sync-20260910，上游origin/codex/huawei-webview-touch；新源码提交/发布待本节下次记录。不要把0.2.27 Release当作新包。
- 0.2.28源码bd3b4a4c9a6b2730f2bf7ffd71eb3032a8fbbc7c已推送并核对；Release v0.2.28-test-standalone公开测试版已发布，3项资产SHA256和大小匹配。
- 布局工具已开始，tools/layout-editor独立Vite开发插件，尚未验收/交付；用户最新反馈左右UI重叠、底部按钮灰、坡度无高程，先修正并重新打包。
- 已定位：route-card移到顶部但旧轨迹进度条仍占原位置；定位状态条盖住新底部定位；海拔框未完整避让方向盘；按钮禁用条件过宽、激活颜色被全局样式覆盖；RouteAnalysisSummary只分析原始高程而未接DEM。
- 修正模块position/routeDisplay/routeAnalysis/controls。共用useTrackElevation只派生显示，不改轨迹存储；编辑时可定位不移动镜头；海拔设置保持可用；新增地形缺测原因。无海拔GPX浏览器已读取实际496米DEM（仅缓存模式），坡度分析和多尺寸复验进行中。
- 预览服务1600/7020为本任务后台进程，9241/3108；清理前复核命令行。

## 0.2.28早期过程记录（已被上述完成记录替代）
- 用户追加：定位跟随移到下方、优先地图路线海拔颜色/图例，信息自行选择显示，整体缩小UI，其他本地功能继续；每个功能分别提供实际图示。
- 已ff核对分支，起点adbd0ef；新增routeDisplay显示设置/地形补高程/统一海拔色阶，底部PositionDock及共享compactDensity正在接入。
- 仅派生显示数据，不写回估算高程到原始轨迹。保留缺测、暂停分段和接驳虚线语义。类型/逻辑/浏览器验证与新版APK尚待完成。
- 队伍/SOS/PTT缺通信服务；已询问部署条件，同时继续本地功能。真机、鸿蒙原生交付边界沿用下文。
- 用户已确认没有通信服务器，先完成本地功能；特别强调离线导航引擎和离线地图缓存。新增offlineRouting区域道路图/A*、缓存直读与离线模式正在实现。
- 用户要求后续Codex可视布局编辑窗口，支持拖动位置、尺寸、比例、保存后再统一优化；最新顺序：先补齐本地功能、验证并打包，再做布局窗口。目前没有开始布局编辑器代码。

### 0.2.28 当前实现与验证（进行中）
- 新增 offlineRouting：区域OSM步行路网下载/导入/导出/完整性校验、边上吸附、A*、途经点、仅离线/优先离线模式与道路名搜索。真实成都公开测试区1026节点已在浏览器导入并校验，实际算出文庙前街→锦兴路1.1km/17分钟。发现并修正道路跨区域时搜索选点落在包范围外的问题。
- tileCache共用缓存直读；地图仅缓存模式、持久存储申请；修复并发下载容量预留和进度写入过密。8项早期定向检查通过；首次全量发现2项无window环境兼容回归，已修正等待复验。
- returnHome：按连续段原点序反向返航，车位/营地/撤退点复用annotations存储，可靠GPS距离/方位与仅离线路网返程。面包屑循环/断段保护检查通过；真机定位未验。
- routeShare：可选最多8照片、横竖混排、重点照片整行放大；原照片旋转/标绘复用已有导出器。版式逻辑检查通过，实际照片图示待验。
- dataTransfer：奥维OVKML/OVKMZ批量入口，显式CGCS2000/GCJ02转换；普通GPX/KML按标准。不能从扩展名自动判断奥维坐标系，未知拒绝猜测；尚缺用户原生奥维样本。mapSources新增天地图官方申请说明入口。
- UI：底部定位44px触控，路线海拔色阶/统计/剖面/陡坡标记可选。已有实际图示01-follow-elevation-390.png、02-offline-routing-390.png。其余逐项图示和390/360/266检查继续。
- 新增文件和接口需整理README，最终格式/结构检查、全量测试、APK版本提升构建及GitHub同步尚未完成。布局窗口未开始，遵从先功能打包再做窗口。

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
- 源码提交5c21a4134a8d47dbc0035a0630f8252e30e6e4cd已推送origin/codex/huawei-webview-touch；远端分支与本地一致，Release标签指向同一提交。本次后续交接提交仅更新本状态文档。
- v0.2.27-test-standalone已发布为公开测试Release（id388117228，draft=false/prerelease=true）；无认证API复核成功：https://github.com/Siger1989/map/releases/tag/v0.2.27-test-standalone 。APK、SHA256文件、安装说明3项资产均uploaded，大小与GitHub SHA256 digest逐项匹配本地。
- APK digest为上文ae82db…；校验文件digest 0ca11e43faba55c562aa3fee01f008570bff4863a536d556b8175e2b4250189a；安装说明digest e23dbeb15f2b2fa1aeb314e859662728d0975cbab72f01488852fc8fddb3a3be。首次网络TLS握手超时，发布子进程直连后成功，未修改系统网络设置或保存凭证。
- 本轮临时验证页面已关闭，视口覆盖已恢复，自建9241/3108验证服务已停止；截图和日志留本地供追溯。
- Android真机安装、GPS、锁屏耗电、手指触控未验。HarmonyOS6.1原生HAP/APP未交付；本轮未更新Windows/Mac ZIP。
- 原生离线路由/专门返航、奥维坐标适配、队伍/SOS/PTT、照片混排等仍待后续；需要道路图、奥维样本及队伍服务部署/分享范围。主页面和TerrainMap仍有历史结构债务。
