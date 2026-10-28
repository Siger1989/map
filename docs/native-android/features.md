> 2026-10-28 已由用户批准 React UI + 原生地图路线；本文全UI原生重写约束仅留作历史，以 hybrid-goals-20261028.md 等四份新合同为准。

> 2026-10-28接续：已补多批原生模块，本批209项测试与开发构建通过；完整功能/UI仍未完成。最新范围、证据和安装阻塞见 [本轮验证](parity-validation-20261028.md)。下面2026-10-27安装反馈表记录当时原型的缺口，不能当作今日逐项验收结论。

## 2026-10-27 用户安装反馈后的实际差异核查

以下是本次原生包当前源码状态，不是功能完成承诺。交付结论：不满足原功能/UI完整保留。

| 原版能力 | 原生包实际状态 | 源码证据 |
|---|---|---|
| 地点名称搜索、路线规划、导航 | 名称搜索和路线流程占位；搜索仅支持手输坐标 | MainActivity.kt coordinateSearch / perform route |
| 我的图源、公共库、缓存选择/管理 | 标签点击只提示迁移中；仅三种内置天地图可选；缓存只是底层瓦片缓存 | MainActivity.kt sources / NativeMapController |
| 双图、区域、测量、剖面、行业工具、扫码路线 | 工具面板仅完整工程导入导出与迁移说明 | MainActivity.kt toolsPanel |
| 完整标记、模型、照片、画线编辑 | 仅中心点pin与逐中心节点线条，缺完整编辑交互 | MainActivity.kt markerPanel / drawingPanel / renderWorkspace |
| 收藏、目录、路线样式 | 仅线条/标记列表定位；renderWorkspace路线使用固定主题色/宽度，未保持原对象完整样式 | MainActivity.kt collections / renderWorkspace |
| 原版地形与专业叠加、标准/高清切换、框选 | 原地形管线未迁移；画质/框选入口仍提示迁移中 | MainActivity.kt layers / perform quality,box |
| 记录、文件和历史数据 | 基础记录服务与v2工程读写已有代码；全部设置/格式/附件/真实后台及旧数据往返未完成验收 | RecordingFacade / WorkspaceStore |
| 全套UI一致性 | 原生新写的简化面板，未达到逐页面/子流程一致 | NativeChrome / MainActivity |

继续施工必须以原版features清单逐入口、子操作、对象样例和截图建立验收；保存原始文件或显示按钮均不得记为功能完成。旧完整应用保持可用，内核原型保留为开发验证材料。

> 2026-10-27：用户已明确授权“先备份之前的，然后重建，保证功能跟UI这些都完全还原”。备份已核验；现进入独立 Android 原生工程施工。下文全部功能保留是最终目标，尚未完成项不得冒充已还原。阶段状态见 progress-20261027.md。

# 原生 Android 功能保留清单草案

日期：2026-10-27。状态：源码/实际入口盘点，不代表原生功能已经实现或真机验收。

所有下列现有功能均属于最终迁移范围；阶段安排不是删减授权。施工第一阶段需补齐逐入口/子操作/存档样例/验收ID的细表，逐项标注“基线已有并通过”“已有但设备未验证”“仅历史代码”“平台专属”。

