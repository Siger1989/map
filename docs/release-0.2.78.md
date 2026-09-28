# 山兔 0.2.78 测试版

本版处理 OPPO Find X8 Ultra 反馈的路线编辑分叉卡顿和长按按钮误选文字，并修正短横屏里的添加标记卡片、标记编辑页、右侧地图工具与摇杆布局。分叉吸附先按准星附近范围筛选候选节点，再对附近节点做原有精确屏幕距离判断；路线编辑按钮禁止文字选择，名称和备注等输入仍可选字。保留原有标记类型及路线按钮。

- APK：Shantu-0.2.78-test-standalone.apk
- 版本：0.2.78-test，versionCode 85
- 包名：com.guanyun.weather.shantu.preview；沿用原独立测试版签名
- Android：8.0（API 26）及以上
- 大小：57,859,164 bytes
- SHA256：EE4CB050409E641A6CD9615E048DA861D1D16DEC65BAC19830B9A19238494161
- 签名证书 SHA256：4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f

验证 PASS：TypeScript、689/689 测试、全新 Android 网页和 APK 构建、v2/v3 签名、zipalign、包内 543 个网页/地形文件与构建暂存内容一致；主地形瓦片 473 张。浏览器横屏按约 857×390 CSS 像素比例模拟，并检查更矮的 857×350 可用区域：添加标记 8 个按钮和标记基本资料在一屏内，工具框与底部摇杆、导航无重叠。此比例不是手机实际物理尺寸或系统栏扣除后的精确视口。

浏览器测试不能代替 Android 真机分叉跟手程度、系统文字菜单、触控、GPS 或覆盖安装验收。HarmonyOS 6.1 原生 HAP/APP 尚未生成。请覆盖安装同包名旧测试版，不要先卸载；源码位于 `codex/rollback-ui-0235-20260921`，尚未合入 `main`。

构建源码提交：`0bbb5cbbffa61a974cd53551b63282c966306bf7`。[公开预发布](https://github.com/Siger1989/map/releases/tag/v0.2.78-test-standalone) 的 APK、SHA256 和安装说明三个附件已核对远端大小与 digest，APK 远端 SHA256 与本地一致。
