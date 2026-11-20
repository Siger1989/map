# 山兔·优化 0.2.209 私人启动修复包

Android 目标版本 `0.2.209-test`，构建号 216，包名 `com.shantu.oldengine`，最低 Android 8.0。

209 修复 208 APK 启动时在 `jsx-runtime:1:46` 报错的问题。沿用原应用签名、安装身份、保存数据与私人内置天地图。安装前若正在记录，请先结束记录并保存草稿，再覆盖安装。

## 构建及安装包检查

208 签名 APK 中的 `jsx-runtime-BAQGd_1L.js` 从首页模块导入 CommonJS 包装函数，同时首页又导入该 JSX 模块。按 Android 资源地址冷启，错误与手机截图相同，为 `TypeError: e is not a function`、第 1 行第 46 列。209 把打包器的运行时助手放入无上游导入的独立模块，保留日月观景和行程模拟的按需加载。

生产候选构建在隔离浏览器的 Android 资源地址挂载首页和原生地图适配层。另一条浏览器业务流程实际打开工具菜单、标记观景、轨迹详情和行程模拟，退出返回原标记。全程没有页面脚本异常或生产脚本资源加载失败。截图位于 `artifacts/screenshots/sky-20261120/209-cold-flows`。TypeScript 检查通过。

- 本机 APK `D:/天气系统/APK/Shantu-0.2.209-oldengine-private.apk`，165589138 字节，SHA-256 `299cd060acf28a0bc4902b5ec8c810b87ad179253d3f08a07441926781175a2a`，同目录有校验文件。
- 终版包的 1942 份 Web 资产与构建目录逐字节一致，包内 JSX 运行时只依赖独立的构建运行时，后者无导入。应用签名、安装身份、私有天地图、39 项内置图源种子和 35 项已保存材质参数核对通过。
- 四种 ABI 的 8 个库与 208 逐字节相同。ZIP 原生库直存、ZIP 与 64 位 ELF 的 16 KiB 对齐、条目唯一性和 CRC 核验通过。208 的已交付 APK 保留，原文件校验值未变。
- APK 来自应用源码 [161f290](https://github.com/Siger1989/map/commit/161f290209db06dbc81c2019c82cec9870058544)。已从签名 APK 提取最终资源，在 Android 资源地址完成启动回归。Android 15 隔离模拟器（WebView 124）复现了 208 的同一异常。随后保留数据覆盖安装 209、强停并重开，首页与原生地球上的影像均可见。最初自动检查超时，稳定后从同一前台进程重新取证，确认已安装 APK 的 SHA-256 与交付件一致、存在原生 SurfaceView，并读到 52 个无障碍节点及路线、工具、记录三个菜单。本机证据在 `artifacts/screenshots/android-startup-209`。OPPO 真机与具体区域的高分辨率天地图瓦片加载仍待复验。
- 已发布到专用私人仓库。发布前后仓库均为 PRIVATE，服务端大小与 SHA-256 匹配，完整 APK 下载回读通过。授权账户可访问 [209 私人 Release](https://github.com/Siger1989/shantu-private-delivery/releases/tag/v0.2.209-private) 或 [下载 APK](https://github.com/Siger1989/shantu-private-delivery/releases/download/v0.2.209-private/Shantu-0.2.209-oldengine-private.apk)。

HarmonyOS 6.1 原生 HAP 本次未交付。原生签名和邀请测试条件见 [鸿蒙适配与安装](harmonyos-6.1-install.md)。