| 功能组 | 必须保留的主要行为 | 复用/迁移方式与证据 |
|---|---|---|
| 地图与图源 | 主图/双图、切换/收藏图源、天地图内置分类、用户图源、标准/高清/指定级别、坐标校正、缩放/旋转/俯仰与相机保持 | 图源定义和数据规则迁移；地图渲染与操作重接。`modules/map/TerrainMap.tsx`、`cartography/tianditu.ts`、`mapSources/`、`mapComparison/` |
| 地形与图层 | 真正DEM地形、已有地形补充、等高线/海拔着色、地质图层与图例、道路/地名层次、来源署名 | DEM资源可按原覆盖复用；采样/投影可移植，WebGL层重写。`terrain/`、`cartography/`、`geology/`。云/雨/温度等旧图层须单独核对当前入口；`map/types.ts`已拒绝部分退休字段，不能按weather目录存在认定当前启用 |
| 定位/记录 | 定位跟随、可靠运动方向、罗盘、记录/暂停/恢复/保存、后台锁屏、异常恢复、采样设置 | 现有Java服务与策略优先抽取复用，原生UI重写。`position/`、`outdoor/`、`RecordingService.java`、`RecordingStore.java`、`LocationFixPolicy.java` |
| 路线/导航 | 搜索、选点、途经点、已有在线/离线路由、导航进度/重规划、返航、视角调节保持跟随、路线显示与分享 | 服务协议和算法移植，导航状态机与UI重建。`navigation/`、`guidance/`、`offlineRouting/`、`returnHome/`、`routeAnalysis/` |
| 绘制/区域/测量 | 画线、吸附、节点/线段编辑、撤销/续画/草稿、区域、面积、测距及已保存对象 | 纯几何/约束与测试样例迁移，地图拾取与手势重写。`tracks/`、`areas/`、`measurement/`、`geometry/` |
| 标记/模型/照片/收藏 | 标记类型与属性、图案/颜色、提前显示名称、模型放置变换、遮挡、照片关联、目录/收藏/地区管理 | 对象schema与资源保留；Three.js/DOM标记与模型层需原生重写。相机/SAF/分享Java适配可复用。`annotations/`、`photos/`、`collections/`、`objectTransform/`、`modelTerrain/` |
| 剖面/专业地图操作 | 已启用剖面、测点/注记、地形剖面与投影、图表/导出、已有模型与地形关系 | 业务数学移植，原生地图层、图表与导出重新实现。`section/`、`config/features.ts`；不得把平面剖面图替代三维叠加行为 |
| 行业工具 | 实测剖面、钻孔柱状图、模板Excel导入、校验/审计、缩放浏览、SVG/PNG/ZIP输出与原始表格保存 | 公式、模板、参考输出保留；浏览器DOM/SVG测量和Canvas导出改为原生绘图管线。`industry/IndustryTools.tsx`、`engine.ts`、`projectStorage.ts`；实际开关为开启 |
| CAD/工程坐标 | 当前支持的DWG与ASCII DXF参考层、原文件/图层属性、工程CRS、显式轴序/单位、坐标交换 | DWG现用WebAssembly解码器，需验证原生库/JNI替代；不是原文件直接搬过去。保留20MiB/2万图元/10万顶点等既有范围。见`cad/README.md`、`coordinates/` |
| 文件/存档/缓存/设置 | 旧JSON、完整工程JSON、路线格式、二维码、外部打开、照片/附件/图源/行业文件、主题/布局、缓存选择/估算/暂停续传/仅缓存、恢复在线 | 格式/冲突规则保留，IndexedDB/localStorage迁移到原生数据库/文件。`dataTransfer/`、`files/`、`outdoor/`、`uiLayout/`、Android文件/缓存服务 |

## 兼容性细节

- 路线解析按当前`modules/dataTransfer/README.md`和`fileImport.ts`范围保留：GPX/KML/KMZ、OVKML/OVKMZ、已验证OVOBJ版本/奥维JSON、FIT/TCX、GeoJSON、CSV/TSV、DJI WPML已有子集。保留拒绝/告警行为，不升级为所有版本兼容承诺。
- CAD有独立导入入口；通用路线导入器拒绝DWG/DXF，不代表CAD模块不存在。迁移时保留两条语义不同的入口。
- 完整工程格式`shantu-workspace` v2、100MiB现有上限、ID/关联与版本校验保留；旧`guanyun-backup` v1继续可读。实际照片导出副本、图源、CAD原文件、行业工作簿、工程CRS和设置逐项比较。
- 完整工程JSON不等于所有设备数据的完整快照：瓦片缓存、未保存任务、未入库照片原片及其外部权限需另列迁移项目。不能用一次JSON导入宣称全部迁移完成。
- 图源缓存包、后台记录暂存、未保存草稿、系统文件URI/授权分别制定迁移方案；缓存可重建不等于可擅自删除用户离线包。
- 同ID覆盖/冲突重映射须沿用各入口原规则；完整工程同步和旧备份合并不是同一种行为。目标端独有数据、附件引用、原始坐标/时间分段不得丢失。

## 可复用资产与必须重写部分

可直接保留或经小幅适配：Logo/图标/纹理/模板、地形资源、接口约定、原始资料、参考结果、部分Java定位/记录/文件/相机/离线服务。现有31个Java文件不代表31项能力已在原生UI中验收。

需移植并复测：TypeScript几何/导航/数据校验/格式解析/行业公式、状态规则。现有测试作为输入输出参照，不按源代码行数估算直接复用比例。

需重做：React/CSS界面、WebView主入口、浏览器存储访问、MapLibre GL JS/Three.js自定义图层、DOM拾取/手势/截图与浏览器绘图导出。最终不留隐藏网页来完成这些用户流程。
