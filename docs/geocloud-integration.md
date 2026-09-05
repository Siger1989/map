# 地质云 1∶20 万接入

更新：2026-09-05。**授权适配代码已加入，当前尚未取得真实 1∶20 万瓦片，不代表已完成数据升级。**

## 本次实际查到什么

- 新版[地质云门户](https://geocloud.cgs.gov.cn/)公开前端使用 `/igss/` 地图网关，解析 WMTS / WMS 元数据后加载地图。
- 历史 1∶20 万服务标识为 `qg20_20210401_FCnDDRJd`。候选地址：

  `https://geocloud.cgs.gov.cn/igss/igs/rest/ogc/qg20_20210401_FCnDDRJd/WMTSServer`

- 本次对该地址发起无 Token 的 `GetCapabilities` 请求，返回 HTTP 200、29 字节文本“Token失效，请重新登录”。这只能证明到达授权网关，不能证明该历史服务仍存在、比例尺正确或具体地区有数据。
- 旧教程中的 `https://igss.cgs.gov.cn/admin/token/service/index.jsp` 返回 404，不能再当成验证有效的授权入口。将同一路径搬到新版网关也只返回门户 HTML，没有得到授权管理页。
- 门户自己的临时地图会话不等于第三方应用授权；本实现不借用门户身份或其他人的 Token。

## 需要的授权信息

通过本人/本应用的地质云账号，取得 **1∶20 万地质图地图服务的 Token 和当前服务标识**。入口以[地质云当前门户](https://geocloud.cgs.gov.cn/)显示的服务授权流程为准；若个人账号不提供服务授权，需要向提供方确认接入方式。开发者资料与商业软件用途应如实填写。

这是地图服务授权，不是网站登录密码。普通使用软件的用户无需每人注册地质云；是否允许开发者代理向付费用户提供图层，取决于所申请的服务权限及条款。目前未确认商用再分发许可。

## 本地配置

1. 项目根目录 `.env.local` 已准备空白配置；可参考 `config/geocloud.env.example`。将获授权的值填写到下面三项，**不要把 Token 放入前端代码或聊天记录**：

   ```dotenv
   GEOCLOUD_TOKEN=本人申请的地图服务Token
   GEOCLOUD_SERVICE=授权页面给出的当前服务标识
   GEOCLOUD_LAYER=
   ```

2. `GEOCLOUD_LAYER` 留空时按元数据选择 1∶20 万地质图；有多个图层且无法自动识别时，填入获授权图层的 Identifier。
3. 重新启动 `npm run dev` 以载入环境变量。
4. 打开地质投射，在地图外置图例选择“1∶20 万 · 地质云”，点击“重新连接”。只有元数据确认比例尺、图层加载完成后，状态才显示已连接。

不配置 Token 时，API 返回 503 和明确说明；过期授权包括上游 HTTP 200 的错误文本，统一识别为 401。切回“世界概览”仍可使用原有图层，两个图源的图例不会混用。

## 适配能力与边界

- 根据 WMTS Capabilities 的 TileMatrixSet、Identifier、原点、分辨率、轴顺序和覆盖范围读取瓦片，不把地图 zoom 直接当成源级别。
- 支持 EPSG:3857/900913、EPSG:4326/4490、CRS84 矩阵；经纬度瓦片按逐行纬度换算为当前 MapLibre 的墨卡托瓦片，再贴到三维地形。
- 优先 PNG，支持 JPEG；有额外维度或不支持的坐标系时明确拒绝，避免错位。
- 源元数据须确认是 1∶20 万地质图；不会以 1∶50 万或水文地质专题替代。模板历史服务名不构成比例尺验证依据。
- 只从原始服务加载图例；若服务没有提供 LegendURL，不从颜色猜岩性。当前接入为栅格投射，尚未添加图斑岩性点选，原概览图的点选仍保留。
- Token 仅在服务端使用，不下发给浏览器；代理固定到官方地图网关，禁止调用者传入任意上游 URL，不跟随带凭证的重定向。
- 瓦片只保留最多 32 张浏览器内存缓存，没有打包全国离线数据或设立永久公共缓存。
- 目前真实 Capabilities、实际图例、成都/川西实图和手机性能仍待有效服务授权后验证。

## 模块与验证

`modules/geology/geocloud/capabilities.ts` 解析元数据；`projection.ts` 计算矩阵映射；`server.ts` 负责授权与固定代理；`GeocloudLayer.ts` 管理栅格加载和释放。入口为 `app/api/geology/geocloud/route.ts`，地质控制器通过配置和 GeologyState 通信。`fast-xml-parser` 用于标准 XML 解析。

检查命令：

```sh
npx tsc --noEmit
node --experimental-strip-types --test tests/weather.test.mjs tests/geology.test.mjs tests/geocloud.test.mjs
npm run build
```

自动测试使用合成 WMTS 协议样本验证轴顺序、成都坐标映射、相邻瓦片连续性、覆盖范围、错误比例尺/授权、Token 不泄露和切换竞态。这些测试不是实时 1∶20 万数据验收。当前网络实测只确认授权错误返回，不宣称实际图层已显示。

回滚时选择“世界概览”即可停用新适配器；天气、云雨、卫星、道路与地形算法未改，没有删除已有业务功能。

本轮检查结果：TypeScript 通过、14/14 自动测试通过、生产构建成功；本地首页与概览瓦片 200，新接口缺少 Token 时按预期返回 503。没有浏览器视觉验收。修改入口还包括 app/page.tsx、app/globals.css、modules/map/{types.ts,TerrainMap.tsx}、modules/controls/useMapTools.ts、modules/geology/{data.ts,GeologyLayer.ts,GeologyPanel.tsx}；新增 tests/geocloud.test.mjs 并扩展 tests/geology.test.mjs，package.json/package-lock.json 加入 XML 解析依赖。无业务功能删除。
