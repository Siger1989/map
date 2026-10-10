# 2026-10-10 内置天地图与本机包纠正

用户再次要求“内置地图都要包含我注册的天地图”。规则已补入 `AGENTS.md`：本机预览、用户自用APK、PC EXE及主图/双图必须在“内置”分类提供用户已有Key的天地图；不能以“我的图源”替代，也不能用无Key公开包覆盖本机含Key固定入口。Key不进源码/聊天，私有产物不自动公开分发。用户明确要求记住，另按记忆写入约定添加一份本机 ad_hoc 更新笔记，不修改记忆索引。

## 根因与纠正

上轮跨电脑拉取将公开120 APK复制到了本机 `APK/山兔手机.apk`；该包无Key，与用户自用要求不一致。这是本机固定入口的交付错误，不是注册Key丢失。

本轮从已有 `.env.local` 和 `.openai/default-map-sources-private.json` fresh 构建私有120；沿用0.2.120-test/code127、原独立包名与签名，恢复本机固定APK。保留公开版文件及原校验，不公开上传私有APK。PC固定EXE已是正确私有包，hash与上轮已核验产物一致，未重复构建。未修改应用逻辑、UI、版本、数据格式、真实存档及原Key文件。

| 本机产物 | 字节 | SHA256 |
| --- | ---: | --- |
| `APK/山兔手机.apk` / `APK/Shantu-0.2.120-test-standalone-private.apk` | 70224057 | `074a408b318705a1766ac460f71229a7ea61a1e0edb2befa63cef6cc79ae0f69` |
| 保留公开 `APK/Shantu-0.2.120-test-standalone.apk` | 70223973 | `19e16d155e0f9c4b2154d6c2a7f3e204c16d4700041c47084808789d3de5711b` |
| 保留私有 `EXE/山兔桌面.exe` | 123805197 | `1941c0f01a4d10172afd5247a085677ff72beea06849c961ce8ac05fa68d377d` |

## 本轮验收

- PASS：本机Key存在且格式有效，`.env.local`和39项私有图源文件hash与上轮一致。
- PASS：主代理独立检查实际固定APK完整ZIP共1934项、CRC有效；内嵌Key匹配本机、私有图源字节匹配，固定/版本私有APK一致，公开APK原hash已恢复。
- PASS：fresh网页/Android构建、aapt版本/package、原证书连续、v2/v3签名、zipalign及473项terrain资源核验；签名/安装兼容性沿用独立系列。
- PASS：右侧9174运行apk-preview模式；刷新前实际“内置”菜单包含选中的“天地图影像”、注记/境界选项，39项“我的图源”独立存在。这是入口存在证据，不是地图当前可绘制的视觉通过。
- FAIL：当前右侧预览先报“地图绘制上下文已中断”；重新打开及同origin新页均报“地图暂未启动”，兼容信息 `webgl2=false`、worker/wasm=true，无法创建三维地图画面。此故障尚未恢复；没有删除天地图来规避。未修改Codex全局配置、驱动或其他项目设置。
- 未验证：新私有APK真机覆盖安装、真实GPS/相机/后台及Windows原生窗口权限；没有连接设备或替用户安装。现有手机不会随本机文件更新，仍需使用上述私有APK覆盖安装。

证据 `.openai/tianditu-restore-20261010/`：build.log、local-config-check.json、parent-apk-audit.json及原公开包备份/原校验；原生核验日志见同目录。截图 `artifacts/screenshots/tianditu-restore-20261010/preview-webgl2-fail.jpg`。这些本机产物/凭据/日志/截图不提交到源码仓库。

## 下次接续门禁

拉取或打包先核对“本机私有/公开分发”目标，验证Key存在性与入口，再检查实际固定APK/EXE内嵌配置；不得因版本号相同就替换含Key固定包。缺少远端私有包时在本机用已有配置构建或明确未对齐。主图/双图换源仍需保留图层与用户存档。下一步先恢复右侧浏览器WebGL2，再实测天地图瓦片与主/双图入口；本轮不把构建或入口存在写成显示恢复。
