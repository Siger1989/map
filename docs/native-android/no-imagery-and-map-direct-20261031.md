# 最高有效影像保留与本机地图直连

2026-10-31。基于私人146/code153之后的未交付源码，保留前一轮双图、线条与等高线修改。本轮没有升版本、构建新APK、替换固定包、提交或推送；不启动模拟器，不操作Unreal，不清除用户数据。

## 用户要求

- 所有图源在区域最高有效级之后继续放大有效影像，不显示“此级别无影像”的白色提示瓦片。
- 本机预览的全部地图图源、地形和注记绕过VPN。
- 后续用户已明确“图标悬空”指手机APP的标记和模型，并补充点击困难；独立源码修复与验证见[标记贴地及点击报告](marker-ground-pick-20261031.md)，手机视觉仍未验收。

## 原因与方法

天地图同一区域12/14级返回有效JPEG，18级返回HTTP200、4769字节JPEG，内容是“此级别下，该区域无影像，请放大或缩小地图后再浏览”。只检查HTTP成功和图片能否解码，会把该提示图显示并缓存。该图片与用户截图外观相符；用户说明截图是其他图源，因此不把特定服务判为截图唯一来源。

共用缺图策略对所有在线影像源适用：204/404/410、服务声明的Bing no-tile、已确认提示图片的精确SHA256触发同源父层搜索，按最近有效层裁取当前瓦片对应区域，一次重采样到原图像尺寸。不会更换提供方、整体降低源上限、虚构高层细节，或用白色像素阈值误伤雪地/云层。401/403、超时与限流保持原错误语义。有效父图照常缓存，派生子图不冒充原始高清瓦片持久保存；历史错误条目逐项拒收，正常缓存保留。

网页路径包括普通WGS84、GCJ02/BD09校正输入、OVMAP独立图层和天地图共享加载器；主图、双图及固定细节复用这些链路。WGS84无重投影Worker开销。源初始元数据可能晚于setTiles返回，现监听sourcedata恢复被初始元数据覆盖的共用协议。父层裁取支持小数源像素，512px来源保留512px，不逐级转码。

原生共用BoundedTileNetwork识别上述确定缺图；TiandituImageFactory/NativeRasterImageFactory使用独立父瓦片身份，并保留取消、请求代次、投影、OVMAP细分与源minZoom。裁图用Matrix映射浮点源矩形；正常地图/固定级别复用该factory。没有改变原图源最大级别。

另发现本机私人预览浏览器直连天地图403，而本机请求同配置可成功；仅localhost私人APK预览改走现有本机瓦片网关。网关保留401/403/429/503与Retry-After，不能把鉴权和限流变成缺图回退。远端网页/原生地图配置不因此改写。

## 本机VPN配置

已保留VPN规则模式和隧道，按现有39个种子图源及地图/地形内置服务收集52个域名，增加DIRECT优先规则、系统代理旁路，并从fake-IP映射排除这些地图域名。只增加DIRECT规则不排除fake-IP，会使瓦片网关把198.18地址当非公网而拒绝。

运行规则52/52为DIRECT；实际必应瓦片连接链为DIRECT，天地图及地形探测也命中DIRECT；必应图像在右侧实际恢复。只验证了代表性服务的连接，没有逐个请求52个服务。不保证未来新导入的未知域名已经旁路；应按同一办法补入。

持久设置在本机Clash当前订阅的规则增强和合并配置、运行配置及Windows ProxyOverride；修改前备份保留在Clash本机配置目录（后缀bak-20261030-map-direct，系统代理备份map-preview-proxy-backup-20261030.json）。这些机器设置、辅助脚本、Key与运行日志均不进仓库。

## 修改范围

- 新增网页noImageryTile共用策略及无凭据错误图fixture；调整RasterCoordinates、ovmapTiles、tiandituLoader/Protocol、cachedTileTransport和本机map-tile-proxy。
- 新增原生NativeMissingTileFallback；调整BoundedTileNetwork、NativeMapController中影像factory与测试白名单。
- 相关Node/原生定向测试；目标包仍为私人146/code153，新源码尚未进入用户手机包。
- 未修改业务数据、签名、图源保存格式、绘制/导航/收藏语义、主双图相机契约。未实施图标悬空的猜测性高度调整。

## 验证与限制

| 项目 | 状态 | 证据 |
|---|---|---|
| 共用网页逻辑、OVMAP、缓存、代理、坐标调度 | 隔离PASS | 单并发93/93，`.openai/no-imagery-node-isolated-20261031.log`；与构建并行时曾出现64缓存命中断言53/64的时序失败，未改断言/生产超时，重负载下仍有这一测试限制 |
| 原生3个定向套件 | PASS | 46项，零失败/错误；`.openai/no-imagery-native3-20261031.log` |
| 真实占位JPEG识别、WGS84 18→17→16、蓝色象限、512px保留、跨10级小数裁切 | PASS | 独立浏览器页实际执行，生产RasterCoordinates与裁图函数，页面显示PASS |
| 全部地图域名VPN配置/代表连接 | PASS | 52条运行DIRECT；`.openai/map-direct.cjs` 本机检查，`artifacts/screenshots/phone-preview-all-map-direct-20261030.png` |
| TSC/私人网页构建 | PASS | `.openai/no-imagery-tsc-final2-20261031.log` / `no-imagery-web-final-20261031.log`；后续仅补强no-tile与非200错误状态的隔离分支，另跑定向逻辑检查 |
| 完整地图最高缩放实景、最新网关运行画面 | 未验证完成 | 独立实景检查遇到上游429，已停止；后续浏览器控制连接中断，不能把ready或空白截图当通过 |
| 手机实际视觉/触控/性能 | 未验证 | ADB没有设备；未开模拟器、未打新APK |
| 图标悬空 | 待定位 | 当前预览只看到俯视画面，尚无可确认悬空类型/平台的证据 |

已核对官方源最大级与过度放大规则，使用已有源上限和同源父层机制，不上调真实图源上限：

- [OpenMapTiles source maxzoom](https://openmaptiles.org/docs/terminology/maxzoom/)
- [Bing影像元数据与区域可用级别](https://learn.microsoft.com/en-us/bingmaps/rest-services/imagery/get-imagery-metadata)
- [Clash自定义规则](https://www.clashverge.dev/guide/rules.html)
- [Mihomo fake-IP排除](https://wiki.metacubex.one/config/dns/#fake-ip-filter)

下一步先恢复浏览器控制并确认实际预览中最高级/主双图/固定级三种状态；收到图标平台和类型后定位贴地与屏幕锚点。快速视觉门禁未闭环，不能据此出包或宣称全视觉通过。
