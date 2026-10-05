# 2026-10-01 / 0.2.96 原生连接与分层加载私有APK

用户要求改善手机图源加载、保持全部地图，并补充奥维拉远时没有逐块补图感。本版0.2.96-test/code103/com.guanyun.weather.shantu.preview修原生MIME兼容、HTTP1连接复用/取消、独立底图与注记、256/512真实像素和4下载流水/2Worker；不是完成远景球面和三维渐变方案。完整原因及研究见docs/map-loading-overhaul-20261001.md。

PASS：tsc；78项主集成定向检查，随后新增注记层排序回归6/6（总79项覆盖）；主agent独立JDK17/--release8 MapTileProxyTest通过，实际TCP复用/服务器关闭后重连/150ms超时许可释放；真实browser Worker 256/512 × GCJ02/BD09各16坐标，最大色差0.48–0.50，输出尺寸与缓存/恢复正确。实际超强预览出图，旧截图斑块刷新后消失，但具体根因尚未断言。没有同手机奥维性能计时。

APK签名v2/v3与原4a94证书匹配；552 ZIP CRC、544网页资源/dex对应stage、38项seed原字节和天地图本机Key匹配，496地形PNG像素/元数据保持（473主地形瓦片）。本地完整下载哈希/Range验证通过；外网完整下载状态另补记。

APK/Shantu-0.2.96-test-standalone.apk，57,900,208字节，SHA256 b89d2bc33a9d9a4904db9e181b6fe4a1d2c4c042e414437197612b4243dc0980；stage mobile/.build/apk-20261001-173109。手机外网临时单APK链接仅存.openai/apk-0296-public-download.json，到2026-10-01 19:35:20北京时间截止。电脑需在线，未改系统代理/防火墙。APK含私有配置，未上传公开GitHub Release，未提交/推送，未合入main；无鸿蒙原生包。保护用户数据与原签名，覆盖安装及速度/触控/GPS真机验收待用户。
外网补验PASS：通过当前本机代理完整下载57,900,208字节，SHA256与本地APK完全一致。
