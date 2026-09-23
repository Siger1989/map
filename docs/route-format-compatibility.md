# 路线文件兼容性核查（2026-09-23）

状态：已实现、验证并编入0.2.57-test/code64新APK；需覆盖安装此版后使用。不能承诺所有厂商的全部格式、版本与私有扩展。发行与下载见[0.2.57说明](release-0.2.57.md)。

## 已实现的读取器

| 格式 | 支持范围 | 主要限制 |
| --- | --- | --- |
| GPX | trk/trkseg、rte、wpt；轨迹时间/海拔 | 遵守现有点数与存储限制 |
| KML / KMZ | Placemark Point、LineString，多线保留分段 | 一个KML文档；不支持面、gx:Track、NetworkLink及所有附件/样式 |
| OVKML / OVKMZ | 标准KML点线 | 按奥维导出设置明确选择CGCS2000地理坐标或GCJ02 |
| OVOBJ | OviO v105中已验证的线、面和无名称点结构 | 非全版本；扩展属性、文件夹、其他对象结构尚未支持 |
| OVJSN | ObjItems的点7、线8、面13；对象级Gcj02坐标标志 | 文件夹和其他对象类型不支持；缺少坐标标志时须指定 |
| TCX | Activity/Course、Trackpoint、CoursePoint；时间海拔和分段 | GPS缺测断开，不跨缺测连线；不导入运动传感器 |
| FIT | activity/course、坐标、时间、海拔、course points | CRC/帧校验；暂停和缺测分段；不导入运动传感器 |
| GeoJSON | 点、多点、线、多线、单环面、多面、GeometryCollection | WGS84；带孔区域当前存储不能表示，整批拒绝 |
| CSV / TSV | 明确经度/纬度表头，名称、高程、时间、分段和点/线类型 | WGS84；逗号/分号/Tab；不猜无表头、XY、任意表格或投影 |
| 山兔/旧观云 JSON | guanyun-backup v1 | 兼容现有备份，不等于任意JSON |

单文件最多8MiB，批次最多10文件/32MiB，每条轨迹最多6000点/100段。本机已有对象数量上限仍适用。每个适配器返回统一Transfer，先整批校验，再由用户确认合并；失败不部分写入，不覆盖已有收藏。

PLT/WPT/RTE、SHP、GPKG、DXF/DWG、加密私有格式和服务端分享链接尚未适配。文件扩展名关联不等于能够解码全部内容。

## L013.ovobj：已直接解码并加载

用户桌面原文件858字节，OviO版本105，单对象类型8。实际解码74个点，水平折线总长5517.99米；浏览器完成文件选择、预览、确认、地图显示，卡片为“OVOBJ 导入路线 · 5.5 公里”。未要求用户先用奥维转换。

解析按头部/对象长度、版本、对象类型、名称、点数及坐标增量流顺序进行，要求精确消费到对象末尾，不扫描“看起来像经纬度”的字节。压缩坐标首点为纬度/经度int64×1e8；后续记录header高两位表示两个符号，bits5..2表示负载字节数n，低两位连接后续大端字节，两个幅值各占4n+1位。已用独立导出的线、面OVJSN逐点比较，在1e-8度导出精度上完全一致。

依据为作者公开的[配对样例](https://github.com/Fangster-1/ovkml-converter/tree/master/tests/fixtures)。没有复制或执行其启发式扫描解析器。测试仅保留小段压缩字节与对应事实坐标；公开完整样例和用户原文件不进入源码。用户文件只在本机读取和隔离localhost预览中验证，未上传转换网站。

已知布局：v105顶层kind31单对象、kind100对象列表；type8/body103线，type13/body104面；type7/body104只验证了固定长度101的无名称点。其他结构明确拒绝，不丢弃后假称导入完成。未验证头部私有校验算法，也未可靠解释原文件坐标基准/扩展高程字段。默认原坐标按WGS84预览并提示，可显式选择GCJ02转换；这不证明原始基准为WGS84。几何文件不伪造高程/时间；路线卡片可另外显示DEM估算爬升。

## 模块与验证

- fileFormat/fileImport负责字节识别、编码、压缩大小与路由；OVOBJ和FIT动态加载。独立ovobjImport、oviJsonImport、tcxImport、fitImport、geoJsonImport、csvImport经routeBuilder转为兼容存档。
- 新可选importFormat保留导入来源标签，source仍兼容旧存档；不迁移用户数据。预览坐标警告不写入存档。
- FIT使用MIT的fit-file-parser 6.1.2 raw入口，许可证随网页资源；通过[Garmin官方Activity.fit样例](https://github.com/garmin/fit-javascript-sdk/blob/main/test/data/Activity.fit)验证3601点与时间/高程，浏览器实际预览通过。
- 2026-09-23最终定向测试30项通过（raster-level、raster-coordinates、route-file-format、route-adapters、ovobj-import、route-composition-transfer、route-archive）；TypeScript、Android网页生产构建、全部Android Java源编译通过。构建仍有既有大chunk提示。
- 实际截图：artifacts/screenshots/20260923-ovobj-loaded-390.png；此前360窄屏导入入口、收藏入口和来源面板截图亦保存。浏览器验证不替代手机文件选择/微信关联/触控验收。
- 原生IncomingRoutes承接content URI VIEW/SEND，后台读取、8MiB限制、分块桥接、生命周期清理。已扩展格式和MIME；需要新APK后才能验收微信“其他应用打开”。

## 参考规范与后续边界

[奥维格式说明](https://www.ovital.com/139064-2/)、[奥维API](https://www.ovital.com/openapi/)没有提供本轮可直接嵌入手机的完整OVOBJ文件规范；桌面进程通信API不是文件解码库。[FIT协议](https://developer.garmin.com/fit/articles/fit-protocol/fit_protocol.html)、[GeoJSON RFC7946](https://www.rfc-editor.org/info/rfc7946/)用于标准格式解析。[Ozi格式](https://www.oziexplorer4.com/eng/help/fileformats.html)、[GDAL Shapefile](https://gdal.org/en/stable/drivers/vector/shapefile.html)、[DXF](https://gdal.org/en/stable/drivers/vector/dxf.html)可用于未来逐项适配；当前不冒充已经支持。
