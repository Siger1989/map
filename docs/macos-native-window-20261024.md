# Mac独立应用窗口改造（2026-10-24）

用户指出旧DMG打开浏览器。已确认旧 `Shantu.app` 是shell启动器，调用Terminal运行本地Node服务后打开默认浏览器。该交付与用户期望的独立应用窗口不符。

本轮目标：保留现有地图/API/个人配置，改为AppKit + WKWebView原生窗口；双击应用直接显示地图，退出时终止自己启动的服务；既有同版本服务只复用、不擅自关闭。保持bundle ID `org.shantu.map.launcher`，支持macOS13及以上的Apple Silicon/Intel。

## 实施

- `desktop-web/macos/ShantuApp.swift`：原生主窗口、菜单、WKWebsiteDataStore持久存储、上传/下载面板、同源blob导出；只在用户点击外部链接时调用默认浏览器。读取Resources/manifest.json精确版本与本地服务握手。
- `build-launcher.sh`：macOS Swift/Xcode编译arm64/x86_64，再合为universal Mach-O。
- `scripts/macos-dmg/`：必须传入 `-launcher`；验证双架构Mach-O，拒绝把shell启动器重新封装为新版应用。保留payload/私有地图/图标/Applications链接和原bundle ID。
- `.github/workflows/macos-dmg-check.yml`：双Mac架构编译、只读挂载、实际WKWebView窗口/截图/WebGL2/localStorage/IndexedDB/blob导出与退出清理测试。远端只使用既有无凭据测试素材；不会将私人Key或交付DMG上传CI。

## 验证状态

Windows本地Go测试通过，Python挂载验证器语法检查与workflow YAML解析通过。macOS CI运行40107281881：Apple Silicon/macOS14.8.9通过挂载、完整manifest、原生Node、服务重复启动、实际WKWebView地图/WebGL2、localStorage/IndexedDB、blob导出与退出清理；主审查看原生窗口截图。Intel任务的WebGL2创建失败，地图未通过，不能宣称双平台验收完成；不据此断言所有Intel真机不支持。

修复实际启动故障：HTTP流水线中的后续Response尚未绑定socket，旧Host校验读取该socket端口导致同源JS/CSS误403。现从Request.socket.localPort取端口；真实TCP流水线回归从200/403/403修正为200/200/403，外域Host仍拒绝。

本机已生成137私人DMG候选（147555007字节，SHA256 `2417a24cfcc48a1917f4c13a40a94bfdc618b62338c7c1a186e6a71814acb2b2`），使用CI编译的universal原生窗口和137私人payload。保留于本机 `.openai/release-137/mac-private/`，未放入正式交付目录、未公开上传；完整Mac验收仍未通过。CI使用无凭据测试素材，不能代替这个私人候选的设备验收。

后续用户交付只保留已注册内置天地图和39图源的私人DMG，不额外交付无天地图版。旧浏览器存档不自动转移到WKWebView；旧数据保留，使用应用内备份导出/导入。新应用有帮助菜单说明。开发者签名/公证、Finder Gatekeeper和用户真机定位/触控仍需单独核验。
