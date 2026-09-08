# 密集收藏、标记位置、沿线标记与免费图源（0.2.11追加）

## 操作

收藏默认为约44dvh、最高360px的紧凑面板，条目44px高，内容内部滚动，地图仍可浏览。搜索名称/省市，类型下拉过滤；进入“多选”后可以全选当前结果、同省或同市全部条目。手指从左侧勾选栏开始滑动会连续勾选/取消，靠近上下边缘自动滚动；从正文滑动仍是普通滚动。删除先列出数量和名称供确认，确认后只删除所选对象。

右侧“框选”进入专用地图选择，拖出矩形后按实际相交关系选中完整标记、模型、区域、剖面和已显示的保存轨迹/路线；可以连续框选。轨迹跨过矩形也能命中，GPS断点之间不虚构连线。未显示的对象、尚未保存的绘制草稿不会被框选。选择完成后进入收藏复核，导出/分享ZIP。退出框选恢复地图手势。

标记使用不透明深底白字及双色边框，地形遮挡不再让文字淡到难辨。地点上限2000，三维模型单独上限80。右侧准星“标记”先打开种类选择，然后进入图标、名称和属性编辑，不再直接创建地点。

“信息”第一页在名称下显示位置：WGS84经纬度（6位小数）、地面海拔，以及国家、省/州、城市、区县、乡镇/街道、社区/村、附近道路。内容在第一页内部滚动；“调整坐标”跳到位置编辑。地区依赖Photon/OpenStreetMap附近地址，未提供字段显示“—”，没有海拔显示未取得；不把附近道路或兴趣点名称当城市。只刷新与当前坐标匹配的缓存，保留人工省市分类。地名服务使用当地名称，中国数据有中文时优先返回中文；旧自动拼音缓存重新查询。栅格图片内已印上的文字不能由应用直接改译。

Excel打开“标记与属性”第一张表，从A1起排、单元格左上对齐。列顺序为地名、经度、纬度、地面海拔、已选标记全部属性名的并集，然后备注、类型/图标/ID及地区等信息。无数据的属性留空，但表头与列位置保留。文本使用共享字符串兼容手机预览和Excel，编号前导零、形似公式的文字保留文本，坐标保留数值。导出包含已查到的地区；不为了导出强制查询所有点。

点击轨迹两节点之间的线段出现绿色预览点，原线不变；“添加标记”关联到这条行程，左侧里程条与沿线列表显示提示。关联用稳定轨迹ID和沿线距离，路线包带关联地点，导入冲突ID会一同改映射。真实GPS点的坐标、时间和海拔不因此改变。轨迹样式可设置0–90%透明度，选择节点仍清晰可见。

“图源”增加12个免Key公开栅格源：全球OSM、OpenTopoMap、NASA Blue Marble、地形/海底地形、2012夜光；美国USGS三项；日本GSI四项。逐项注明覆盖、时间、许可和署名，选择会记忆，切回应用默认地图可恢复原底图。这是当前核验的可用清单，不声称穷尽免费服务。OSM不提供离线批量预取，其他源也不因此获得额外许可或覆盖。

## 文件、接口和范围

| 模块/文件 | 职责和对外关系 |
| --- | --- |
| `collections/boxSelection.ts`、`MapBoxSelect.tsx`、`boxSelection.css` | 纯几何筛选与手势覆盖层；用catalog和公开屏幕投影，输出选中的对象键 |
| `collections/CollectionsPanel.tsx`、`collections.css`、`useSwipeSelection.ts` | 密集列表、分组/当前全选、指针捕获与边缘滚动；接收initialSelectedKeys |
| `collections/remove.ts` | 校验后批量写入，失败回滚；清理被删对象分类和已删轨迹的剩余地点关联，保留照片 |
| `annotations/AnnotationLocation.tsx`、`AnnotationIdentity.tsx`、`AnnotationPanel.tsx` | 可选位置槽和地区显示，跳转位置页；共享属性编辑器不强制区域显示该槽 |
| `annotations/AnnotationLayer.ts`、`annotations.css`、`data.ts`、`useAnnotations.ts` | 标签可读性、独立地点/模型上限与可选trackAnchor关联 |
| `collections/regions.ts`、`useRegions.ts`、`navigation/provider.ts` | 地区规范化、缓存与本地名称查询，人工分类不覆盖；取消过期请求 |
| `files/spreadsheet.ts`、`annotations/spreadsheet.ts`、`collections/export.ts` | 共享字符串XLSX编码、属性并集、空列占位、A1视图和地区列 |
| `tracks/linePoint.ts`、`TrackPointTools.tsx`、`TrackJourneyRail.tsx`、`trackPoints.css` | 沿线投影、临时点、关联标记和里程条；style/TrackLayer处理透明度 |
| `mapSources/presets.ts`、`FreeMapLibrary.tsx`、`useMapSources.ts` | 数据驱动图源清单、选择与现有导入/署名接口 |
| `controls/MapActions.tsx`、`modern.css`、`map/CenterCursor.tsx` | 唯一跟随按钮、定位设置、框选与标记选择入口、小圆角；areas/position CSS修正对比和布局 |
| `app/page.tsx`、`TerrainMap.tsx` | props连接地图、收藏、沿线标记和既有新增/分享接口 |
| `routeShare/*`、`collections/archive.ts`、`outdoor/exchange.ts` | JSON/GPX/KML/ZIP/XLSX带沿线标记，恢复时同步冲突ID |
| `scripts/build-version-summary.py`、`docs/images/*0211-360.png` | 可复现7页中文PDF，默认输出output/pdf；需ReportLab与中文TTF，可传--font |

新增上述独立位置/框选/删除/滑选/沿线/图源模块和测试，没有删除存档或业务模块；移除重复定位入口和直接创建地点的旧行为。跨模块修改用于把选择、导出与地图投影接通，经props和公开数据接口通信。原录制定位点、照片库、DEM采样、相机、温度计算、导航算法和Android包名/签名未改。原数据保持可读；整体回滚本次提交可恢复旧界面，但旧版本数量上限更低，应先导出新增大量地点，避免直接用旧版写回。

## 验证与限制

- 最终类型检查、292项全量逻辑、网页构建和Android APK构建通过。新增框选跨线/GPS断点、事务删除/回滚、500地点容量、共享字符串/空属性列，以及沿线点/所有者导入测试。
- 独立QA端口通过正式导入界面加入120个合成标记；成都市全选80、省全选120、滑选5项并滚动、只确认删除一个QA点通过。未修改用户9174/9175数据。
- 实际下载120点XLSX，以openpyxl独立读取验证中文、数值坐标、00000编号、空属性列、A1视图及左上对齐。真实路线ZIP/二维码/照片的验证见照片包说明。
- 390×844和360×780下没有横向溢出，44px条目和右侧标签边界通过；标记信息第一页实际查得四川省/成都市/玉林街道。框选一个可见地点后进入收藏选中一项通过。截图在artifacts/screenshots/，两张合成数据截图随PDF文档保存。
- 12图源各抽样一张实际瓦片，HTTP200、PNG/JPEG签名、CORS通过；不保证所有地区/时间持续在线。QA切换OSM/NASA并重新载入保持选择通过。
- 最终APK为55,109,183字节，SHA256见发行说明；525网页资源、473地形瓦片、470重压缩PNG解码一致，签名/CRC/zipalign通过。PDF7页逐页渲染目视通过。
- OPPO X8 Ultra不在连接设备中，模拟不能代替真实触控/相机/闪烁/定位/性能/分享验收。HarmonyOS6.1无可安装原生交付，仍缺工具链和账号签名。
