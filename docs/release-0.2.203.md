# 山兔·优化 0.2.203-test 私人测试版

用户要求保存当前预览配色，搜索输入框与路线输入框统一后交付。目标 Android `com.shantu.oldengine`，versionCode 210，最低 Android 8，保留原签名与私人内置天地图。

## 变更

- 从用户实际预览 Session Storage 的最新调色记录读取23项参数，并用该存储的独立数据库快照再次比对；从同一预览 Local Storage 读取原基础配色。没有将测试浏览器的近似配色作为用户参数。
- `savedMaterialPreset.json` 保存原始草稿（包括RGB小数/HSL/透明度）、几何参数、基础配色及35个实际解析令牌。首次升级自动应用并备份旧配色；改用其它配色后记住选择，可再点“我的调色”恢复。未修改业务存档键。
- 主图和双图搜索输入与路线输入共用8px圆角、输入底色和聚焦背景，移除独立亮边。顶部保留44px触控及16px文字。
- 包含11月13日至14日已授权预览修改：共享Q弹/停靠方向/锁定退出/尺寸过渡，画线再次点击收起和右栏稳定，窗口内距与表单对齐，主次级玻璃材质、选中态文字、收藏底板与地图延伸、点选分类调色控制器。详见[次级界面证据](ui-secondary-material-review-20261114.md)、[连续反馈](ui-feedback-20261113.md)、[控制器](ui-material-controller-20261113.md)。
- 包含此前用户要求的半瓦片羽化候选：已确认接缝从边缘到中心平滑混合同源父/子瓦片，移除6CSSpx限制；没有改变LOD请求预算。GPU/真机观感尚未验证，可能使更宽区域变柔和，见[羽化说明](raster-feather-20261113.md)。

## 验证

| 范围 | 证据 | 状态 |
|---|---|---|
| 主图390×857、360×780搜索/路线输入 | 实际computed：两者8px圆角、相同背景/边线/聚焦背景；截图和点击返回 | PASS |
| 双图搜索 | 实际输入样式、点击与关闭、截图 | PASS |
| 保存后的个人材质 | 无控制器独立页面35令牌逐项相等；重载、切换科技深蓝、重载仍退出、恢复个人预设 | PASS |
| 定向JavaScript | 原材质/配色/收藏视口19项 + 保存迁移4项 | 23 PASS |
| TypeScript | 最终输入及个人预设源码 | PASS |
| 私人Web | native-hybrid模式最终构建9.41秒 | PASS |
| Kotlin羽化策略 | 本次Gradle成功，15项测试输入未变采用UP-TO-DATE结果；此前15/15实际执行 | PASS（策略，不是GPU） |
| Android安装包 | 最终优化合成2分28秒；原签名、1925资源逐项、39种子/天地图、8库基线、CRC/16KiB、35个材质令牌 | PASS |
| OPPO覆盖安装、输入法/触控、玻璃合成、实际羽化观感 | 未在本次执行 | 未验证 |
| HarmonyOS原生HAP | 无已适配可签名工程 | 未交付 |

截图位于 `artifacts/screenshots/glass-material-20261113/release203-*.png`，此前50张对照保留。本轮无清空用户收藏/记录/草稿，无修改定位、导航业务、授权配置；旧202保留。历史已知关闭面板焦点aria-hidden警告未在本次扩展修复，不宣称全状态视觉验收。

## 交付与同步

应用源码 `5056c6d9d10ac58283eb763d4468e436c24acc82` 已推送到 `codex/old-engine-tilt-dual-20261105`，远端SHA已核对一致。以下记录最终安装包和一致性核验。私人APK只交本机和已授权PRIVATE仓库；不上传公开仓库或Release。

本机包：[Shantu-0.2.203-oldengine-private.apk](D:/天气系统/APK/Shantu-0.2.203-oldengine-private.apk)，165406288字节。SHA-256 `6fb2dbe6825fead6682d7fdb709366083d2dc75fba363bf68ba54f0a2f85230f`。对应校验文件和原始调色备份 `Shantu-0.2.203-ui-parameters.json` 同目录保留。202原包SHA未变。

首轮全新暂存构建14分7秒，随后用最终Web资源再次合成2分28秒。CAD源码/构建配置相对202源码未变，最终复用从已核验202包提取的四ABI CAD JNI；其余原生库与202一起核对为8/8逐字节一致，已改Kotlin和shader按当前源码重新编译。仅在最终合成排除重复CAD任务，未跳过已改原生模块。

[203 私人测试 Release](https://github.com/Siger1989/shantu-private-delivery/releases/tag/v0.2.203-private) 已发布。上传前后确认仓库为PRIVATE，服务端两项资产的大小/SHA核对一致，并完整下载APK再次核对SHA。应用源码5056c6d及本机交付记录9d30b47均已推送并核对远端。
