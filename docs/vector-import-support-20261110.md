# 当前矢量与地理文件导入范围（2026-11-10源码核对）

仅声明界面已接线和解析器已实现范围，不把库内类/底图能显示矢量当作用户文件支持。手机已装版本未读取；下列入口已在当前私人预览实际打开，未在本轮导入新的矢量样例。

## 操作入口

- 普通地理文件：底部收藏→导入（按钮名“导入收藏文件”）→路线、轨迹与备份→选择路线 / 收藏文件→选择文件→校验预览→确认导入并显示。
- CAD：同一导入页向下展开“CAD 导入 / 参考图层 / 转可编辑对象”→选择 DWG / DXF→按原文件核对坐标系/轴序/单位→转换并预览坐标→保存参考图层并查看。米对米比例1、毫米对米0.001；地方独立坐标须先配准，不能随意猜WGS84。CAD上限20MiB。
- 照片：工具→照片标记→导入照片，属于EXIF GPS照片标记流程，不是GIS矢量文件入口。

## 实际支持与限制

| 格式 | 已实现范围 |
|---|---|
| GPX | 航点、路线、轨迹及可解析的时间/高程 |
| KML / KMZ、OVKML / OVKMZ | 点、线；KML面/NetworkLink/dynamic Track明确拒绝。KMZ中须有可识别的单KML或OVKML；无人机waylines.wpml只读航点连线、不读飞行指令 |
| GeoJSON | 点、多点、线、多线、几何集合和无内洞的面；CRS仅CRS84/EPSG:4326/WGS84 |
| CSV / TSV | 必须有可识别的经纬度表头，按WGS84读取，不猜无表头X/Y |
| TCX / FIT | 有限活动/路线/course轨迹点解析，不是通用GIS图层 |
| OVJSN / OVOBJ | 奥维已识别结构；OVOBJ仅v105部分点线面，并非所有版本/对象 |
| JSON | 按GeoJSON/OVJSN/山兔备份结构识别，不支持任意JSON |
| DWG / ASCII DXF | 单独CAD入口，常见二维图元子集，未支持实体可能告警跳过；二进制DXF拒绝 |

SHP/DBF、GPKG目前无通用导入支持。MBTiles只接PNG/JPEG/WebP栅格，PBF矢量瓦片明确拒绝；在线矢量TileJSON/Style JSON不支持。TIFF/GeoTIFF为影像，OVMAP为图源配置，不能据此称支持用户矢量瓦片包。

## 源码依据

- modules/collections/FavoritesImportPanel.tsx、WorkbenchPanel.tsx；modules/dataTransfer/TransferPanel.tsx（文件选择accept与确认按钮）
- modules/dataTransfer/geoJsonImport.ts、xmlImport.ts、fileImport.ts、fileFormat.ts、csvImport.ts、oviJsonImport.ts、ovobjImport.ts
- modules/cad/CadPanel.tsx、decoder.ts、types.ts
- modules/mapSources/mbtiles.ts、online.ts、MapSourceLayer.ts

Android外部分享/打开入口白名单与应用内picker不同；DWG/DXF应从应用内CAD入口选择，不承诺所有文件管理器直接“用山兔打开”。
