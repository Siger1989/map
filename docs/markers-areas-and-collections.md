# 标记、区域、收藏与扫码轨迹（0.2.10）

## 使用

- 扫路线二维码或识别分享图片，点击载入后打开轨迹详情：全程地图、里程、爬升/下降、高程图、起终点名称及坐标。点击“导航”才选择驾车、骑行、步行；接入起点的模式与主体一致。扫码线形经过概括时明确显示尺度，高程沿概括线形估算，精确线形使用另附GPX/KML。
- 标记地点后直接进入信息页，优先更换18种简洁图标，再填名称和属性。属性左栏为字段名，右栏为具体数据，支持添加、删除、多行值；离开字段后记住模板，下一个标记或区域预填字段名，值保持空白。已有标记属性不会被新的模板覆盖。
- “导出 Excel 表格”生成真正的`.xlsx`，动态字段独立成列，坐标为数值；中文、多行、前导零和以`=`开头的文字保持原值。其他软件是否理解字段的业务含义仍由其导入映射决定，不能承诺任意软件均自动兼容。
- 收藏包含地点、模型、区域、剖面、收藏路线、已存轨迹；类型筛选、名称/省市搜索和省→市折叠列表帮助定位。路线按起点归类；自动行政区来自结构化地名服务，未取得时显示待归类，也可手动指定。原路线自定义分组保留在“分组”入口。
- 收藏点“多选”，勾选需要的对象，批量保存或系统分享山兔JSON/Excel。JSON完整保留已选模型、区域、属性和关联剖面测点；Excel以工作表列出对象、字段、线路逐点数据及区域边界。JSON可回到本软件导入，冲突编号会重分配并保留所属关系。
- 标记→划区域，地图逐点松手连接，可选道路吸附；闭合形成面。断路时允许直线跨越；自交、重叠边和退化轮廓拒绝保存并保留当前草稿。收起编辑后长按边界点拖动，松手保存，支持撤销。
- 标记→轮廓模型，或从区域编辑填拉伸高度→拉伸成模型；凹形轮廓保留，随后复用普通几何体的移动、旋转、宽/长/高和整体缩放。原区域保留并隐藏，仍可从收藏恢复编辑，拉伸模型是独立副本。
- 地表内模型默认开启“局部剖切地表”，可以关闭；亮黄色为模型与地形接触面，浅黄色为开挖侧壁。地表外穿入地形也能显示接触面。地下模型始终保留整体半透明透视，被地形挡住的部分也能看到，接触面单独高亮。
- 轨迹节点点一下出现选中圈，再按住圈直接拖动。原始实走及带时间记录仍需创建编辑副本，避免把采集坐标改成手绘数据。
- 划区域、绘制和轨迹编辑浮栏靠左收窄，给110px宽的右下视角摇杆额外保留12px空隙；360屏幕区域浮栏为222×100px，操作按钮保持44px。路线规划面板最多38dvh/320px，内容内部滚动。
- 剖面保存图片下方加入朝北俯视地图：剖面边框A—D、当前点P、保存测点编号及每个点的WGS84经纬度和海拔。垂直剖面上下角可能具有相同经纬度，编号组合显示，海拔仍分别列出。超过100行分页，每张保留图和对应坐标表，逐张点保存。
- 地质图层打开后，左下图例持续显示；图层窗口和图例均可选择世界概览/地质云1∶20万。未配置本应用授权时明确提示待连接。

## 模块及接口

