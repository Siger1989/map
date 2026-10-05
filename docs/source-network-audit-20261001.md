# 手机图源连接只读调查

用户反馈手机图源无法加载，并询问应用内绕过代理及图源要求。目标为已交付的 0.2.91 私有 APK；用户实际安装版本、失败图源名、错误提示、手机 VPN 状态及同机奥维对照尚待回复。本次未改业务源码、网络配置或原用户存储，未重新出包或公开上传。

应用尚无网络模式/绕过代理开关。普通导入图源经 WebView 同源 `/api/map-tile` 进入 LocalGateway，再由 MapTileProxy 创建 Socket、解析 DNS 并连接固定公网 IP；HTTPS 校验原域名证书。这里没有 HTTP CONNECT 代理实现，没有显式 Proxy.NO_PROXY，不能保证忽略任何全局 SOCKS 设置。天地图官方域名另走 WebView HTTPS 请求，不能把普通导入源结论套到它。

普通 Socket 不等于绕过 VPN。Android VPN 未开放 bypass 时，应用无法自行越过 VPN；支持按应用分流的 VPN 可排除 `com.guanyun.weather.shantu.preview`（山兔测试版），即交付包名。[Android 官方 VPN Builder 文档](https://developer.android.com/reference/android/net/VpnService.Builder)；[Proxy.NO_PROXY 文档](https://developer.android.com/reference/java/net/Proxy)。应用内可做普通代理模式或受系统许可的网络选择，不能承诺一键强制绕过任意 VPN。

当前原生限制：HTTP/HTTPS 与允许端口，DNS 完整结果须公网地址，HTTPS 证书有效，最多 3 跳且不允许 HTTPS 降级；GET、固定 User-Agent、没有供应方自定义 Cookie/Referer/请求头。响应 HTTP200、最多8MiB、总请求预算12秒；支持 PNG/JPEG/WebP/GIF/AVIF，内容实际格式须与响应 Content-Type 一致。供应方凭据、服务开放时间、区域与级别覆盖也必须满足；没有供应方账户/服务状态证据，不能断言欠费或限流。

两个候选差异：DNS 返回 198.18/15（例如某些代理 Fake-IP）会被地址规则拒绝；Android 要求 Content-Type 与真实图片一致，而 Node 预览仅按图片字节检测。二者已从源码确认，但是否导致该手机失败尚无证据，不擅自解除公网地址保护或放宽证书检查。

本机测试：按合集前3项模板，在公共成都测试点30.67/104.07、14级请求少量瓦片，使用固定公网 DNS 结果、原生同款 UA、不携带 Cookie/Referer。3项均超时，未取得 HTTP 状态或图片，不能判断 MIME、凭据或服务器自身是否可用；电脑测试也不代表手机网络。中间脚本曾有 Node lookup 回调 all 参数不兼容导致 ERR_INVALID_IP_ADDRESS，修正后重测的最终结果为 timeout；该脚本错误不算服务失败证据。私有模板/凭据只读本地忽略目录，结果无URL/Key，见 `.openai/source-network-audit.json`。

下一步先确定具体失败源和中文错误；同一手机/同网络/同源与奥维比较，并对照 VPN 排除山兔或临时关闭后的结果。扫码解析和图源预览通过，不等于瓦片已连通；0.2.91 的交付报告已记录此边界。
