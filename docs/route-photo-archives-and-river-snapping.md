# 路线照片、ZIP、中心准星与河流吸附（0.2.11）

## 使用

- 已保存的轨迹详情显示这条路线的照片，按拍摄时间排序。点缩略图查看照片；“添加照片”直接进入该路线的照片匹配页，结束行程后仍可追加。
- 路线“分享”中选择“保存 ZIP / 分享 ZIP”。压缩包包含带离线二维码的全程路线图、完整 GPX/KML、山兔路线 JSON、照片、照片清单 JSON 和 Excel。二维码概括线形时不修改原始路线文件；二维码本身不包含照片。GPX/JSON 保留已有原始时间、分段和海拔，KML 交换完整点线。
- 照片输出本应用现存的清晰副本（最长边2560px）；旧版只有预览的照片按预览输出并在清单注明。手机原片仍留在相册，没有被应用长期保存。照片清单保留原始名称、WGS84坐标、时间、海拔来源、备注、旋转和画笔数据；JPEG为导入时的副本。
- 收藏“多选 → 分享 / 导出”默认 ZIP，只打包勾选内容。包内 JSON 保留模型形状、变换、属性、区域和剖面参数，Excel按对象分表；每条路线的子目录附路线图和照片。模型通过山兔 JSON 恢复，通用 GPX/KML只表示其支持的点线，并非三维网格交换格式。解压后可分别导入JSON/GPX/KML及照片；本版未增加直接导入ZIP。
- 单个地点/模型编辑栏新增“导出”。地图中心常驻小准星，右侧“标记”先选择地点、模型或区域，再在准星下的地面位置创建。绘制和模型调整等专用模式会收起按钮。后续追加的框选、密集收藏、位置第一页、Excel、沿线绿点和图源库见[完整追加说明](collections-selection-and-map-library.md)。
- 参数编辑与地图变换浮窗分开；输入时保留分组和“完成输入”，参数区内部滚动。键盘弹出时允许编辑面板使用更多剩余视口（最多320px），输入框至少44px，收起视角摇杆；完成输入后恢复普通38dvh布局。
- 等高线按真实高度着色；海拔填色保留主要颜色节点，每50米细分一档。缩放仍决定实际等高距（500/200/100/50米），不会虚构更精细的地形。
- “画线 → 更多吸附 → 河流吸附”默认关闭，位置在普通吸附和线条样式之后。开启后与道路吸附互斥，只读当前地图已加载的河流、溪流、运河中心线；保留转弯和连通路径。没有线数据或水系断开时不自动连直线，需放大、移动准星或关闭吸附后手动连接。不是水文调查结果或通航保证。

## 模块和接口

| 模块 / 入口 | 职责与依赖 |
| --- | --- |
| `modules/files/archive.ts` | 顺序读取Blob、分块ZIP构建；校验路径/重复名称/大小，支持取消；依赖fflate |
| `modules/files/nativeArchive.ts`、`delivery.ts` | 192KiB消息传输大ZIP，通过窄桥接完成保存/分享；普通文件保持旧接口 |
| `modules/routeShare/archive.ts`、`RouteShare.tsx` | 路线图片与GPS/照片包，复用独立地图和QR生成，不移动用户地图 |
| `modules/photos/trackPhotos.ts`、`TrackPhotoGallery.tsx` | 用稳定轨迹ID关联现有照片；不按相近地点或同名猜归属；经props接入TrackPanel/SharedTrackDetails |
| `modules/collections/archive.ts`、`CollectionsPanel.tsx` | 仅勾选对象导出；经公开catalog/transfer/照片接口组织子目录 |
| `modules/map/CenterCursor.tsx`、`TerrainMap.tsx` | 公开`centerCoordinate`投影取得准星地面坐标，交给原标记新增接口 |
| `modules/annotations/AnnotationPanel.tsx` / CSS | 单条导出与输入模式；app通过props切换收藏导出，编辑时不重复显示ObjectGizmo |
| `modules/terrain/elevationColors.ts`、`terrain.ts` | 50米颜色阶与线颜色表达式；图例/图层说明同步 |
| `modules/tracks/riverSnapping.ts`、`map/roadSnap.ts` | 按水系类别过滤矢量；复用可见网络路径，缓存键区分道路/河流 |
| `TrackDrawing`、`DrawingSession`、`useManualTracks` | 默认关闭开关、互斥状态、严格连通性、中文提示；原道路跨断路行为保留 |
| Android `ArchiveTransfer` / `ArchiveOutput` | 单会话随机token、顺序/大小校验、ZIP完整目录检查、取消清理；私有缓存不接受外部路径 |
| Android `AppFiles` / `RouteShareProvider` / `NativeBridge` | 后台流式写入系统文档；只读临时授权分享ZIP；原图片/GPX/XLSX接口继续可用 |

压缩包最大256MiB（输入预留目录空间）；超限明确报错并要求分批，不静默删照片。照片存储本身仍为200张/200MiB。导出时先生成完整文件再调系统选择器，页面“已请求”不代表用户已完成保存/发送。

没有删除业务功能。原轨迹坐标与时间、照片存储库、定位/天气/相机、剖面采样、模型地形求交、应用包名和签名格式未更改。回滚本轮提交可恢复旧界面和输出能力，不需要数据迁移。

## 验证

- 281项逻辑回归、类型、网页和Android编译/打包；新增ZIP内容/真实时间海拔/照片隔离/取消/大文件分块、50米相邻色阶与河流连通性测试。
- `tests/android/ArchiveTransferCheck.java` 独立验证9MiB输出、UTF-8文件名、乱序/大小/路径/未完成/取消，不替代Android系统选择器真机测试。
- 通过真实UI导入带时间路线、追加两张EXIF照片，详情显示并导出ZIP。实际解压CRC、2张照片、4个有时间海拔的GPX点、XLSX、1200×2670路线图通过；从图中二维码还原4点通过。收藏多选ZIP实际只含勾选的一个模型与一条照片轨迹。
- 390×844、360×780、模拟键盘剩余390×450/360×430检查；输入可见、无横向溢出。成都锦江实景3个操作点生成429米沿河曲线并保存；山区每级着色无渲染错误。截图`artifacts/screenshots/*0211*`。
- 无连接OPPO X8 Ultra，真机镜头/触控/闪烁/定位精度及系统分享仍待安装验证。HarmonyOS6.1原生未交付，缺工具链与账号签名。
