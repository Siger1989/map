# 山兔 0.2.92 本地私有 APK

用户授权把当前修改打包交付。最终源码重新构建为 `APK/Shantu-0.2.92-test-standalone.apk`，版本 `0.2.92-test` / versionCode 99，包名 `com.guanyun.weather.shantu.preview`，原测试签名保持，可用于同系列覆盖更新。

本包新增整套标记紧凑化与双图完整编辑器适配，主图竖屏编辑器220px、双图200px，贴左8px，主要控件28–32px、输入13px，保留完整菜单。双图删除后空宿主修复、0.2.91二维码兼容与此前UI修复保留。图层面板按规范改为248px宽、贴左8px，开关保留36px点击区、去掉大底板；显示参数和说明/场景默认折叠，原功能与数据来源说明完整保留。原统一主题及黄色关闭按钮保留。图源网络调查没有新增全局绕过代理选项。

验证：TypeScript通过，标记/双图/二维码/图源定向44项与图层定向9项全部通过、0失败；新staging网页与Android构建通过。最终APK签名v2/v3通过，证书SHA256与0.2.91及原系列一致，zipalign、manifest与ZIP CRC通过。544项网页资源及dex与最终stage一致，496张地形PNG像素过滤流/非IDAT元数据一致，473主地形瓦片存在。37项私有seed哈希一致，天地图Key存在且与本机配置一致；不输出Key/私有地址。

视觉证据使用同一最终UI源码：360/390宽和857×390双图，条目增删/原图案18项/删除后两图标记与宿主均0；360主图地点/长方体/全添加类型紧凑尺寸。图层390×857与360×780默认9个开关全量显示、无滚动；自定义图源状态8个开关全量显示；390×480矮屏保留正文滚动、固定标题与关闭按钮。实际点击验证开关、图源返回、道路透明度、等高线间距与场景预设。最终390截图确认图源按钮12px。见 `layer-ui-20261001.md`、`compact-marker-network-20261001.md` 与 `comparison-marker-fix-20261001.md`。其它主题/全部模型/旧列表及全部参数组合未逐项验收；Android真机安装、键盘、触控、相机、后台记录和图源实际加载待用户测试。没有HarmonyOS 6.1原生HAP/APP产物。

大小：57,892,016 字节。SHA256：`32756b021a6dded7597c3a9b112bc79c63da053b309bce97544a5cad8eea8527`。校验文件：`APK/Shantu-0.2.92-test-standalone.sha256`。

构建命令：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -SdkRoot 'D:\GodotAndroid\android-sdk' -JdkRoot 'D:\GodotAndroid\jdk-17' -StandaloneTest -DefaultMapSources .openai/default-map-sources-private.json
```

默认JDK目录属于另一台机器，第一次预检停止后改用上述已验证本机路径，未修改构建脚本或生成新签名。最终staging：`mobile/.build/apk-20261001-084836`。此前未交付的中间构建已由包含最终图层调整的本包替代。证据在 `.openai/apk-0292-final-build.log`、`apk-0292-integrity.json`、`apk-0292-signature.log`、`release-0292-tests.log`、`layer-window-tests.log`、`layer-window-typecheck.log`。

仅本地私有交付，包含用户已授权配置，未公开发布、提交或推送。源码基线 `ec47ec0aa5f23cba6dfa2dd576197a82b6f34efe` 加本地改动，分支 `codex/rollback-ui-0235-20260921`；本轮没有新的远程SHA核对或main合并。原用户预览与存档未清理。覆盖安装同包名同签名测试版，无需卸载或清数据；实际覆盖安装尚未真机验证。
