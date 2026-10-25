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

已交付私人DMG：`交付包/山兔-0.2.140-test-2026-10-25/03-macOS-DMG/Shantu-0.2.140-test-macOS-private.dmg`，147,944,180字节（约141.1MiB）。SHA-256：`ed6d32208d9cc197c24ef1cda9d9596d31780a4a2c9e051e5ab36224ed6d5ef3`。

用户明确目标为苹果M系列。功能源码 `fca49f3bc64e4b44c262e56d11b2e989c3e318e8`，本轮说明文档在其后更新；实际推送分支为 `codex/place-address-search-20261011`，未合入main。

| 核验 | 结果与边界 |
|---|---|
| 前端与构建 | 最终31项定向测试、TypeScript、私人fresh Vite、Go DMG检查通过 |
| [原生服务CI](https://github.com/Siger1989/map/actions/runs/40207117853) | Apple Silicon和Intel均通过编译及定位/记录、离线、文件harness；原生URLSession实际下载本仓库固定提交Logo，比对字节、重建服务后读取与删除通过；非真实定位或图源测速 |
| [实际窗口CI](https://github.com/Siger1989/map/actions/runs/40207117856) | Apple Silicon/macOS14.8.9挂载、清单、原生Node、地图窗口、ShantuMac桥、存储、导出、重复启动及进程退出通过；截图主代理已复核 |
| 手机尺寸回归 | 390×857、360×780记录设置可达，保存中对应字段禁用、完成恢复；浏览器模拟桥，不等于Mac系统权限通过 |
| 私人包完整性 | 7-Zip测试与解包通过，1,934清单哈希、1,925最终预览文件、499地形文件、39私人图源和ground-coverage一致；三个权限用途说明、macOS13最低版本和arm64/x64 Mach-O通过 |
| 原生二进制 | 与上述窗口CI产物逐字节一致，SHA-256 `317ed05d9eadb6b76780c12198d7550d949a80214daf4c9b408a773e49af62a6` |

复核记录：`.openai/release-140/mac-private/dmg-integrity.json`、`.openai/mac-native-20261025/`，截图 `artifacts/screenshots/mac-native-140/`。交付目录只放私人Mac包、校验及说明；138等历史包保留。私人包未上传公开Release。

私人交付保留用户已注册天地图与39个图源种子。GitHub Actions 的无凭据素材仅供隔离测试，不作为用户安装包发布。源码版本140/code147不等于Android APK已更新；固定APK与9174预览目前仍是139。

## 必须单列的边界

- 真实Mac上的定位授权/拒绝/撤回、实际位置精度、相机、系统分享及长期后台行为仍须设备验收；CI构造 CLLocation 只检查数据协议，不是取得了实际GPS。
- 合盖、睡眠、断网和明确退出可能中断任务；不承诺进程退出后继续下载。
- Intel最终窗口CI失败，不宣称Intel地图通过；此前及本轮中间构建也观察到WebGL2图形检查失败。它不属于本轮用户确认的M系列目标，双架构编译成功也不等于Intel图形通过。
- 没有 Developer ID 签名及 Apple 公证，不能声称 Gatekeeper 验收通过。
- 私人天地图上一轮曾返回429，本轮不反复请求该图源，也不把原生下载测试当作天地图服务验收。
