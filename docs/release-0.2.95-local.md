# 2026-10-01 / 0.2.95 加载优化私有APK手机测试

用户明确要求打包并带全部已加载地图。0.2.95-test/code102，com.guanyun.weather.shantu.preview，保持原4a94证书与v2/v3签名。包含此前两轮输入并发/在途共享、Worker重采样与Content-Length读取修复，以及38项私有图源、天地图本机配置和原地形资源。图源配置内置不代表已下载全部影像；Android连接池尚未实现，Node连接池仅用于预览。

PASS：tsc；28项定向27通过/1因未设JDK跳过，随后设置JDK补跑原生测试1/1通过；网页/Android构建、签名、552 ZIP CRC、544网页资源与dex对应stage、38项seed原字节和Key匹配、496地形PNG像素/元数据一致（473主地形瓦片）；本地完整下载哈希与Range通过。手机实际速度、覆盖升级、GPS及全部图源服务器可用性待用户验证。

APK/Shantu-0.2.95-test-standalone.apk，57,892,016字节，SHA256 0d12a48885943d157625b9667285f14c1e3798faafe474c60cb5c03869982ffd。stage mobile/.build/apk-20261001-160557。外网临时单APK随机路径，截止2026-10-01 18:06:50中国时间；链接仅存.openai/apk-0295-public-download.json，电脑需保持在线。未公开GitHub分发私有产物，未提交/推送；无鸿蒙原生包。
外网校验补记：Node直连完整下载55秒超时；使用当前本机代理完整下载成功，远端响应APK SHA256与本地产物一致。未更改系统代理。
