# 0.2.39：恢复0.2.35界面与功能

用户明确要求撤回整套0.2.36及后续PDF UI改版。本版恢复0.2.35业务基线，保留全线陡坡提示、自定义布局及此前功能。安装版本提升到0.2.39-test / versionCode46，以覆盖已安装的后续测试版本；不是把旧APK改名，需从当前源码重新构建。

## 改动范围

- 基线：d01d9dc14bad4ecf19728514a3582087d47605bd；功能来源02027e60069bb3ba4ec293cb7ea1b9b2f5a692f3。
- 撤回0.2.36的固定主图、绘制/记录/照片等整体改版；后续未提交试改不进入新包。
- 唯一存储兼容修正：photos/storage.ts打开现有照片数据库版本，不再强制v1。0.2.36曾升至v3但保留完整photos表，回退后仍读取该表；不删除或重建照片库。辅助索引保留但旧界面不使用，今后重新引入索引版必须从photos重建索引，不能直接复用旧缓存。
- 原包名、4a94签名、页面源、原始轨迹/照片/布局键不变。清理只归档本机临时资料，不清用户数据。
- 整理README、CURRENT_STATE、Agent交接、目录与历史索引；保留32页原PDF供后续逐层确认。

## 安装与平台

| 平台 | 产物/方式 | 状态 |
| --- | --- | --- |
| Android 8及以上 | Shantu-0.2.39-test-standalone.apk；下载后覆盖同包名同签名独立测试版 | 构建/签名验证以CURRENT_STATE为准；真机覆盖与数据读取待验 |
| HarmonyOS6.1原生 | HAP/APP | 未交付，缺原生工具链/签名分发与安装证据 |
| Windows/Mac网页 | 运行项目源码 | 本轮不制作新的桌面ZIP |

不要先卸载旧应用或清空数据。Android版本号允许覆盖安装，不等于已完成手机数据/权限/触控验收。

## 下载

- [APK直接下载](https://github.com/Siger1989/map/releases/download/v0.2.39-test-standalone/Shantu-0.2.39-test-standalone.apk)
- [Release及SHA256](https://github.com/Siger1989/map/releases/tag/v0.2.39-test-standalone)
- 本机：`D:/天气系统/APK/Shantu-0.2.39-test-standalone.apk`

上述链接在Release发布后生效，最终状态见CURRENT_STATE.md。本轮不提供伪装成新验收的旧UI截图。

APK为57,731,510字节，SHA256 `e0fc1e80030e802772e59f06681cda6157ec76cdab825897ecde1a8e86ddf76a`。

## 验证

类型、506/506逻辑（含照片库新建/v1/v3三项回退检查）、架构、网页与Android构建通过。4a94原证书v2/v3、zipalign、543项ZIP CRC、473地形像素与源码一致；手机布局与照片兼容代码入包、桌面编辑器及私密文件排除通过。用户布局草稿SHA256与回退前一致。

照片库回归使用模拟IndexedDB版本规则，不冒充真机覆盖安装或实库验收。Android真机GPS/后台/相机/触控尚未验收。
