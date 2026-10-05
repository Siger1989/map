# 山兔0.2.94本地私有APK

用户明确“打包发我手机”。版本0.2.94-test/code101，包名com.guanyun.weather.shantu.preview，原证书SHA256 4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f保持。包含移除右侧坐标浮框与显示开关、任务期间隐藏未锁定的隐藏UI入口；普通浏览恢复，已锁定保留解锁。双图完整图层、紧凑标记、二维码兼容及37项授权图源/本机天地图配置继续保留。

PASS：Luna定向36/36、tsc与diff检查；网页及Android构建、v2/v3原签名、manifest和zipalign；552项ZIP CRC，544网页资源/dex与最终stage一致、496地形PNG像素/元数据保持，473主地形瓦片存在；37项私有seed与本机Key一致。最终包内版本0.2.94存在，当前位置坐标/底部定位坐标UI不存在。任务行为的实际浏览器证据见docs/task-ui-20261001.md。Android真机覆盖安装、任务编辑触控、GPS记录/导航/后台及远端图源仍待验；无HarmonyOS原生包。

产物APK/Shantu-0.2.94-test-standalone.apk，57,892,016字节；SHA256 26286d6cc3169971fdfcf9d01c76c578644cc1ade9a2b4a63b9ff8511687ed15。同名.sha256已生成。stage mobile/.build/apk-20261001-113644。

构建：powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -SdkRoot D:\GodotAndroid\android-sdk -JdkRoot D:\GodotAndroid\jdk-17 -StandaloneTest -DefaultMapSources .openai/default-map-sources-private.json。

日志：.openai/apk-0294-final-build.log、apk-0294-signature.log、apk-0294-integrity.json、release-0294-typecheck.log、release-0294-tests.log；独立下载及CRC验证脚本apk-0294-download-verify.mjs。临时只提供本APK，绑定WLAN 192.168.0.201、随机路径、有效到2026-10-01 13:37:53中国时间，PID28636。完整HTTP响应SHA256等于APK，Range请求通过。链接元数据仅存.openai/apk-0294-phone-download.json；同局域网、电脑开机，不改防火墙/代理。

最初提供局域网链接；用户随后明确在外网，要求直接外网下载并保留全部Key/图源，授权本APK临时外网交付。使用官方cloudflared 2026.9.3可执行文件，下载SHA256与官方Release digest匹配；仅映射原随机路径单APK服务，没有目录或其他业务入口。首条转发因子进程HTTP_PROXY将内网origin转入代理返回Cloudflare1000；仅对子进程配置NO_PROXY本机IP后恢复，没有修改系统/Clash持久配置。旧隧道已关闭。

当前wrapperPid30308/tunnelPid15900，原localServerPid28636；与原文件服务一并在13:37:53截止，wrapper届时停止隧道。链接只记录.openai/apk-0294-public-download.json。本机经外网完整下载57,892,016字节，SHA256等于原APK；Luna直连外网HEAD200/MIME/长度、Range206/16字节、根路径404均PASS。下载校验.openai/apk-0294-public-verified.json。手机实际网络下载仍待用户验证。

没有上传Google Drive或公开GitHub Release，未提交/推送。分支codex/rollback-ui-0235-20260921，Git基线ec47ec0aa5f23cba6dfa2dd576197a82b6f34efe加本地修改；未核对远程、未合入main。保留已有数据和原签名，不卸载/清数据。
