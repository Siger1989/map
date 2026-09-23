# 山兔 0.2.65 测试版：标记 Excel 导出与回填

收藏夹多选“标记 Excel”及地图框选（仅选地点/模型）可以导出 XLSX；收藏夹“导入”可选择 XLSX 或下载空白模板。每行一个标记，前四列是 WGS84 经度、纬度、名称、备注，后续“属性：条目名”列按原有顺序排列。导出自动填写 ID，不需要手动编写；导入时按 ID 优先匹配，无 ID 时按六位小数坐标匹配。新增、更新和错误在预览中显示，用户确认后才写入；错误行会阻止整批写入，可撤销刚完成的导入。空白单元格保留已有值，照片及其他非表格字段保留。手工表仅可新建地点，ZIP/JSON 仍用于完整备份。

## 安装与平台

| 平台 | 产物与安装 | 验证状态 |
| --- | --- | --- |
| Android 8.0及以上 | [Shantu-0.2.65-test-standalone.apk](https://github.com/Siger1989/map/releases/download/v0.2.65-test-standalone/Shantu-0.2.65-test-standalone.apk)，可覆盖同签名“山兔测试版” | 类型、624项逻辑测试、浏览器导入导出、构建/签名/资源检查通过；真机待验 |
| HarmonyOS 6.1 原生 | 暂无 HAP/APP 或邀请链接 | 平台适配与安装验证未完成；Android APK 仅在设备支持时可兼容试装 |

包名 `com.guanyun.weather.shantu.preview`，版本 `0.2.65-test`、versionCode72，沿用既有 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f` 签名。源码在 `codex/rollback-ui-0235-20260921` 分支，未合入 main。

## 验证与限制

- TypeScript、624项逻辑测试、网页构建及打包网页启动通过。隔离9433浏览器390×857、360×780操作收藏夹导入预览/确认/撤销、批量导出及地图框选导出；截图在 `artifacts/screenshots/20260923-excel-import-preview-{390,360}.png`、`20260923-excel-export-favorites-{390,360}.png`。未操作用户9423标签。
- Android网页、Java、DEX、APK从本轮源码重建；APK签名、zipalign和473块随包地形瓦片通过。文件 `APK/Shantu-0.2.65-test-standalone.apk`，57,830,492字节，SHA256 `48714d135f6ff3d629997f46d6f55b5f831cc64b2aa48152d8036ec8533c142c`；同目录 `.sha256` 可核对。
- 天气层仍由 Open-Meteo 预报驱动，3D云雨是示意而非实时卫星云图。本轮只完成国内天气/云图源调研，没有替换来源。和风天气提供月度免费调用额度；中国天气 SmartWeatherAPI 包含预报、雷达、云图但要申请审核；风云卫星原始数据可实名免费下载，不能据此推断其地图瓦片可直接嵌入；彩云卫星图层是企业增值服务。正式集成需取得服务凭证并确认地图叠加/缓存许可。
- 浏览器模拟不能代替手机文件选择、覆盖安装及真实触控验收。
