# 山兔卫星云图集成预览 · 2026-10-03

用户要求把国家卫星气象中心云图集成进山兔。新增独立云图叠加层，保留现有底图/图源、地形、用户数据与相机；图层入口提供卫星云图开关，显示参数提供0–100%不透明度及最近24小时观测时次。显示北京时间及加载/错误状态；重启回到最新观测，不持久化历史时次。双图通过各自TerrainMap实例和状态回调独立管理。

## 数据与投影

- 时间列表：`https://data.nsmc.org.cn/nsmcapi/v1/nsmc/image/animation/datatime/mongodb`，产品`GEO_MULT_GBAL_L2_GGM_IRX_GLL_YYYYMMDD_HHmm_4000M.PNG`，返回UTC时次，支持浏览器CORS。
- 官方说明：[NSMC WMS](https://www.nsmc.org.cn/nsmc/cn/image/wms.html)；[能力文档](https://data.nsmc.org.cn/NSMCAPI/v1/nsmc/image/wms/ability?request=GetCapabilities)。官方文档顶部/能力文档称1.3.0，但GEOS_IRX示例使用1.1.0。本次经验证的请求使用1.1.0、经纬度bbox顺序。
- 请求全球`[-180,-90,180,90]`完整图，2048×1024优先，1024×512回退。单个小bbox经实测可能返回空白，故不依赖逐瓦片上游请求。复用既有受保护的图片传输通道，不放宽网络校验、不使用地图自动持久缓存。内存最多保留2帧，共享同帧并发请求，每档20秒超时；关闭图层取消瓦片消费者，共享全图请求可在超时内完成供其他消费者使用。
- 按实际全球地理范围裁切经度，按反墨卡托计算纬度采样，将地理图片转成地图所用的Web Mercator瓦片。每个地图注册独立协议，卸载时清理协议/源/图层/定时器；不调用相机方法。道路注记及用户对象继续显示于云图之上。
- 202610030600全球2048×1024请求返回1,376,098字节。上游Content-Type报JPEG，实际签名为PNG；既有代理按图片签名确认实际类型。白色RGB加透明度变化形成真实云形：空白检查需同时比较RGBA，不能只比较RGB。允许有效全球帧中局部瓦片完全透明，不能把这类瓦片当成服务失败。
- 元数据缓存2分钟，启用且页面可见时每10分钟刷新。每帧加载标明实际观测时间；这不是未来预报、降雨雷达或逐像素云高。2048概览经过缩采样，不宣称地图放大后仍有4公里分辨率。
- 当前能力文档Fees/AccessConstraints为none，接口免Key；这与开放源码或不限再分发授权不同。免费公开浏览能力不等同于商业再分发授权。

## 修改边界

新增`modules/weather/satelliteCloud.ts`、`SatelliteCloudLayer.ts`、`cloudProjection.ts`以及源/投影测试；修改LayerSettings和偏好序列化、TerrainMap生命周期、主页面状态、共享LayerPanel及主图/双图窗口、双图回调。沿用现有clouds布尔存储键，避免引入不兼容迁移。既有大量未提交改动保持原状；本轮未打包APK、升版本、提交或推送。

## 结果与证据

| 项目 | 结果 | 证据/边界 |
| --- | --- | --- |
| 官方图实际图像 | PASS | CLI直接请求及真实PNG签名、浏览器RGBA空间变化；国内直连接口实测成功 |
| TypeScript | PASS | `npx tsc --noEmit`，`.openai/cloud-types.log` |
| 定向测试 | PASS | 56/56：satellite-cloud/cloud-projection/map-layer-preferences/layer-window/map-comparison/map-instance-protocol |
| Android网页资源构建 | PASS | `npm run build:android:web`，`.openai/cloud-web-build.log`；不是APK |
| 主图加载/时间切换 | PASS | 浏览器14:00→13:00→最新实际观测标签；360宽页面加载15:00 |
| 云图开关/相机保持 | PASS | 关闭删除云图层；WebMCP读取中心、缩放、俯仰、朝向前后完全相同 |
| 不透明度 | PASS | UI Home/End与MapLibre实际paint值0/1；恢复0.55，相机不变 |
| 390×857、360×780布局 | PASS | 面板实测约248×480、border-box；360宽内容clientWidth=scrollWidth=228，无横向溢出，内容可滚动；关闭返回可达 |
| 视觉证据 | PASS | `artifacts/screenshots/satellite-cloud-390-20261003.jpg`、`satellite-cloud-360-20261003.jpg`、最终叠加截图；右侧预览为APK-preview模式，保留已有Key与图源种子 |
| 双图真实云图/真机 | 未验证 | 双图独立状态与开关由定向测试覆盖，尚未做两个实际MapLibre云图及Android触控、内存/网络验收 |

为展示云带，验收完成相机保持检查后，手动点缩小至约4级；不是图层自动改变视角。预览可伴随既有高程缺瓦片提示，不能将本轮云图成功等同于全部地形网络成功。当前0.2.104-test安装包不包含本轮云图；用户确认预览后再进入交付流程。
