# 2026-10-13 PC 同步到 0.2.124

用户确认“优先文字清晰，保留切回原注记的选项”，随后要求“这些优化都要同步到PC”，覆盖此前暂停 PC 的指示。本轮从活动工作树 `.openai/worktrees/place-address-search-48c80e0`、分支 `codex/place-address-search-20261011`、基线 `57635e63a647c0065fb8318ee702d89c37237932` 构建新的本机私有桌面 EXE。源码同步该分支，未合入 main；最终提交核对记录在本机 `.openai/pc-sync-20261013/source-sync.json`。

## 同步范围

- 桌面地图与手机共用 `mobile/main.tsx` → `app/page.tsx`。本次 fresh 构建包含 121–123 之后的搜索/路线与拖动性能修复，以及本轮远处图标提前剔除、清晰地名、路线输入布局修复。
- `NearbyMarker`、注记、照片和选点共用距离门禁，随 CSS 视窗尺寸和缩放变化，最大 30km。范围外只做廉价距离筛选，不参与原生标记投影/地形遮挡/挂载。桌面低缩放总览也遵守此上限，即使屏幕覆盖更远地区，也不显示距中心超过上限的这些图标；靠近恢复对象与数据。
- `DEFAULT_TIANDITU_LABELS='vector'`：新设置或缺失注记字段时默认清晰文字；仍保留原图注记（自动）、CIA/CVA/CTA 与关闭选项。显式保存的旧注记偏好保持；切回原图后重新打开仍保留选择。天地图底图、Key、境界和原有图层不被替换。清晰文字采用 OpenStreetMap 数据，部分乡村地名覆盖与天地图不同。
- `mobile/keyboardViewport.ts` 区分移动 IME 与普通桌面缩窗。此前输入聚焦后同宽度缩高可能误判键盘并冻结主体；现仅移动设备或明确打开的手机预览键盘触发布局锁定。`phonePreviewKeyboard.js` 在缩小 iframe 前设置模拟标记，关闭时移除。九宫格只属于手机预览；PC 使用正常键盘。
- 版本元数据更新为 `0.2.124-test/code131`。桌面外壳、行业生图、包名/签名、存储键和数据格式未改；PC 继续隐藏记录入口并禁止导航自动启动隐藏记录。固定手机 APK 仍为 `0.2.123-test/code130`，本轮未重新打 APK、安装或验收手机。

新增共享距离、键盘与路线聚焦模块及定向测试；删除旧的仅靠 CSS 隐藏远选点的 `selectionMarkerVisibility.ts` 与对应旧测试，保留山体遮挡 CSS。详细模块、根因和前次浏览器性能计数见[远点与键盘](nearby-icons-keyboard-20261013.md)、[地名清晰度](place-label-clarity-20261013.md)。

## 本机交付

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| 原工程 `EXE/山兔桌面.exe`、`EXE/山兔桌面-0.2.124-private.exe` | 123831619 | `b6b9cb9bce2ca0e965e88db3a3a4fce4a18b59229320346cf273296364aa2a8e` |

固定入口已经替换并逐字节哈希核对。旧私有120归档保留，hash未变；构建使用本机原有 `.env.local` 与39项图源种子，文件hash在构建前后相同。含Key EXE只在本机交付，没有上传公开Release。公开桌面Release仍是120，不能以其代替新的私有本机版本。

仍需要 Windows x64 和 Microsoft Edge WebView2 Runtime；PNG生图需要系统 Edge/Chrome。直接运行单EXE，无需安装 Python/Node。验证采用独立中文/空格目录、隔离数据目录和临时端口，没有清理或写入用户真实存档。

## 验证

| 检查 | 结果与证据 |
| --- | --- |
| 定向逻辑 | PASS：主审32项（键盘7项与地名/图源25项）；子agent桌面/平移/录制平台/双图/距离/图层68项，部分与32项重叠，不相加计数。此前84项共享检查结果见对应功能记录 |
| 类型与构建 | PASS：最终 `npx tsc --noEmit`、fresh私有地图runtime、PyInstaller单EXE、diff whitespace检查 |
| 私有配置与资源 | PASS：Key存在且实际嵌入、seed39项/字节一致、地质配置匹配；1926网页文件，1932项runtime/桌面外壳资源逐文件与EXE内嵌hash相同，0缺失/不匹配 |
| 单文件独立启动 | PASS：只复制新EXE到隔离中文/空格目录运行 `--self-test`；frozen/embedded=true，服务版本124、shell/map/industry与HEAD检查、四模板、剖面和钻孔SVG/PNG均通过 |
| 实际桌面主图 | PASS：从新EXE启动的统一服务读取界面，版本124/code131；内置天地图默认vector，auto→重新载入→vector→重新载入保留偏好，切换不改变相机；86次影像、49次原注记、33次矢量请求返回200，无page错误 |
| 窗口与路线输入 | PASS：1366×900、1366×620、1024×768、1920×1080；起点保持聚焦及文本，地图高度分别856/576/724/1036，随44px外壳栏正确变化，不误开键盘锁定、不横溢出，PC没有记录入口；主审检查computed边界、截图与关闭 |
| 双图 | PASS：1366×900左右均为内置天地图影像且显示青城山等清晰文字；左关闭道路但地名保留，右道路独立；两个canvas均683×748；退出后主图道路/vector/相机保持；主审已看截图 |
| 距离与返回 | PASS：实际EXE地图点击附近选点，移至约50km外后节点脱离，拖动后仍脱离；返回后恢复同一DOM元素。行业页切换/返回保留地图 |
| 手机预览回归 | PASS：新预览标记下390×857、360×780、390×480九宫格输入/删除/关闭、主体保持与输入可见；同三尺寸图源切换/返回；实际用户9174预览已是清晰文字且相机未变 |
| 未验证 | Windows原生WebView2窗口权限与长期性能、真实GPS/触控/手机IME/后台/相机/分享；浏览器与单文件自检不等于真机验收。没有重跑无关的完整记录/绘制显隐矩阵 |

第一次双图脚本在行业iframe尚未加载时取frame得到null；改为等待实际frame locator后重新运行通过，产品源码不因该测试时序问题更改。

本机证据目录 `.openai/pc-sync-20261013/`：`private-build.log`、`private-payload-audit.json`、`selftest-private/self-test-report.json`、`desktop-main.json`、`desktop-dual-marker.json`、`keyboard-browser.json`、`phone-label-menu.json`、`default-keyboard-tests.log`、`tsc.log`、`final-artifacts.json`。68项子agent检查的完整输出在本轮任务记录中。截图位于 `artifacts/screenshots/pc-sync-20261013/`：版本、主图、清晰默认、四种窗口路线、双图、远/近选点。主审查看了主要截图与实际computed结果。日志、截图和私有产物不提交。

后续改图源/注记默认须复测保存、切回与双图；改键盘/响应式须同时复测手机九宫格和PC聚焦后只缩高度；改范围算法须复测30km门禁、resize和恢复点击。手机APK升级仍需用同一私有配置重新构建，不能把网页更新当作手机已更新。
