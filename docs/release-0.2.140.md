# 0.2.140-test：Mac 原生系统能力

用户确认保留现有地图界面，系统功能由原生应用实现。地图继续使用 MapLibre/WKWebView；本轮不是把网页改名为原生界面，也不是全量重写地图。

## 本轮改动

- `desktop-web/macos/NativeLocationService.swift`：CoreLocation 定位与权限状态、原生轨迹记录和 Application Support 存档。拒绝权限、关闭系统定位和等待授权分别报告；不以 IP 位置代替真实定位。Mac 的系统定位标注 network，不保证 GPS 精度。
- `NativeOfflineService.swift`：独立 URLSession 下载，最多16个并行任务/每主机16个连接，按图源限流退避；磁盘瓦片、断点续传、重启后暂停、校验和共享瓦片删除。无信号读取本地缓存不依赖 DNS；磁盘占用增量计算，不逐瓦片扫描整个目录。
- `NativeFileService.swift`、`NativeCameraService.swift`：系统保存面板、分享服务、剪贴板、相机授权与拍照。保存/分享必须收到原生完成结果，取消不能报告成功。
- `NativeBridge.swift`、`ShantuApp.swift`：独立异步 `ShantuMac` 接口、原生菜单、权限入口、后台任务状态。只接受可信主页面请求；不模拟 Android `GuanyunNative`。关闭窗口保留应用，Dock 可重开；明确退出时提示并保存暂停状态。
- 前端 platform、position、outdoor、files、photos、placeShare、routeShare 和复制入口接入原生服务；记录结束先等待原生最终状态，保存完成才清空。

旧 WebKit 缓存包仍可读删，没有自动搬迁到新原生仓库。原有收藏、路线格式、Android 包名和签名保持兼容；本轮不改变地图画质、相机位置、前台地图并发或139临时缓存策略。

## 验证与交付状态

当前为施工记录，安装包路径、哈希及最终 CI 结果在完成后补入。前端定向30项、TypeScript、DMG构建器Go检查已通过。macOS 原生存档/离线/文件 harness、受控真实单图下载和窗口桥接正在按最终源码复核。

私人交付保留用户已注册天地图与39个图源种子。GitHub Actions 的无凭据素材仅供隔离测试，不作为用户安装包发布。源码版本140/code147不等于Android APK已更新；固定APK与9174预览目前仍是139。

## 必须单列的边界

- 真实Mac上的定位授权/拒绝/撤回、实际位置精度、相机、系统分享及长期后台行为仍须设备验收；CI构造 CLLocation 只检查数据协议，不是取得了实际GPS。
- 合盖、睡眠、断网和明确退出可能中断任务；不承诺进程退出后继续下载。
- 此前 Intel CI 的 WebGL2 图形检查失败，不能用双架构编译成功替代实际地图渲染通过；最终结果另行记录。
- 没有 Developer ID 签名及 Apple 公证，不能声称 Gatekeeper 验收通过。
- 私人天地图上一轮曾返回429，本轮不反复请求该图源，也不把原生下载测试当作天地图服务验收。
