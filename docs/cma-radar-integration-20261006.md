# CMA 全国雷达实况图查看器接入记录（2026-10-06）

已接入中国气象数据网全国雷达拼图 `RAD__B0_CR`，以官方整幅 PNG 查看器展示，保留图内底图、南海插图、色标和署名。该图没有地理配准信息，功能**不是 MapLibre 地图叠加层**，不承诺图面位置对应地图坐标。

## 数据与请求链路

- 官方来源为[实时展示页](https://data.cma.cn/vis/live-data/401)：菜单 `menuId=401`、名称“全国雷达拼图”、`datacode=RAD__B0_CR`。目录接口按北京时间日期请求，应用将北京时间时次转换为 ISO UTC；列表按最新优先，首帧供“最新”展示。
- CMA 目录返回的 `fileURL` 是 HTTP。客户端先完整校验官方 host/path，再仅将 scheme 转成 HTTPS；不设置 HTTP fallback。`DataTransport.getRadarImage` 使用受限同域请求，未把接口扩展为任意 URL 代理。网络/失败响应由 viewer 的刷新状态处理。
- `cmaRadar` 前端、Node route、桌面预览和 Android `LocalGateway` 使用同源目录与图片 GET 流程。Node 日期缓存最多3个日期，Java 端最多2个日期；请求超时最多30秒。当前证据为 Node 3110 返回80帧，最新时次北京时间07:54；最新图 HTTP 200、929326字节、PNG签名有效。9174 预览至 3108 API 当前真实请求为200。
- 项目 JDK 17 harness 已编译仓库 `DataTransport.java` 并调用 `DataTransport.getRadarImage`，对官方目录中时次 `20261006073600` 的真实记录仅转换 scheme 为 HTTPS 后取图成功：PNG magic有效、929720字节。摘要在 `.openai/cma-native-harness/native-getRadarImage-20261006.log`。这是桌面 JVM 证据，不代表 Android 真机验收。
- 官方市场另列 `J.0019.0010.S001`“天气雷达组网组合反射率图像产品”，产品码 `RADA_L3_MST_V3_CREF_PNG`。详情页标注“免费试用7天”，但 API 参数要求使用“从订单中获取”的 `userId`、`pwd`，支持最近7天的 `getRadaFileByTimeRange` JSON 目录字段。未发现公开瓦片或CRS协议；该市场产品与现代展示 `RAD__B0_CR` 是否同源未证实。详情：[官方产品页](https://data.cma.cn/cmaOld/market/detail/code/J.0019.0010.S001.html)，抓取副本 `.openai/cma-source-20261006/market-detail-J0019.html`。

## 功能与主审验证

Viewer 展示 CMA、dBZ、有效时次；提供历史/最新切换、刷新、放大 portal 和90分钟 stale 状态。切换至雷达 viewer 时，地图雨层输入 `rainWeather=null`，不会将国外降雨源回退显示为国内雷达。

主审在 390×857 和 360×780 真实预览下验证：原图与图面信息、历史时次、刷新后历史选择保留、300% 放大后四边滚动均通过；Escape 只关闭 lightbox。双图上下 pane 的进入、关闭同步与退出通过。截图证据位于 `artifacts/screenshots/cma-radar-20261006/`。

受控 9182 检查中，注入样本首次使用的帧记录 `222048976` 对应 PNG 返回503，点击更新后再次请求同一真实官方记录，经代理取得 1349×1208 PNG 并可见，结果 PASS。该受控样本不代表 CMA 官方发生真实故障。

## 边界与未完成验收

PNG 没有地理配准元数据。正式产品页 [`J.0017.0010.S001`](https://k.data.cma.cn/mekb/?dataCode=J.0017.0010.S001&r=data%2Fdetail)公开0.01°分辨率，但没有 bbox、投影、像素到经纬度变换或瓦片方案。因此仅按原图查看，不推算地图位置或拼接成 XYZ/TMS。地图配准叠加仍未实现。

资料页的实名访问说明、市场产品的7天免费试用，均不能证明长期免费、再发布或公开 APP 嵌入许可。免费长期使用与公开嵌入授权尚未核实，不能据当前接口可访问性扩展为公开发行许可。

0.2.107-test/code114 私有 APK 已构建，签名及最终资源核验通过，详见 [交付记录](release-0.2.107-local.md)；Android 真机网络、触控与生命周期验收未完成。桌面预览和桌面 JVM 结果不替代设备验收。截图目录：`artifacts/screenshots/cma-radar-20261006/`。
