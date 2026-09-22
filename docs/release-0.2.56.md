# 山兔 0.2.56 测试版：Sentinel-2 默认卫星底图

主地图与导航小地图默认改为 EOX Sentinel-2 cloudless 2025，免注册查看约10米分辨率的2025年少云合成影像。天地图保留手动选择，默认不再加载天地图影像和注记；加载失败不会自动切换其他在线图源。

- Sentinel-2瓦片最高请求Z14；仍可继续放大查看，但不会把放大后的像素称为更高清影像。
- 图源菜单标明年份、分辨率、非商业许可和天地图每日额度。遵循EOX/Copernicus及CC BY-NC-SA 4.0署名。
- 区域下载暂留入口，当前Sentinel-2下载禁用；已有离线包及自定义图源保留。完整缓存重构、配额统计、Google及PMTiles未在本版实现。
- 保留0.2.55个性化配色、紧凑菜单、导航方案复用和小地图加减/3D摇杆；轨迹、照片、标记、布局和应用存储格式不变。

## 安装与平台

| 平台 | 交付与安装方式 | 验证状态 |
| --- | --- | --- |
| Android 8.0及以上 | 下载APK，直接覆盖安装同签名“山兔测试版”，无需卸载旧版 | 构建与静态校验通过；本轮真机安装、定位及网络待验证 |
| HarmonyOS 6.1原生 | 本轮无HAP/APP及邀请测试链接 | 未交付；原生平台适配、工具链及签名分发尚未完成，APK不等同原生鸿蒙包 |

包名 `com.guanyun.weather.shantu.preview`；版本 `0.2.56-test`，versionCode `63`，沿用原4a94签名。源码分支 `codex/rollback-ui-0235-20260921`，未合入main。

## 验证与限制

- TypeScript检查与22项定向测试通过，覆盖默认图源、天地图初始隐藏、瓦片级别、旧离线包与导航方案复用。
- 主地图和导航小地图实际预览加载；390×约857预览中图源窗口276×200。截图保留于仓库工作区 `artifacts/screenshots/sentinel-20260922/`。
- 本机绕过显式代理请求EOX瓦片HTTP200，约1.36秒；不能据此保证手机或所有国内网络稳定直连。EOX公共服务仍可能限流。
- Sentinel-2约10米，适合地表概览；不是实时影像，也不提供天地图级别的高分辨率细节。部分高程服务不可达时仍显示缺测。
- APK已从本版源码重新构建；签名、对齐和资源校验详见下方。真机覆盖安装、实际定位与触摸体验未验收。

## 下载

[下载Android APK](https://github.com/Siger1989/map/releases/download/v0.2.56-test-standalone/Shantu-0.2.56-test-standalone.apk) · [SHA256校验文件](https://github.com/Siger1989/map/releases/download/v0.2.56-test-standalone/Shantu-0.2.56-test-standalone.sha256)

## APK校验

- 文件：Shantu-0.2.56-test-standalone.apk
- 大小：57788854字节
- SHA256：893a27b7a5668ede64064730d42b01a01468c710a121285550597a55b5cb7dc6
- 原4a94证书、v2/v3签名及zipalign通过；543项ZIP、473张地形瓦片、44项网页及11项原生特征通过，包含本次Sentinel-2图源与版本信息。
