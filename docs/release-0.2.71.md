# 山兔 0.2.71 测试版（最终构建与浏览器 QA 完成）

本说明记录0.2.71测试包的源码范围和验证结果。测试版Release页面为 [GitHub Release 0.2.71-test-standalone](https://github.com/Siger1989/map/releases/tag/v0.2.71-test-standalone)。

## 本版内容

- 地图普通框选与路线编辑框选共用双指平移、缩放、旋转链路。每帧合并指针更新，手势结束时执行一次业务相机同步；取消、关闭、隐藏和卸载都会收尾手势并清理待处理帧。
- 地点和模型名称在地图界面缩放第12级显示（MapLibre raw zoom 11）。
- 收藏夹导入集中提供支持的文件与标记 Excel；分享入口选择 JSON 或 XLSX，移除独立 Excel 导出。操作窗口互斥；存在有效历史地图视角时，启动定位不会覆盖它。
- 记录期间的照片入口先提供直接拍摄与导入，整文件夹导入及说明仅在记录未开始或结束后出现。拍摄关联当前实走记录；EXIF 时间优先。Android 相机无 EXIF 时间时使用相机返回时间估计并明确标注。位置回退需精度可靠、时间相近，并记录“拍摄时/返回时定位”及误差；用户调整时间后不再沿用原拍摄位置。无记录点时照片可暂留在页面草稿，但没有可关联轨迹时不能加入地图。取消相机不创建空标记，保存失败保留草稿。轨迹保存合并复用其他 ID 时，仅改写属于本次记录 ID 的照片关联，失败则保留记录供重试。
- 延续5米记录精度新用户默认值并保留用户设置、运动朝向跟随、缺少路线终点时聚焦候选节点，以及有效历史相机视角恢复。
- 地图2D/3D模式与相机写入既有`shantu.map.last-view.v1`快照，应用启动时读取并恢复；交互切换同步更新待保存模式，零时长改变俯仰并立即flush MapLibre节流的URL hash，防止React state尚未提交或立即reload时旧hash覆盖新模式/俯仰。旧快照缺少可选字段时沿用默认模式，不更改存储键或其他数据格式。

## 最终 APK 构建数据

| 项目 | 最终构建结果 |
| --- | --- |
| Android APK | `APK/Shantu-0.2.71-test-standalone.apk` |
| 大小 / SHA-256 | 57,842,780 bytes / `E298995A4394500E168EA2D6794C402FC674D5D5EA70B577E29965C111B318D6` |
| SHA-256 sidecar | `APK/Shantu-0.2.71-test-standalone.sha256`；内容与 APK 实际 hash 一致 |
| 版本 / versionCode | `0.2.71-test` / 78 |
| 包名 | `com.guanyun.weather.shantu.preview` |
| 最低 Android 版本 | API 26（Android 8.0） |
| 签名 | 原 `4a94` 证书；v2/v3验证通过 |
| zipalign / 地形 | 通过 / 473张瓦片核验通过 |

## 验证状态

647/647测试、TypeScript、网页构建、签名、zipalign和473张地形资源检查通过。最终bundle在390×857与360×780均通过：raw zoom10.99显示图标且不显示名称，raw zoom11显示名称（界面约第12级）；普通和编辑框选双指操作、收藏统一导入/分享、记录照片入口通过。2D和3D点击后立即reload，URL hash与LAST_VIEW均保留所选模式、中心、缩放、方位及俯仰（2D为0°，3D为62°）。照片定向验证覆盖拍摄时间/位置来源、记录ID关联、失败保留草稿与记录及旧照片库兼容。

APK沿用原包名和 `4a94` 证书，具备覆盖安装同签名版本的条件；实际 Android 真机安装、覆盖安装与数据保留、双指手势触控和相机往返尚未验收。浏览器检查不代表真机验收。弱信号轨迹断续仍未诊断，需原始轨迹或诊断数据继续调查。HarmonyOS 6.1 原生 HAP/APP 与邀请安装交付未完成；Android APK 在鸿蒙设备上的兼容性未经验证。

源码基于功能分支`codex/rollback-ui-0235-20260921`，不表示合入main。annotated tag `shantu-ui-baseline-0.2.71`标记本版源代码基准，供后续UI风格调整回退；测试Release tag `v0.2.71-test-standalone`对应同一源码commit。实际远程状态见测试版Release页面：https://github.com/Siger1989/map/releases/tag/v0.2.71-test-standalone。
