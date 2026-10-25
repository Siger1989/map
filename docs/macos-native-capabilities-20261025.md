# Mac系统能力补齐（140）

用户确认：保留现有地图界面，定位、文件、缓存下载、菜单和权限等系统功能全部由原生应用实现。不重写MapLibre地图界面，不把WKWebView窗口等同于完整系统适配。

## 本轮目标与边界

1. CoreLocation原生定位与明确的授权、拒绝、关闭、等待状态。Mac定位标注系统/网络来源，不能冒充GPS；禁止定位失败后悄悄用IP当原生位置。
2. 原生轨迹记录和Application Support持久化，切到后台不依赖网页timer；显式退出保存暂停状态。保护现有网页/Android存档。
3. URLSession原生瓦片下载、原子文件保存、断点续传、暂停、重启恢复、共享瓦片隔离删除；窗口关闭可保持任务，显式退出需提示并保存暂停，不声称进程退出后仍下载。
4. NSSavePanel文件保存、NSSharingService系统分享、NSPasteboard复制和原生相机；按需请求权限。系统选择器取消不能报告保存成功。
5. 原生菜单、窗口重开、任务状态/权限帮助、异常退出提示；保留天地图与私人种子。未签名公证及Intel图形问题分别记录，不用本轮接口完成冒充解决。

## 接口与实施

Swift服务分别负责定位/记录、离线、文件与相机。WKScriptMessageHandlerWithReply提供异步请求和真实结果；只接受本机固定可信主frame，外部网页和iframe不能调用系统能力。前端使用独立ShantuMac适配器，不伪装Android GuanyunNative。异步存储先等待原生完成再报告成功。

## 门禁

定向检查：消息来源与参数、文件大小/取消/顺序、下载地址/重定向/响应体边界、缓存共享删除、记录有效性/损坏保护、前端异步错误与旧Android兼容。Mac CI编译双架构，实际WebKit桥接、存储、文件往返与窗口生命周期。真实定位授权/拒绝/撤回、相机、分享和长时间后台下载必须单列真实设备待验，不能注入假坐标作为真机通过。

## 最终核验

用户已确认目标机器是苹果M系列。功能源码为 `fca49f3bc64e4b44c262e56d11b2e989c3e318e8`：

- [原生服务CI](https://github.com/Siger1989/map/actions/runs/40207117853) 在Apple Silicon与Intel均通过应用编译、定位/记录存档、离线及文件harness。离线测试实际下载本仓库一张固定提交Logo，核对原始字节、重建服务后读图和删除；不使用用户地图Key。
- [应用窗口CI](https://github.com/Siger1989/map/actions/runs/40207117856) 的Apple Silicon/macOS14.8.9完成挂载、清单、原生运行时、实际WebKit地图窗口、ShantuMac调用、存储、导出、重复启动及进程退出检查。主代理查看窗口截图；系统定位在CI中关闭，显示明确系统状态，不能算真实定位通过。
- 前端最终31项定向测试、TypeScript、私有fresh Vite构建、Go DMG测试通过。390/360两尺寸记录设置及保存中禁用/完成恢复通过浏览器模拟，证据见 `artifacts/screenshots/mac-native-140/`。

原生记录配置落盘后才确认，结束记录等待完成后保存再清空。配置保存中防重复提交。距离过滤随自定义距离生效；静止降频根据CoreLocation实际速度调整，速度不可用时保持配置基线，前台定位订阅优先保留导航所需更新。该策略不保证电脑具备GPS或达到所选精度。

私人DMG完整性结果及实际交付路径见 [140交付](release-0.2.140.md)。实际用户机器上的权限、相机、分享、长期后台、Gatekeeper/公证仍单列未验。地图窗口保留WKWebView，系统服务由Swift/AppKit/CoreLocation/AVFoundation/URLSession执行。
