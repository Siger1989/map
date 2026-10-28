# 原生 Android 迁移缺口核查 · 2026-10-28

结论：当前仍有实质性功能缺口，不能把剩余工作统称为“只差模拟器或真机验收”。209项测试证明已有实现通过对应测试，不能证明原版全部功能已经迁移。

本次为只读源码审计，未修改业务代码、安装包或用户数据，也未重新构建/操作模拟器。核查原版实际入口、原生实现和宿主调用；不沿用10月27日原型阶段已经过时的占位表。以下行号对应当前未提交工作区，后续编辑可能变化。

## 已确认缺口与差异

| ID / 优先级 | 功能与当前缺口 | 原版依据 | 当前原生依据 |
|---|---|---|---|
| A01 / P0 | **旧v1备份冲突语义不一致**：原版同ID生成新ID保留副本；原生把v1包装为v2后按ID覆盖。v2工程同步的同ID覆盖是另一种已确认行为，不能混用 | `modules/dataTransfer/storage.ts:180`及关联重映射 | `data/WorkspaceStore.kt:406`的normalizeIncoming/normalizeLegacy，`:716`的mergeWorkspace，`:729`的mergeCore及mergeById |
| A02 / P0 | **定位箭头与真实方向/设备罗盘模式未接入**：能跟随相机，不等于有当前位置箭头、运动方向与设备朝向切换 | `modules/position/PositionLayer.ts`、`DirectionControl.tsx`、`useMotionHeading.ts` | `MainActivity.kt:1443`只保存Location、喂导航、移动相机；`:520`方向面板只有相机固定角度按钮；`map/NativeMapController.kt`无定位标记更新入口 |
| A03 / P0 | **离线地图下载能力缩减**：原版25万项/8GiB及前台下载服务；原生1.2万请求/512MiB、顺序下载并每项延迟100ms，Activity销毁会取消任务，尚无对应后台下载Service | `modules/outdoor/importedRouteDownload.ts:6-7`；`mobile/android/src/com/guanyun/weather/OfflineStore.java:14-16`、`OfflineDownloadService.java:58` | `map/NativeCachePlan.kt:10`、`NativeTileArchive.kt:79`、`NativeCacheManager.kt:79-108`；`ui/NativeCachePanel.kt:122`；`MainActivity.kt:1475`；Manifest只注册记录Service |
| A04 / P0 | **旧版实际数据与离线包迁入未闭环**：独立应用不会自动继承旧WebView存储/缓存；工程JSON手动导入存在，但旧瓦片包、未保存任务及平台URI授权不能由此自动恢复 | 旧IndexedDB/Cache Storage、`modules/dataTransfer`及既有完整工程说明 | `data/WorkspaceStore.kt:24-28`明确隔离；原生缓存为新`native-offline-tiles`目录；当前无旧缓存包导入入口。旧版数据仍保留，不代表已丢失 |
| A05 / P1 | **MBTiles、GeoTIFF/配准图片地图未迁**；现有沿线缓存功能不能代替这些文件图源 | `modules/mapSources/MapSourcesPanel.tsx:207,319,355,416` | `map/NativeMapSource.kt:142-144`明确只接受kind=online，离线文件格式拒绝 |
| A06 / P1 | **指定影像瓦片级别、道路/注记透明度未齐**；标准/高清已有，不能把高清当固定z级 | `modules/cartography/RasterLevelControl.tsx`、`RasterLevelLock.ts` | `MainActivity.kt:491-499`仅标准/高清；没有固定级别和对应透明度状态/操作 |
| A07 / P1 | **地质叠加、来源切换、岩性/断层/边界与图例/拾取未迁**；保存旧偏好字段不代表已画图层 | `app/page.tsx:2992`；`modules/geology/GeologyLayer.ts`、`GeologyPanel.tsx` | `MainActivity.kt:502-514`实际图层只有图源、地形、等高线和海拔着色；`WorkspaceStore.kt:642-654`只是设置校验 |
| A08 / P1 | **离线路网管理、离线A*道路规划和返航未迁**；已缓存底图不等于有离线路由 | `modules/offlineRouting/OfflineRoutingPanel.tsx`、`provider.ts`；`app/page.tsx:3421`的ReturnPanel | `ui/NativeRoutePanel.kt:132`调用在线NativeRoutePlanner；工具和缓存面板无离线路网包或返航接线 |
| A09 / P1 | **导航/路线显示不全**：原版第一人称/俯视模式、海拔/速度/坡度分色、图例、统计、路线高程图等未完整接入；均速仍显示固定“—” | `app/page.tsx:309,763`；`modules/routeDisplay/RouteDisplaySettings.tsx`、`RouteElevationProfile.tsx` | `ui/NativeNavigationPanel.kt:399,484`均速固定占位；原生轨迹渲染`MainActivity.kt:990-1000`只按整线颜色/线宽/透明度绘制，未按colorMode生成分色线段；旧route-display设置仅被校验保存 |
| A10 / P1 | **河流吸附未接数据；节点分叉/连线/合并/批量删点缺失**。单点移动/插入/删除、反向、撤销、自由手绘已有 | `modules/tracks/TrackPanel.tsx:503`、`TrackNodeTools.tsx:67`、`routeEdit.ts:149-271` | `ui/NativeDrawingPanel.kt:43`的onSnapRiver可选；MainActivity创建callbacks未传该项。节点面板只有逐点表单和单点操作，未接分叉/批量节点流程 |
| A11 / P1 | **标记图案实际呈现及钻孔标记不齐**：编辑器能存图案，pin renderer仍为通用点/标签；borehole缺新建/渲染 | `modules/annotations/data.ts:29`、`PinEditor.tsx:149` | `MainActivity.kt:596-618`；`map/NativeModelRenderer.kt:59-61,210-220`支持pin/box/sphere/cylinder/prism，其他kind拒绝 |
| A12 / P1 | **模型地形裁切/相交效果未迁**：两个开关可保存，但渲染器没有消费字段 | `modules/modelTerrain/ModelTerrainLayer.ts`、`geometry.ts:195-236` | `ui/NativeObjectEditor.kt:59-60`有开关；`map/NativeModelRenderer.kt`不读取terrainCut/terrainIntersection。普通模型与剖面平面求交是另一项已有实现 |
| A13 / P1 | **地图上的对象拖柄/平移/旋转/缩放未迁**；现为数值表单编辑 | `app/page.tsx:3813,3857`；`modules/objectTransform/ObjectGizmo.tsx` | `ui/NativeObjectEditor.kt:38-60`；`MainActivity.kt:1365-1390`打开编辑表单，无地图gizmo操作闭环 |
| A14 / P1 | **照片地图图层及完整批量照片流程未齐**：单张选取/拍摄、EXIF匹配、关联、查看/涂鸦已有，但地图缩略图与照片点未接入；未接原目录批量导入 | `modules/photos/PhotoLayer.ts`、`TrackPhotoGallery.tsx`、`PhotoPicker.tsx`及旧Android文件夹照片导入 | `MainActivity.kt:845-856`单URI照片导入；`:980-1030`绘制annotations/tracks/favorites/areas/measurements/CAD，无photos层 |
| A15 / P1 | **测量投影图、勘探测线/测站投影与原剖面图片导出不齐**。普通三维平面剖面和距离/面积几何已有 | `modules/measurement/ProjectionChart.tsx`；`app/page.tsx:2784`的SurveySectionPanel；`modules/section/SectionProfile.tsx:90`和profileExport.ts | `ui/NativeGeometryPanel.kt`只有点表/数值；`section/NativeSectionEngine.kt:30`显式拒绝survey；`MainActivity.kt:913`剖面导出只接JSON分享，没有原投影图件导出 |
| A16 / P1 | **原版相机摇杆与布局自定义未迁**：现在只有固定方向按钮，不能拖控件、编辑/导入导出布局 | `app/page.tsx:3080`的CameraGizmo；`app/layout.tsx:43`、`mobile/main.tsx:32`的LayoutCustomization | `MainActivity.kt:520-526`；`ui/HomeChrome.kt`固定LayoutParams；WorkspaceStore只保留旧layout设置，没有编辑器/应用层 |
| A17 / P1 | **外部“用山兔打开/分享给山兔”与KML导出未接入**；应用内主动选文件、向外分享和GPX/GeoJSON导出已有 | 旧`mobile/android/AndroidManifest.xml`含VIEW/SEND；`modules/dataTransfer/TransferPanel.tsx:333-338`实际KML导出 | 新Manifest只有MAIN/LAUNCHER；MainActivity无onNewIntent/外部文件intent分发；`data/NativeRouteFormats.kt:18`导出enum仅GPX/GEOJSON |
| A18 / P1 | **完整工程设置的保留与实际应用未对齐**：地图视角/图层/路线显示/记录等旧键可校验保存，但未逐项转换到原生运行配置 | 完整工程settings合同和原各模块设置 | `WorkspaceStore.kt:633-664`校验保存；`MainActivity.kt:304-315`读native-ui-v1偏好；`:1320-1323`导入后只刷新图源/照片/CAD/对象。部分主题和图源收藏会单独读取旧键，不代表全部设置已应用 |
| A19 / P2 | **行业工具操作页不齐**：模板/示例下载、主/详图切换、适宽至800%等缩放浏览未移植。两类图件生成、原工作簿入库和ZIP保存/分享已有 | `modules/industry/IndustryTools.tsx`的模板/示例、zoom和主/详图操作 | `ui/NativeIndustryPanel.kt:141-163`固定174dp主图ImageView，操作为导出/分享ZIP；`NativeIndustryBundle.kt`已有SVG/PNG/附表，不应把ZIP缺成没有导出。旧Android的单独SVG按钮本就受平台限制，不据此新增缺口 |
| A20 / P2 | **收藏地区归类编辑与批量对象变换未齐**；目录管理、多选、批量显隐/移动/分享/缓存/删除/撤销已有 | `modules/collections/WorkbenchPanel.tsx`、对象变换入口 | `ui/NativeCollectionPanel.kt:148-169,442-451`地区只读/筛选；`:315-355`批处理无地图变换/地区编辑动作 |
| A21 / P0 | **普通标记的山后遮挡规则未保留**：原生pin被设为不做深度测试、始终在顶层；不能据此符合原版“被山遮住的悬浮内容不显示/不可点击”规则 | `modules/annotations/AnnotationLayer.ts:271-284`的opacityWhenCovered、`annotations.css:158`；`modules/photos/PhotoLayer.ts:81`及`photos.css:113`；需同时复核2D恢复 | `map/NativeModelRenderer.kt:210-220`的renderPin明确设置`isDepthTest=false`和`isAlwaysOnTop=true`；这是源码差异，本次未运行地图验证实际遮挡 |

