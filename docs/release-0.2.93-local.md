# 山兔0.2.93本地私有APK

用户授权将新增双图图层打包交付。版本0.2.93-test / versionCode100，包名com.guanyun.weather.shantu.preview，原签名保留。产物APK/Shantu-0.2.93-test-standalone.apk；此前0.2.92的标记/双图编辑修复、紧凑单图图层、二维码兼容及用户授权图源配置继续保留。

双图顶栏新增图层入口，按上/下（横屏左/右）画面分别设置，复用单图完整LayerPanel与场景、显示参数。设置按画面与图源ID临时保留，互斥主题层按applyLayerPatch处理；选用时将该画面最终设置传回主图。菜单开关真实传入各自TerrainMap，不是仅改变按钮状态。248px宽、左8px；正常手机全量显示，矮屏/横屏正文滚动、标题固定且避让底部操作。见docs/comparison-layers-20261001.md。

验证PASS：tsc；双图/图层/偏好定向30项，0失败；最终网页与Android构建；ZIP CRC、zipalign、manifest、v2/v3签名与原证书一致。544项网页资源/dex与最终stage对应，496地形PNG像素与元数据保持、473主地形瓦片存在；37项私有seed与本机配置一致，天地图Key存在且匹配，不输出Key/私人地址。额外确认最终包内新增双图菜单文字及0.2.93版本。

浏览器视觉与关键点击沿用同一最终源码的390×857、360×780、390×480、857×390记录，详见双图报告及artifacts/screenshots/comparison-layers-*-20261001.jpg。Android真机覆盖安装、触控、远端图层加载、后台定位与性能未验；无新增网络绕过功能；无HarmonyOS原生HAP/APP产物。

大小57,892,016字节。SHA256：f778582116714d7f68ec89ce9579fe3bd8ab478b43d104a03f2dbdfb6d7fc9bd。校验文件APK/Shantu-0.2.93-test-standalone.sha256。最终stage mobile/.build/apk-20261001-101946。

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -SdkRoot 'D:\GodotAndroid\android-sdk' -JdkRoot 'D:\GodotAndroid\jdk-17' -StandaloneTest -DefaultMapSources .openai/default-map-sources-private.json
```

日志：.openai/apk-0293-final-build.log、apk-0293-integrity.json、apk-0293-signature.log、release-0293-tests.log、release-0293-typecheck.log。Luna独立执行定向测试与类型检查，主agent构建及最终产物核验。仅本地私有交付，未提交/推送或公开发布；分支codex/rollback-ui-0235-20260921，基线ec47ec0aa5f23cba6dfa2dd576197a82b6f34efe加本地改动，未核对远程或合入main。保留原预览/存档/签名；无需卸载或清数据，实际覆盖安装仍待手机验证。

手机交付使用只提供本APK的随机路径临时服务，绑定WLAN地址、两小时有效；下载响应字节与最终APK SHA256核对。需要与电脑相同局域网及电脑开机，不是公网链接，不修改代理/防火墙。
