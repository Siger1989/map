# 室内网络定位与扫码视野（0.2.8）

## 使用

Android 地图右侧「更多地图操作 → 室内」开启系统网络定位，按钮随后可切回自动定位。显示「基站 / Wi-Fi 大致位置」及系统估计误差，蓝色范围表示不确定性；首次按误差范围调整地图。自动模式同时尝试 GPS 和网络定位，优先保留近期较精确位置。超过30秒的位置标记为过期，普通浏览器保留原有浏览器定位，不伪称能选择基站。

需要系统位置权限（大致位置亦可）、定位开关，以及手机可用的网络定位服务；可能需要数据网络或 Wi-Fi 辅助定位。基站/Wi-Fi 是系统网络定位的可能来源，应用无法判断一次结果仅用了哪个基站，也不能据此识别楼层/房间。无有效结果时显示原因，不虚构坐标。GPS实走记录和导航原精度门槛保持不变，记录/导航期间不显示独立室内切换入口。

「地图图源 → 添加地图 → 相机扫码」现在显示完整画面。原来150px高加 `object-fit: cover` 会裁掉竖屏画面，本版改 `contain` 并单独加高扫码面板。镜头列表支持手动选择；有可识别名称时优先普通后置/广角，设备允许时复位缩放并开启连续对焦。镜头名称和数量取决于手机 WebView，无法从不透明编号准确推断物理镜头。OPPO X8 Ultra 是本次用户反馈机型，尚未在该真机验证。

权限弹窗期间等待授权完成；切到后台后释放已打开的相机，返回可重新打开。切换镜头、重试和关闭会释放旧流，迟到的相机结果也会释放。二维码仅在本机解码，不采集音频、不上传画面。无法调用相机时仍可使用「二维码图片」。

## 模块与接口

- Android `ForegroundLocation.java`：前台定位和生命周期，使用 `LocationManager`；`LocationFixPolicy.java`：可独立验证的位置时间/精度选择。`NativeBridge` 提供 `locate(mode)`、`locationState()`、`stopLocation()`；`MainActivity` 转发暂停、恢复与权限结果。位置快照只保留内存。
- `modules/position/nativePosition.ts`：验证坐标、来源、误差、时间；订阅去重/过期检查。`usePosition` 管理用户动作与网页回退。`follow`/`useFollowPosition` 只抑制地图相机的小幅抖动，不改原始定位点或存档。
- `MapActions` 与 `app/page` 通过 props/定位接口提供室内入口和来源提示。`modules/mapSources/camera.ts` 管理镜头选择和流资源，`QrCamera` 提供预览与重试；`CameraPermissions` 仅允许 APK 自有域的视频授权，等待前台恢复。
- `modules/map/overlayData.ts` 被导航、轨迹、偏航引导和位置覆盖层共用：相同 GeoJSON 不重复 setData，层序已经正确时不 moveLayer；迟到的底图层仍放在路线下面。见 [闪烁调查](map-flicker-investigation.md)。

跨模块修改是因为定位/相机由 Android 权限与网页界面共同完成；使用受限桥接接口，不共享内部变量。回滚可撤销本次实现提交；既有包名/签名配置、轨迹/照片/备份格式及存储键没有迁移。`tsconfig` 排除已被Git忽略的本机工具下载和构建输出，避免将 HBuilderX 示例当作项目源码检查。

## 验证范围

TypeScript、247项逻辑回归、网页及APK构建通过。新增测试覆盖相同图源100次同步仅1次更新、稳定层序、迟到图层、定位来源与过期、模式切换旧结果、轮询停止、相机取消/镜头选择/关闭和地图相机漂移；原轨迹选择与定位覆盖层测试补齐地图接口模拟。Java定位策略9项独立检查及全部原生源码编译通过。

应用内浏览器用独立测试来源和模拟相机/定位检查：后置主摄优先、镜头选择、完整竖屏画面、900米误差显示与定位后地图缩放。390×844 / 360×780 无横向溢出，扫码切换/重试/关闭均44px高且无需滚动可见。模拟页已从交付源码/安装包排除；测试截图仅留本机 `artifacts/screenshots/`。静态移动预览没有 Android 本地网关，其地形请求错误不代表APK网关测试结果。

补充模拟相机画面中的二维码识别：成功填入测试XYZ地址，进入图源预览；相机已经关闭，没有确认添加测试图源。日志 `.openai/qr-028-decoded.log`。

没有ADB真机，未做X8 Ultra安装、相机实景扫码、室内定位精度或GPU闪烁验收。不能用上述模拟/构建检查代替真机验证。

官方依据：[Android 网络定位提供者](https://developer.android.com/reference/android/location/LocationManager#NETWORK_PROVIDER)、[权限请求可能暂停/恢复 Activity](https://developer.android.com/reference/android/app/Activity#requestPermissions(java.lang.String[],%20int))、[媒体轨道缩放与对焦能力](https://w3c.github.io/mediacapture-image/)。
