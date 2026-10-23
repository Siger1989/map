# 山兔 0.2.131：PC优化与双平台同步

2026-10-23，按用户要求将当前地图与交互优化同步到 Windows 单 EXE，并整体交付 Android APK、源码、说明与校验文件。安装包、应用内标识及桌面服务统一为 0.2.131-test；Android versionCode 138，沿用 `com.guanyun.weather.shantu.preview` 和原签名。旧版本保留。

## 本次变化

- PC纳入高清影像档位、蓝顶白地平线天空、区域绘制计算预算、导航原起点与进度、输入法焦点避让等当前共享源码优化。
- 修复PC矮窗口高清菜单向上展开而被裁的问题：原来640×600时面板顶部约为 -54px；矮窗口下改用视口定位，避让顶部栏及右侧3D/框选，窄窗口同时限制宽度。
- 外层桌面平移摇杆与iframe中的菜单不共享层叠空间。图层菜单打开时暂时隐藏摇杆并结束其持有手势，菜单关闭、外部点击或Escape后恢复；切换到行业页仍隐藏，返回地图按菜单状态恢复。使用输入事件合并刷新，不添加轮询。
- 修正共享版本标识与Android安装元数据不同步的问题，并新增跨平台版本一致性回归检查。

本轮实现文件为 `desktop-app/shell/shell.js`、`config/product.ts`、`mobile/android/AndroidManifest.xml`；测试更新 `tests/desktop-pan-lifecycle.test.mjs`，新增 `tests/release-version.test.mjs`。未改存档格式、图源凭据、地图算法或行业绘图算法。

## 验证

| 项目 | 结果 |
| --- | --- |
| 定向与类型检查 | Android相关32项与tsc PASS；桌面/共享相关27项 PASS（两组有重叠，不累加） |
| 桌面菜单与操作 | 360×480、390×480、640×600、1366×900实际截图与computed检查 PASS；菜单不与3D/框选相交，高约196px，内容无需滚动；关闭/Escape、高清切换、摇杆恢复、行业页及返回 PASS |
| 最终EXE网页界面 | 直接运行最终私有EXE的隐藏服务，在640×600再次核对内置天地图、实际影像、高清菜单与摇杆避让 PASS；最终截图 `artifacts/screenshots/release-131/final-exe-quality-640.png` |
| 桌面包内容 | 私有/公开内嵌runtime分别1929/1928项，与各自fresh stage逐文件一致；三个shell资源与最终源码一致；网页和服务均含131版本标识 |
| 最终EXE独立自检 | 两份最终单EXE均exit0、frozen=true、embedded=true、ok=true；地图/行业统一服务、模板、HEAD语义及实际剖面/钻孔SVG与PNG生成 PASS |
| Android包 | 私有/公开fresh构建，aapt真实138/131、原证书、对齐、CRC PASS；1926/1925网页资源一致，497张PNG像素一致，包内界面版本标识131 |
| 配置隔离 | 私有包保留既有Key及39项图源；公开两平台无私有seed、私有环境值匹配0，地质云私有配置为空 |

桌面导入成本另做6次独立进程测量：地图启动未加载openpyxl、PIL、numpy或matplotlib，Excel读取原本已延迟导入，因此未做无实证收益的启动结构重写。本轮不宣称整体启动秒数或帧率提升。

截图与核验日志分别在 `artifacts/screenshots/release-131/` 和本机ignored目录 `.openai/release-131/`。地图检查仍出现部分高程瓦片缺失；IP估计位置不代表真实GPS。原生Windows WebView2窗口操作、Android真实安装/IME/GPS/后台/触控/FPS未在本轮验收；浏览器访问EXE服务不等于原生窗口验收。HarmonyOS 6.1原生包仍未交付。

## 产物

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| 自用PC `山兔桌面-0.2.131-private.exe` | 123848765 | `35a2201fc1802160c68ba799f4942a9cd786e638fcffac5a787a0cbc26de681a` |
| 公开PC `Shantu-0.2.131-windows-x64.exe` | 123844960 | `b83c22fb41b1373cbe248e4cf83b7476bb705552066189f206b8f6e560f75717` |
| 自用APK `Shantu-0.2.131-test-private.apk` | 70269113 | `4c66cfbe5d8ad2bb499890ebfeadad45024dc084cfb2a8a270d669d807ba8b03` |
| 公开APK `Shantu-0.2.131-test-public-standalone.apk` | 70269029 | `171636c8d0f03b53c7958b7e68737c04e8e5df403b9828280469ef94810ae03a` |

自用版本化文件及固定入口 `EXE/山兔桌面.exe`、`APK/山兔手机.apk` 仅在本机交付；不能用无Key公开包覆盖它们。Windows需WebView2 Runtime；行业PNG导出需系统Edge或Chrome，无需另装Python或Node。

源码同步分支 `codex/place-address-search-20261011`，未合入main。[GitHub测试发行](https://github.com/Siger1989/map/releases/tag/v0.2.131-test-standalone)只上传公开EXE、公开APK、SHA256SUMS与使用说明。远端源码SHA及资产状态/digest核对结果保存于本机 `source-sync.json`、`github-verification.json`。
