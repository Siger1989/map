# 山兔 0.2.24-test：修复 Android 保存平剖图

0.2.23 的平剖图导出使用“剖面1-平剖图-1.jpg”这样的中文图名；Android 图片输出接口只接受原照片和测量的固定文件名，因此在打开系统保存窗口前就返回“分享图片过大或名称无效”，没有创建文件。

本版将剖面导出名改为 `Shantu-section-时间-页码.jpg`，Android 接口增加对应的严格校验。图纸中的中文名称和资料保留，主图与附表分别带页码。保存和分享共用的命名问题同时修复；原照片、测量格式继续支持。

保存时在系统文件窗口选择文件夹，再点击系统“保存”。保存的是 JPEG 文件，不会自动写入相册。取消选择不会创建文件；系统完成写入后提示“文件已保存”。

## 变更范围

- 新增 `modules/section/exportName.ts`，生成受限的剖面文件名。
- 修改 `SurveySectionPanel.tsx` 使用该名称并说明系统保存步骤。
- 修改 `mobile/android/src/com/guanyun/weather/NativeBridge.java` 的图片文件名白名单；继续保留 JPEG 内容、体积和应用前台限制。
- 新增 `tests/section-image-export.test.mjs`，从真实 Java 接口读取白名单，回归主图/附表、旧照片/测量、无效路径，以及前端保存/分享调用与字节传递。
- Android 版本更新为 `0.2.24-test` / versionCode 31。没有修改地形、测量计算、路线颜色、收藏数据或实际地图编辑布局。没有删除原功能。

用户讨论中的点旁菜单与“输入坐标”仍只是预览，本版未实现；竖井继续暂停。

## 安装与验证边界

产物为 `Shantu-0.2.24-test-standalone.apk`，包名 `com.guanyun.weather.shantu.preview`，沿用独立测试系列 4a94 签名。支持 Android 8.0+，可更新同包名、同签名的独立测试版。与原 `com.guanyun.weather.preview` 系列并存，不自动迁移其数据；需要时通过原版 JSON 存档备份导入。

本机 ADB 未连接用户手机。代码契约、类型、网页/Android 构建和包资源验证不能代替手机系统文件选择器与实际落盘验收。HarmonyOS 6.1 原生 HAP/APP 仍未交付。

验证通过：类型检查、402/402 逻辑测试、网页及最终 Android 构建。390×844 主图及360×780 附表在浏览器实际导出JPEG，新名称和页码正确，无横向溢出。APK签名v2/v3、zipalign、540项ZIP CRC、473地形资源及包内前端/DEX修复代码核验通过。

APK 57,669,821字节，SHA256：`7c03c30b689e77559f6afe6b2e2e39b2b28d4a48a85da247fb0c4482c8b40eb7`。

同步分支为 `codex/huawei-webview-touch`，不改 main。发行标签 `v0.2.24-test-standalone`，最终同步与发布记录见 `CURRENT_STATE.md`。
