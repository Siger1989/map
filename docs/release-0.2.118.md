# 山兔 0.2.118-test / code125

本版把整合钻孔 Excel 的导入、出图和模板下载装入 Android APK 与 Windows 单文件 EXE。柱状图沿用用户指定参考图：固定表格、实际深度分段、黑白采样条、独立孔深校正及弯曲度小表、底部图签。

## 本次更新

- 11页整合模板，样品测试元素自定义；回次、分层、采样采取率自动计算，移除“结果标记”列。
- 完整模拟含300米孔深、100回次、30层、120样品、6元素/720结果、16校正及测斜记录。模拟采样连续，格高按实际采样长度确定。
- 样号在黑白条右侧留白内显示，长号适宽，避免压条和边线；保持原参考图列宽与深度比例。
- 包含此前PC移动圈放大/减敏、连续平移性能修复、绘制中切换显示属性及顶部图层入口靠右。

## 下载与平台

发行页：https://github.com/Siger1989/map/releases/tag/v0.2.118-test-standalone

- `Shantu-0.2.118-test-standalone.apk`：Android 8及以上，沿用独立测试包名与签名。
- `Shantu-0.2.118-test-windows-x64.exe`：Windows x64单文件程序；需要WebView2 Runtime，PNG生成需要系统Edge或Chrome。
- `Shantu-drill-template-v3.xlsx`：空白整合模板。
- `Shantu-drill-example-300m.xlsx`：完整连续采样模拟。
- `Shantu-drill-example-and-drawings.zip`：模拟Excel及实际生成的完整PNG、SVG和局部图。
- `SHA256SUMS.txt`：下载校验清单。

公开产物不嵌入本机天地图Key、私有图源种子或地质服务Token。已有用户存档不清除；本机带Key预览配置保留，因此公开包的初始图源与本机私有预览存在差异。地图配置可按原有导入功能恢复；不得将含私有配置的文件当作公开发行资产。

## 验证范围

代码阶段已通过相关定向测试、类型检查及Web构建；完整模拟在PC与手机浏览器实际生成PNG/SVG，120个样号实际文字边界核对通过。发布阶段只复核新产物构建、APK签名/版本/资源、EXE启动及整合模板生图、公开配置与SHA256，不重复无关全套检查。

Android真机覆盖安装、定位/后台/相机，以及Windows原生交互仍待用户设备验证。APK不是原生HarmonyOS HAP/APP。

源码发布在 `codex/rollback-ui-0235-20260921` 分支，未合入main。构建产物、源提交与远程核对结果以本次Release及CURRENT_STATE最新记录为准。

## 产物核验

APK：70,219,877字节；SHA256 `b803b3285db64039ea624bad00855e9a26dc74b5094f6262791fcac9ea0c4126`。版本125、原独立测试证书、签名、zipalign及当前连续模拟模板字节核验通过。

EXE：123,801,113字节；SHA256 `82e1656b6d2cbcb10d20d3d01635c412cc0504911d722096b0a2851b7174e562`。单文件隔离自检退出码0；地图及行业工具HTTP正常，300米整合示例成功导入并生成SVG/PNG（100回次、30层、120样品）。

公开构建方式：APK使用 `scripts/build-android.ps1 -StandaloneTest -ClearPublicTiandituKey`；电脑先运行 `node scripts/build-desktop-map.mjs --public --out-dir <本项目EXE下的新资源目录>`，再以 `build-desktop-exe.ps1 -OneFile -SkipMapBuild -MapRuntimeDirectory <该目录>` 打包。默认私有预览与私有构建路径保持。
