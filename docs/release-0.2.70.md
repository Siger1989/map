# 山兔 0.2.70 测试版：记录精度、运动朝向、终点定位与框选

版本 `0.2.70-test` / versionCode77，包含 0.2.69 之后的记录精度、运动朝向和路线终点定位改动，以及连续框选交互调整。APK 通过本机构建与签名核验，计划作为 GitHub 测试版预发行版发布。

## 本版范围

- 记录定位精度门槛默认值由20米改为5米，设置范围仍为5–80米，并显示范围及“越小越严格”的提示。用户已明确保存的自定义门槛保持原值；旧轨迹、采样间隔、距离和定位来源不变。弱信号下，超过门槛的定位点仍可能被筛掉。
- “运动朝上”使用方向箭头；选择该模式会启用定位跟随，地图在可靠运动航向下朝行进方向旋转。用户手动拖动地图后暂停跟随和自动旋转。
- 路线缺少分叉终点或显式终点时，导航错误会定位分叉节点或末端候选，提示用户进入线路编辑并自行设定终点；不会自动补设终点或改写路线数据。
- 框选保持连续单指画框能力，提供独立的加选/减选按钮；双指手势用于平移及缩放地图。紧凑工具区显示当前选择和导出、分享、删除入口。

## 安装与平台

| 平台 | 安装方式 | 验证状态 |
| --- | --- | --- |
| Android 8.0及以上 | [下载 APK](https://github.com/Siger1989/map/releases/download/v0.2.70-test-standalone/Shantu-0.2.70-test-standalone.apk) · [SHA-256 文件](https://github.com/Siger1989/map/releases/download/v0.2.70-test-standalone/Shantu-0.2.70-test-standalone.sha256) | 本机构建、签名、对齐及资源核验通过；真机覆盖安装、GPS、输入法、地图手势及数据保留待验证 |
| 支持安装Android APK的HarmonyOS设备 | 仅可在设备支持时尝试同一Android APK | HarmonyOS设备兼容性未经验证 |
| HarmonyOS 6.1 原生 | 本版不提供HAP/APP或邀请测试链接 | 尚无原生鸿蒙工程、签名和分发交付 |

包名 `com.guanyun.weather.shantu.preview`，版本 `0.2.70-test`、versionCode77；签名证书 SHA-256 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`，与 0.2.69 相同。源码位于 `codex/rollback-ui-0235-20260921` 工作分支；不表示合入 `main`。

## 校验与限制

- 本地 APK `APK/Shantu-0.2.70-test-standalone.apk`，57,838,684字节，SHA-256 `960ba38b9e61953b3f0cac0a1fcf291263ab9df2b69321c45f07a4c4abd95621`；同目录 SHA-256 文件与 APK 哈希一致。APK 有551个ZIP条目、44个Web资源条目（含32个JS/CSS/WASM构建资源），以及473张地形PNG瓦片；入口页和地形覆盖资源存在。远端Release资产状态以最终核验为准。
- `npx tsc --noEmit`、`npm run build`、Android `-StandaloneTest` 构建通过；Android产物通过v2/v3签名和zipalign检查。根代理报告640项逻辑测试通过。网页构建提示存在大于500 kB的分块及部分API路由静态分类未知；命令仍以退出码0完成。
- 真机覆盖安装、GPS筛点、中文输入法、双指地图手势和数据保留尚未验证。浏览器验证不能替代真机触控验收。
- 2026-09-24 弱信号案例仍未查明是否发生轨迹断续。现有证据只能说明估计误差10米的定位点超过当时5米门槛而被拒绝，不能据此认定GPS掉线或断轨；本版不宣称修复该问题。
