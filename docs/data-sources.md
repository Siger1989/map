# 免费数据与商业软件接入调查

核对日期：2026-09-05。目标是买断制天气/三维地图软件，普通用户无需分别注册数据商账号。数据许可免费、托管 API 免费、后台运行没有成本是三个不同的问题。下表中尚未接入的资源不代表已完成商业化替换。

## 可以优先使用的资源

| 用途 | 候选与官方依据 | 免费部分与接入条件 | 项目状态 |
|---|---|---|---|
| 道路、地名底图 | [OpenFreeMap](https://openfreemap.org/) | 公共实例免费、无需 Key，可商用；保留 OpenStreetMap/OpenMapTiles 等署名。无 SLA。它不等于路线规划或地名搜索 API。 | 当前已使用 |
| 全球天气 | [MET Norway 许可](https://docs.api.met.no/doc/License.html)、[服务条款](https://docs.api.met.no/doc/TermsOfService.html) | 数据采用 CC BY 4.0/NLOD，无商业排除；需应用身份、联系方式、署名、遵循缓存。全应用全部用户合计超过 20 请求/秒需另行协议，不能当成无限免费接口。 | 候选，未接入；未伪造联系方式调用 |
| 地表卫星底图 | [Sentinel-2 全球合成集合](https://stac.dataspace.copernicus.eu/v1/collections/sentinel-2-global-mosaics)、[Sentinel 数据法律声明](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice) | 10m 季度合成原始数据可免费使用和改编，须署名；开发端下载需 CDSE 凭证，加工和提供地图瓦片需存储/流量。季度合成不是当天卫星影像。 | 已验证成都相交的 2026 Q2 产品目录；未下载影像 |
| 三维高程 | [Copernicus DEM 公开许可](https://documentation.dataspace.copernicus.eu/APIs/SentinelHub/Data/DEM/resources/license/License-COPDEM-30.pdf)、[数据说明](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) | GLO-30 公开原始数据可免费复制、改编和分发，须按许可署名；它是含建筑/植被的 DSM，不能承诺和 FABDEM 去建筑地面高程效果相同。托管服务另算。 | 候选，未替换成都 FABDEM |
| 路线规划 | [Valhalla](https://github.com/valhalla/valhalla) | MIT 路线引擎可商用；OSM 数据另遵守其许可。可自托管驾车/步行/骑行，服务器仍有成本，公共演示服务不等于无限生产接口。 | 已接入 FOSSGIS 公共 Valhalla 测试实例，支持驾车/步行/骑行；分段保留累计耗时，沿途天气尚未实现。正式分发需自有或有保障的后端 |
| 天气模型原始数据 | [ECMWF Open Data](https://www.ecmwf.int/en/forecasts/datasets/open-data) | 指定开放子集采用 CC BY 4.0，可商业复用；需解析、插值、缓存和分发，不代表所有 ECMWF 产品和交付方式免费。 | 长期候选 |
| 东亚卫星云观测 | [NOAA Himawari 开放数据](https://registry.opendata.aws/noaa-himawari/) | 可取 Himawari 原始观测，需加工；二维云观测不能直接还原完整三维云体。 | 未接入 |

MET Norway 的[全球 Locationforecast](https://docs.api.met.no/doc/locationforecast/datamodel.html)在北欧/北极之外使用约 9km 的 ECMWF 预报。川西地形复杂，应显示模型分辨率、预报时间和缺失值，不能把它宣传为山谷实测天气。具体字段替换仍需适配和核验。

实际检索到的成都卫星候选：`Sentinel-2_mosaic_2026_Q2_48RVV_0_0`，覆盖 2026-04-01 至 2026-06-30，10m，RGB/NIR COG。仅确认 STAC 目录、范围和许可链接，未确认每个像素的无云情况。

## 1∶20 万地质图：已找到正式数据集，尚未取得图幅

本轮又查到新版地质云地图网关，并加入授权代理、WMTS 坐标转换及图源选择。当前没有有效服务 Token，仍未取得实际图幅；具体配置、历史服务标识的核验边界见 [地质云接入说明](geocloud-integration.md)。

**全国 1∶200 000 数字地质图（公开版）空间数据库（V1）**，李晨阳等，中国地质调查局发展研究中心/中国地质调查局创建，全国地质资料馆传播。

- [数据论文原文](https://cdn.sciengine.com/doi/pdfView/CE2BB536E72042599C39E7A55F5D5DBD)，DOI `10.12029/gc2019Z101`，2019 年发表。
- 论文记录 1163 幅图，约覆盖 72% 国土，约 90GB，含 MapGIS、ArcGIS（`.shp` 等）、原图栅格、属性库、图例和说明文档。原始资料年代 1957–1995；不能称为最新全国实测全覆盖。
- 数据 DOI：`10.23650/data.A.2019.NGA120157.K1.1.1.V1`。
- [论文列出的官方数据详情入口](http://dcc.ngac.org.cn/geologicalData/rest/geologicalData/geologicalDataDetail/7d7ac63df9805f39a92591d105b7b0f2)：本次 HTTP 请求 502，HTTPS 连接失败，不能称已验证可下载。
- [地质云](https://geocloud.cgs.gov.cn/)：首页本机 HTTP 200；[中国地质调查局 2019 年公告](https://www.cgs.gov.cn/ywdt/ddyw/201910/t20191011_819002.html)确认上线 1∶20 万与 1∶25 万地质图合计 1264 幅。该合计包含两个比例尺，不等于 1264 幅全部为 1∶20 万。
- 2026-08-27，[官方另公布全国 1∶20 万地质空间网格化数据集完成登记](https://www.cgs.gov.cn/ywdt/dwdt/202608/t20260827_867396.html)。登记公告说明其存在，不是免费下载地址，也未授予收费软件再分发许可。

接入优先取成都及川西的矢量图幅，并连同图例、属性说明和坐标参考文件一起取得。具体地区覆盖和原始坐标需逐幅检查；不能从全国范围描述推断每个地点都有数据。取得可复用数据后，将地层面、断层线和属性转换为地图瓦片，贴到当前三维地形表面；浮窗从同一属性/颜色表生成说明。

目前能确认数据集存在且有公开服务记录；未取得具体图幅，未找到明确允许在收费 App 中向客户展示、缓存或分发的具体许可。不能把“公开版”直接解释为“不限用途商用”。如官方下载流程要求注册/申请，需使用真实开发者身份，核对该产品条款，不借用别人的 token 或转载网盘授权说明。

## 本轮已接入的地质概览

[Macrostrat 地质瓦片](https://tiles.macrostrat.org/)提供 CC BY 4.0 地图服务。中国区域本次实际返回图源是 Chorlton / Geological Survey of Canada，2007 年世界地质概览，[DOI 10.4095/223767](https://doi.org/10.4095/223767)。已加入独立开关、透明度、地图浮窗图例、地质单元点选，保留来源。它不是 1∶20 万数据，也不代表地下地层体积或现今活动断层监测。

另一候选 USGS `geo3al` **没有接入**：[官方目录](https://data.usgs.gov/datacatalog/data/USGS:60abc7f9d34ea221ce51e5ee)标记公共领域，但[原始 FGDC 元数据](https://www.sciencebase.gov/catalog/file/get/60abc7f9d34ea221ce51e5ee?f=__disk__8d%2Fb6%2Fc0%2F8db6c0b602ae57f8aaacfb088b6e33c4019de3e8)的 `useconst` 限制向第三方再分发。这个冲突尚未解决，不列作已获商用再分发授权的替代数据。此前只读目录得到的结论已纠正。

## 现有非商业资源尚未替换

EOX 2024 地表底图、成都 FABDEM V1-2，以及 Open-Meteo 免费 API 仍是原型当前来源。免费替代候选已找到，不等于整个应用已经可按当前数据组合销售。正常用户可只登录本软件；数据申请、缓存和服务器运行由开发端承担，联网可用性和第三方长期服务没有无限保证。
