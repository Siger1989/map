# 数据交换

| 文件 / 对外接口 | 职责 | 依赖 |
| --- | --- | --- |
| `types.ts` / `Transfer`, `DATA_CHANGED` | 兼容v1备份模型与存档变更事件 | 各业务模块类型 |
| `validation.ts` / `validateTransfer` | 整包结构、数量、坐标、关联对象校验 | 业务模块验证器 |
| `storage.ts` / `collectData`, `mergeData` | 读取、ID冲突重映射、关联保留、一次事务写入及失败回滚 | 各模块存储键和纯验证/合并接口 |
| `xmlImport.ts` / `parseXml` | GPX/KML内容解码，拒绝外部实体和不支持的几何 | 验证器、轨迹样式交换 |
| `fileImport.ts` / `parseFile` | 文件大小和压缩包边界、内容识别 | fflate、XML/JSON解析 |
| `batchImport.ts` / `parseFiles` | 顺序校验最多10文件，在隔离内存合并，失败整批不写 | 文件解析、存档事务 |
| `xmlExport.ts` / `exportGPX`, `exportKML` | 标准文件序列化及山兔样式扩展 | 类型、样式交换 |
| `download.ts` / `saveFile` | 浏览器下载或Android系统保存桥 | 平台公开桥 |
| `TransferPanel.tsx` | 文件选择、拖入、预览、确认合并 | 上述公开接口 |

新消费者直接导入负责该工作的文件。`outdoor/exchange.ts` 只保留旧入口；不往兼容入口添加新逻辑。新格式只接入 fileImport/xmlImport 或新增格式适配文件，不改存储事务。

`mergeData(data, storage, notify)` 的第三个参数仅供隔离预览关闭事件；正常保存默认通知。批量预览不会写localStorage或让地图误以为数据已经保存；真正确认时才以当前本机数据重新合并。预览期间其他改动不会被旧快照覆盖。

当前OVKML/OVKMZ不直接导入：奥维官方说明可能使用GCJ02或CGCS2000，扩展名不足以判断。尚无用户样本/可靠元数据适配，拒绝自动猜测。见 [官方格式说明](https://www.ovital.com/139064-2/)。标准KML/GPX按其地理坐标语义处理；投影坐标越界明确拒绝。

存储键、v1格式与原事务校验保持兼容。Android平台能力仍由原桥承接，不依赖浏览器界面对象。
