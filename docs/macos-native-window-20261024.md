# Mac独立应用窗口改造（2026-10-24）

用户指出旧DMG打开浏览器。已确认旧 `Shantu.app` 是shell启动器，调用Terminal运行本地Node服务后打开默认浏览器。该交付与用户期望的独立应用窗口不符。

本轮目标：保留现有地图/API/个人配置，改为AppKit + WKWebView原生窗口；双击应用直接显示地图，退出时终止自己启动的服务；既有同版本服务只复用、不擅自关闭。保持bundle ID `org.shantu.map.launcher`，支持macOS13及以上的Apple Silicon/Intel。

## 实施

- `desktop-web/macos/ShantuApp.swift`：原生主窗口、菜单、WKWebsiteDataStore持久存储、上传/下载面板、同源blob导出；只在用户点击外部链接时调用默认浏览器。读取Resources/manifest.json精确版本与本地服务握手。
- `build-launcher.sh`：macOS Swift/Xcode编译arm64/x86_64，再合为universal Mach-O。
- `scripts/macos-dmg/`：必须传入 `-launcher`；验证双架构Mach-O，拒绝把shell启动器重新封装为新版应用。保留payload/私有地图/图标/Applications链接和原bundle ID。
- `.github/workflows/macos-dmg-check.yml`：双Mac架构编译、只读挂载、实际WKWebView窗口/截图/WebGL2/localStorage/IndexedDB/blob导出与退出清理测试。远端只使用既有无凭据测试素材；不会将私人Key或交付DMG上传CI。

## 验证状态

Windows本地Go测试通过，Python挂载验证器语法检查与workflow YAML解析通过。Swift首次编译和WKWebView运行等待macOS CI，不将构建脚本存在称作应用验收。

后续用户交付只保留已注册内置天地图和39图源的私人DMG，不额外交付无天地图版。旧浏览器存档不自动转移到WKWebView；旧数据保留，使用应用内备份导出/导入。新应用有帮助菜单说明。开发者签名/公证、Finder Gatekeeper和用户真机定位/触控仍需单独核验。
