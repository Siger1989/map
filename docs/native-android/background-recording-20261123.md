# 2026-11-23 安卓快捷记录与后台定位

私人老引擎工作树的实际 APK 使用 `mobile-native/hybrid`，持续录制使用 `mobile/android/src/com/guanyun/weather/RecordingService.java`。WebView 暂停或息屏不承担定位采样。应通过系统前台定位服务检查后台连续性。

「轨迹记录」磁贴通过系统快捷设置加入。单击开始、暂停或继续。已有完成轨迹时打开记录面板保存。开始和继续用短暂可见的安卓窗口取得使用期间的精确定位权限，确认服务已进入记录状态后收起。锁屏点击依系统解锁，录制过程中可正常息屏。轨迹、采样规则、存档和悬浮地图记录共用同一份状态。

最低版本按现有 Hybrid 应用的 Android 8 设置。Android 13 及以上可从山兔触发系统添加提示，Android 8 至 12 在下拉快捷设置的编辑页手动添加。安卓厂商可提供自己的电池管理与快捷面板，OPPO、小米、vivo、三星各自的实机持续性还要验证。iOS 和原生 HarmonyOS 尚未适配。 [安卓快捷设置](https://developer.android.com/develop/ui/views/quicksettings-tiles)

「后台记录与快捷按钮」显示精确定位、系统定位、记录通知、电池优化、系统省电和后台限制状态，并从应用跳转系统设置。后台活动权限及电池策略由使用者在系统里修改。OPPO 的省电模式可能限制后台活动。系统任务管理器的「停止」和应用设置的「强行停止」会停止记录。已写入的数据仍由原子存档保护。 [安卓前台定位要求](https://developer.android.com/develop/background-work/services/fgs/service-types#location) · [安卓电池优化](https://developer.android.com/training/monitoring-device-state/doze-standby) · [OPPO 省电模式](https://support.oppo.com/cn/answer/?aid=SI2105920)

源码中的掉点风险包括改采样间隔时先注销全部定位订阅，以及某个定位来源失败后暂停整条轨迹。现分别管理 GPS 与网络请求，单个定位来源失败后独立重试，先记录合格定位点再调整采样。重复启动或引用旧记录的操作不暂停当前行程。安卓重建记录服务时单开新分段以保留缺测区间。保留原有精度、点数上限和显式暂停／保存行为。

复测使用有卫星视野的实地路线。确认开始后有记录通知及有效轨迹点，切到其他应用并熄屏移动 3–5 分钟，回来检查这段时间是否有新增点。分别记录 OPPO 的系统电池设置、GPS 精度、通知是否持续和断点时间。测试设备与软件版本以实际报告为准。

| 范围 | 结果 | 证据 |
| --- | --- | --- |
| Android 私人隔离构建 | PASS | `com.shantu.hybridprobe` 的 Kotlin、Java、资源和最终 APK 构建通过。四套 CAD 库复用经 SHA-256 核验的 213 版本产物，CAD 源码匹配 |
| APK 系统声明 | PASS | minSdk 26、targetSdk 35、四 ABI，磁贴绑定许可、内部 Activity、定位前台服务声明通过检查 |
| TypeScript 与记录回归 | PASS | TypeScript、16 项记录存档、采样阈值、原生状态和照片匹配测试，私人混合网页资源构建通过 |
| Android 15 模拟器系统磁贴、息屏采样 | 未验证 | 现有测试设备的 ADB shell 无响应。另启隔离 AVD 后未等到稳定的 SystemUI，未进入装包和点击流程 |
| OPPO 锁屏与切后台实际轨迹 | 未验证 | 本轮未覆盖用户正式安装包 |