| 模块 | 入口、职责和依赖 |
| --- | --- |
| annotations | `AnnotationIdentity.tsx`/`icons.ts`/`attributes.ts`管理图标、字段与模板；`spreadsheet.ts`转换表格；`footprint.ts`/`modelGeometry.ts`支持轮廓模型；`AnnotationLayer.ts`保留MapLibre定位类以修复名称漂移。|
| areas | `data.ts`闭合校验/面积/拖点；`useAreas.ts`独立存档与撤销；`AreaLayer.ts`显示，`AreaTools.tsx`编辑；`extrude.ts`经公开Annotation数据接口生成模型。绘制复用TrackDrawing、RoadSnapper，拖点复用FeatureDragBridge。|
| geometry | `polygon.ts`提供独立简单多边形有效性校验，拒绝交叉、接触和重叠轮廓。|
| modelTerrain | `geometry.ts`计算旋转实体的垂直区间与DEM接触网格；`terrainMask.ts`适配当前MapLibre6.7地形颜色通道；`ModelTerrainLayer.ts`生成局部裁切、接触面和侧壁。经Annotation/LayerSettings接口输入，不修改剖面工具或原始DEM。|
| collections | `catalog.ts`统一对象适配；`regions.ts`/`useRegions.ts`行政区缓存；`export.ts`生成选择集；`CollectionsPanel.tsx`紧凑分类与分享，`RouteCollectionsPanel.tsx`保留原路线分组。|
| files / Android | `files/spreadsheet.ts`生成标准OOXML工作簿，`delivery.ts`保存/分享；Android AppFiles/RouteOutput/RouteShareProvider扩大到受限JSON/XLSX二进制接口，最多8MB，只读URI，签名不变。|
| section | `profileMapData.ts`构造边框/测点坐标，`profileMap.ts`独立底图导出，`profileExport.ts`生成图片，`ProfileImagePages.tsx`逐页交付。地图必须加载成功，失败不会导出空底图冒充结果。|
| routeShare / tracks / guidance | `qrImport.ts`只导入轨迹；可选`sharedRoute`保存途经点、名称、模式和概括尺度；`SharedTrackDetails.tsx`展示行程信息；`savedRoute.ts`在显式导航时恢复检查点。反转同步反转途经点，改变几何时使失效元数据作废。|
| app / map / controls | `app/page.tsx`通过props组织选择、显示与动作，`TerrainMap.tsx`接入新图层，`FeatureDragBridge.ts`区分选中直接拖和长按；`LayerPanel.tsx`和图例可见条件修复地质入口。|

跨模块原因是同一地图对象需要绘制、编辑、存档及分享；各模块通过类型、props和导入事务协作，不直接读写其他模块内部状态。新增存储键为`shantu.areas.v1`、`shantu.collection-regions.v1`和`shantu.annotation-attributes.v1`，旧键保留。备份新增字段均可选；批量写失败回滚。回退前先导出JSON，旧版本不能编辑新增轮廓/区域类型，不应让旧版重新覆盖新存档。

本轮没有删除业务功能；旧收藏面板移动到单独路线分组入口，旧单图剖面下载函数替换成可分页输出。天气、GPS采集策略、照片原图、既有图源协议和Android签名未改变。

## 精度与验证边界

地形交界是每模型48×48网格的高度场近似减切，使用实际已加载DEM，缺失处不补零；它不是CAD精确实体布尔，也不表示真实地下岩层。网格间距随模型范围显示；细小凹口、陡边和复杂旋转受采样分辨率限制。缩放到10级以上且模型在视口附近时生成；当前最多80个标记。模型截面保留凹形，不用凸包填平凹口。

390×844和360×780检查、真实QR图片载入、生成剖面JPEG、独立openpyxl读取XLSX、区域吸附闭合与拉伸、轨迹圈拖动、地下裁切/关闭实景和地质源选项已验证。具体构建、APK签名和限制见[0.2.10发行说明](release-0.2.10-standalone.md)。桌面模拟不能替代OPPO X8 Ultra物理镜头、长按手感、闪烁和性能验收。

移动网页预览需同时运行网页API后端：`npm run dev -- --port 3108`，再运行移动Vite。`mobile/vite.config.ts`把`/api`代理到`http://localhost:3108`，可用`SHANTU_DEV_API_URL`指定实际后端；Android APK仍使用内置LocalGateway。
