# 0.2.136-test：缓存启动线程错误修复

用户真机截图显示 `offlineBegin` Java invocation exception，进度 0/22238。代码定位到 `NativeBridge.offlineReady()` 在 JavaScript bridge 线程调用 `MainActivity.trustedForeground()`，后者直接读取 `WebView.getUrl()`；WebView 要求所属 UI 线程访问。135 的网页模拟和服务检查未覆盖实际桥接线程，不能把此前检查当作原生启动验收。

## 修改

- 新增 `BridgePageState`：UI 导航/生命周期回调维护 volatile 页面可信与前台状态；桥接线程只读该状态，不同步等待 UI 或访问 WebView。主页面 URL 仅允许精确 index.html 及 query/fragment，暂停、销毁、离开可信页撤销访问。
- `MainActivity` 接入页面开始、历史更新、resume/pause/destroy 回调。缓存文件读写仍在桥接/下载线程；8路下载、容量/级别、存档与界面布局保持。
- 新增真实 Java 类的跨线程回归及 MainActivity 接入检查。
- 版本136、Android143；保持 `com.guanyun.weather.shantu.preview` 与原签名。

## 证据与交付

- 5/5 定向通过：桥接状态、生命周期/页面接入、分块任务与启动协议；Java检查实际编译生产类并从独立线程读取。
- fresh 私人APK构建通过；原证书 SHA256 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`，v2/v3签名有效。
- 包内1927项资源及DEX与构建暂存逐项一致；已注册天地图Key存在性与39图源种子一致。没有生成或公开发布无天地图交付版本。
- 文件 `交付包/山兔-0.2.136-test-2026-10-24/01-Android-APK/Shantu-0.2.136-test-private.apk`，70,301,972字节；SHA256 `45c5acda0f50fa6d381ec48cae7bdef0d0c13104dbc04bedd54333c7f271c12f`。固定 `APK/山兔手机.apk` 同步，135历史包保留。
- 日志 `.openai/release-136/`；没有修改UI布局，本轮不声称新增视觉验收。

直接覆盖安装后，在失败包点击“继续缓存”；首次需允许通知权限再继续。本机尚未取得用户手机日志或完成Android真机复测；JVM跨线程回归不等于真实WebView/后台服务验收。需复测0进度启动、通知暂停续传、切后台/锁屏继续及真实图源下载。Mac独立窗口继续验证，当前不以未通过的CI镜像替换私人DMG。
