# 山兔 0.2.89-test 发行记录

> 状态：已公开发布测试Release；APK与校验附件远端大小/digest已核对，构建源码与Release标签一致。手机验收尚未完成。

## 版本与兼容

- 版本：`0.2.89-test`，`versionCode 96`
- Android 包名：沿用独立系列 `com.guanyun.weather.shantu.preview`（构建使用 `-StandaloneTest`，源码默认原系列包名不改）
- 签名：沿用原独立测试包系列签名；构建脚本须核对证书，签名不匹配时停止，不能用新证书冒充可覆盖更新。
- 目标：把本轮已确认的地图 UI、收藏、分享/导入、画线续画和导航起点调整交付为可安装测试包。

## 本轮内容

- 统一外框/控件圆角为 8px/4px、标题安全内距至少10px。画线卡最宽276px，并为右侧地图操作保留80px空间。
- 比例尺位于右上“3D/框选”下方，最大宽度44px。首页移除影像日期与独立 i 入口，图源署名信息收纳到图源说明。
- 绘制期间恢复隐藏UI入口，隐藏后可显示并恢复原草稿；3D/框选激活仅改变文字颜色，不添加底框。
- 收藏分类与多选/框选分享删除流程、分享输出与导入卡片、直接画线和既有路线续画、导航起点接入均有本轮改动。手绘副本不覆盖实走原记录；模拟行程明确标注模拟数据，不代表 GPS。
- 修正道路/路线线段位于地名注记下方，端点/用户说明/定位仍置顶；无地名时保留原顺序，选中描边与晚到图层的回归已修复，重复同步不无故重排。
- 路线规划速度仅做了诊断：在线流程串行执行 `locate` 与 `route`，共享约1100ms主机节流并有单次超时限制。本轮未改规划服务或节流策略，不宣称提速。

## 数据、来源与平台边界

- 保留原包名、签名、用户收藏/路线/轨迹/照片/布局和存档格式；构建及检查不得清除或覆盖真实用户数据。
- 公开 APK 不含本机私有图源种子配置或本机 Key。不得将 `.env.local`、签名密钥、缓存和日志放入公开产物或仓库。
- Android 包不等于 HarmonyOS 原生应用。HarmonyOS 6.1 原生 HAP/APP 尚未交付。
- 覆盖安装、真实 GPS、手机触控和系统分享均待真机验证。

## 构建与发布证据

- 构建源码提交：`586dfe45e1fa459060e1489fe078ab9252c4b250`；分支 `codex/rollback-ui-0235-20260921`，未合入main
- APK：`APK/Shantu-0.2.89-test-standalone.apk`，本机构建路径 `D:\天气系统\APK\Shantu-0.2.89-test-standalone.apk`
- 大小：`57,883,740`字节
- SHA-256：`1fd3efe719d884d38a4c3ffda8309f4e5b7a86427de9c25e707d55a7f6516087`
- 原证书SHA-256：`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`；v2/v3签名、zipalign、ZIP CRC PASS；543网页资源和DEX与全新stage匹配、496地形PNG通过；公开包无私有图源种子或本机Key。
- `npx tsc --noEmit`、完整880/880测试（JAVA_HOME指定可用JDK17）、`npm run build`、全新移动网页及Android构建 PASS；浏览器复验见 [UI门禁记录](ui-gate-20260930.md)。
- `npm run check:architecture` FAIL：7项已有文件长度预算超限，RouteViews新增1行预算超限，详见门禁记录；不冒充架构通过，本轮未扩散重构。手机验收另列待办。
- [测试Release](https://github.com/Siger1989/map/releases/tag/v0.2.89-test-standalone) · [下载APK](https://github.com/Siger1989/map/releases/download/v0.2.89-test-standalone/Shantu-0.2.89-test-standalone.apk)；APK/sha256附件远端大小/digest一致，标签指向构建源码586dfe4。发行记录随源码同步，另附Release。
- 真机覆盖安装、GPS、触控、系统分享：`未验证；待设备实测`

构建入口见 [`mobile/README.md`](../mobile/README.md) 与 [`scripts/build-android.ps1`](../scripts/build-android.ps1)。独立测试版命令为 `npm run build:apk -- -StandaloneTest`；可通过 `-SdkRoot` 和 `-JdkRoot` 指定 SDK 与 JDK 17。必须基于最终源码重新构建并核对产物；旧版 APK 不能替代本轮构建。
