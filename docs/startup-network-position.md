# 启动时的大致位置（0.2.61）

## 施工依据与决策

Android 的 `NETWORK_PROVIDER` 在设备提供时可根据附近蜂窝基站及 Wi-Fi 热点估计位置，但是否可用、何时返回以及误差由系统决定；应用不能强制取得“纯基站坐标”。`getLastKnownLocation()` 只读缓存，可能非常旧，必须核对时间。Android 12 起用户可以只授予大致位置。官方建议在用户操作定位功能时才首次请求权限，并限制不需要的持续更新。

因此保留已有 `LocationManager` 自动模式的网络 + GPS 双提供者，以及 30 秒原生缓存时效检查；启动时仅在**先前已经获得前台定位权限**的 Android APK 自动观察。首次安装或权限被撤销时不弹窗，用户点“跟随”才走既有权限请求。普通浏览器预览不自动请求地理位置。

## 运行流程与验收

1. 已授权时，地图启动以 `auto` 请求网络和 GPS。第一个可用的网络粗位置或 GPS 精位置显示在地图，允许粗位置先把地图带到附近，缩放按系统报告的误差计算。
2. 仅第一次有效启动位置改变相机；后续 GPS 更新位置点，但不覆盖用户的视角。等待期间若用户拖动、滚轮/双指缩放、点地图缩放或手动定位，取消自动聚焦。编辑、测量、导航等操作中也不自动拉走地图。
3. 首个可用点之后继续短暂等更好的 GPS。可靠 GPS 到达或最长 20 秒后停止这次启动订阅，保留最后位置；用户随后主动打开跟随时由手动订阅接管，不受启动计时器停止。Activity 退到后台仍沿用现有暂停逻辑。
4. 未授权、缺少原生桥接口或桥异常时不自动发请求；跟随按钮照常可申请前台权限。系统无网络定位提供者时可等 GPS，但不虚构基站位置。

本轮仅涉及 Android 前台定位桥、位置 hook 和地图相机，不改实走记录、导航精度门槛、轨迹/照片/收藏存储、地图图源、包名或签名。真机仍需核对粗略权限、系统关闭 Wi-Fi/网络定位、室内首次返回时间、退后台和手动跟随切换；浏览器模拟与 APK 构建不能替代这些检查。

官方资料：[Android `NETWORK_PROVIDER` 与缓存位置](https://developer.android.com/reference/android/location/LocationManager)、[前台定位权限与大致位置](https://developer.android.com/develop/sensors-and-location/location/permissions/runtime)、[定位更新与前后台处理](https://developer.android.com/develop/sensors-and-location/location/request-updates)、[定位耗电建议](https://developer.android.com/develop/sensors-and-location/location/battery)。
