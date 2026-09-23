# 数据交换

| 文件 / 对外接口 | 职责 | 依赖 |
| --- | --- | --- |
| `types.ts` / `Transfer`, `DATA_CHANGED` | 兼容v1备份模型与存档变更事件 | 各业务模块类型 |
| `validation.ts` / `validateTransfer` | 整包结构、数量、坐标、关联对象校验 | 业务模块验证器 |
| `storage.ts` / `collectData`, `mergeData` | 读取、ID冲突重映射、关联保留、一次事务写入及失败回滚 | 各模块存储键和纯验证/合并接口 |
| `xmlImport.ts` / `parseXml` | GPX/KML内容解码，拒绝外部实体和不支持的几何 | 验证器、轨迹样式交换 |
| `fileImport.ts` / `parseFile` | 文件大小和压缩包边界、内容识别 | fflate、XML/JSON解析 |
| `fileFormat.ts` | 私有二进制/压缩包识别、文本编码与不支持格式提示 | 无平台依赖 |
| `routeBuilder.ts` | 新格式统一点/线/面、样本、来源标签与存档校验 | 业务模型，不改存储事务 |
| `ovobjImport.ts` / `oviJsonImport.ts` | 已验证OviO v105结构、奥维ObjItems | 坐标适配、routeBuilder |
| `fitImport.ts` / `tcxImport.ts` | 运动路线、时间/海拔、暂停/缺测分段 | fit-file-parser/raw、XML DOM |
| `geoJsonImport.ts` / `csvImport.ts` | WGS84矢量与显式表头经纬度表格 | routeBuilder |
| `batchImport.ts` / `parseFiles` | 顺序校验最多10文件，在隔离内存合并，失败整批不写 | 文件解析、存档事务 |
| `xmlExport.ts` / `exportGPX`, `exportKML` | 标准文件序列化及山兔样式扩展 | 类型、样式交换 |
| `download.ts` / `saveFile` | 浏览器下载或Android系统保存桥 | 平台公开桥 |
| `TransferPanel.tsx` | 文件选择、拖入、预览、确认合并 | 上述公开接口 |

新消费者直接导入负责该工作的文件。`outdoor/exchange.ts` 只保留旧入口；不往兼容入口添加新逻辑。新格式只接入 fileImport/xmlImport 或新增格式适配文件，不改存储事务。

`mergeData(data, storage, notify)` 的第三个参数仅供隔离预览关闭事件；正常保存默认通知。批量预览不会写localStorage或让地图误以为数据已经保存；真正确认时才以当前本机数据重新合并。预览期间其他改动不会被旧快照覆盖。

0.2.28支持OVKML/OVKMZ内标准KML点线，和GPX/KML/KMZ/JSON一起整批校验。`coordinateSystem.ts`隔离坐标转换：用户按奥维导出设置明确选择CGCS2000地理坐标或GCJ02；未知拒绝导入，不从数值或扩展名猜测。同一批奥维文件必须同坐标系。标准GPX/KML不受该选项影响；投影坐标需先转换。GCJ02使用coordtransform 2.1.2的近似转换，MIT许可随包携带，非测绘级坐标转换。浏览器已验证构造的OVKML/OVKMZ样例，尚无用户原生奥维文件验收。见[奥维官方说明](https://www.ovital.com/139064-2/)。

存储键、v1格式与原事务校验保持兼容。Android平台能力仍由原桥承接，不依赖浏览器界面对象。

2026-09-23：入口改为路线与收藏的共享RouteImportDialog，支持确认后地图显示；记录首页不再承担导入。新增OVOBJ已知v105对象、OVJSN、FIT、TCX、GeoJSON、CSV/TSV真实读取器。L013.ovobj已直接显示74点/约5.52km路线，不再只是错误分类；未声明私有全版本兼容。Android IncomingRoutes以临时文件桥承接VIEW/SEND，仍需新版APK/微信真机验收。格式范围、坐标基准限制和测试证据详见[兼容性核查](../../docs/route-format-compatibility.md)。