原生路径在表中省略统一前缀`mobile-native/app/src/main/java/com/shantu/nativeapp/`。P0/P1/P2只表示施工顺序，全部仍属于已确认保留范围。

## 已有实现，应列为待验而非“未迁移”

- 内置私人天地图、自定义在线图源/公共库与管理、标准/高清、原DEM资源、等高线/海拔着色。
- 名称/坐标搜索、在线道路规划/导航状态机、路线接回、起终点/途经点、导航采样设置与记录服务。
- 双图、框选、自由手绘/草稿、基础节点编辑、区域与测量核心、基础模型数值编辑与普通三维剖面。
- 原生收藏管理、照片单张导入/拍摄与关联、扫码路线/图源。
- GPX、KML/KMZ、OVKML/OVKMZ、TCX、FIT、CSV/TSV、GeoJSON及已声明奥维/WPML子集读取；不能把没有独立TCX文件误判为没实现TCX。
- v1/v2 JSON读取、原生原子存储、ASCII DXF与WGS84/Web Mercator源CRS选择；它们与上表冲突语义/更丰富工程投影缺口分别记录。
- 行业普通剖面/钻孔和整合钻孔v2/v3校验/渲染、ZIP导出/分享；主色/深浅色等个性化已有。

这些代码已有对应测试或入口，但10月28日最终候选未成功安装启动，因此全UI点击/返回、双图同步、实际离线持久化、真实GPS/后台、相机与系统分享仍未验收。

## 处理顺序

先修A01的数据冲突规则，补A02当前位置/方向、A03后台缓存及容量和A21普通标记遮挡，再落实旧数据/离线文件迁入；之后并行补地质/离线路由、完整绘制和专业模块。每组需补原版样例对照、主/双图操作和用户手机尺寸实测。修复模拟器不能代替上述实现工作；已有209项测试也不能替代新缺口的逐项验收。
