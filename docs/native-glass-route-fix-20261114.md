# 204 后续反馈：原生玻璃、路线编辑与收藏定位

## 范围和交付边界

用户于 2026-11-14 暂停后明确“继续”，本轮继续修复手机主页透明度与网页不同、路线编辑旧样式；处理中追加收藏定位必须居中到面板下方可视地图的要求。实际源码目录为 `D:/ShantuEngineResearch/old-engine-20261105`，分支 `codex/old-engine-tilt-dual-20261105`，基线 `d3af904`。本轮仍为源码/隔离验证，不升正式版本、不覆盖 204、不提交推送。

204 私人 Release 和源码同步已完成，完整 APK 下载回读哈希一致，见 `release-0.2.204.md`。204 原文件及用户收藏、记录、私人图源和配色保留。

## 已确认根因与实现

### 原生地图玻璃

Android 地图使用独立 SurfaceView，React WebView 位于上方并透明。CSS backdrop-filter 无法采样下方原生地图；保存的面板背景 alpha 为 0、工具栏约 0.01，因此仅在浏览器地图中呈现的磨砂底板在手机上几乎消失。不得通过擅自增加保存透明度来掩盖此问题。

`mobile/native-glass-regions.ts` 从实际可见面板的 computed filter、边界、圆角、透明度收集玻璃区域，随已有 uiRegions 桥发送；颜色和文字仍由原 CSS 绘制。`NativeReactGlassBackdrop` 放在真实地图与 WebView 之间，通过 PixelCopy 读取地图 SurfaceView、后台线程模糊、按真实区域绘制。没有网页地图替代，也没有通过 JS 传送图像。

实际双图追加验证发现第二个生产根因：LightningCSS 对同值 `backdrop-filter` / `-webkit-backdrop-filter` 别名保留最后一项。标准声明在前的规则被压成只有前缀属性，Android WebView 实际没有有效 blur；导致双图 `glassRegions=[]`，底栏也漏失。`scripts/mobile-css-compat.mjs` 在生产压缩前规范等价声明顺序；仅前缀时补标准，不改变不同值 fallback 或配色。真实压缩器 chrome99 回归覆盖双图菜单/工具栏/底栏；重建后原生底栏有效 glass region 已恢复。整数 clientWidth 与小数 DOMRect 的 ≤1px 差异不再清掉整个边角，真实大幅裁切仍正常处理。

预算：最长边 384px、最多 2 张地图、32 个区域、8 组模糊参数，单个采样任务在途；结束后间隔 150ms，双图轮换。按实际原生绘制序号及尺寸/模糊参数缓存，未变化时不执行 PixelCopy/模糊；保留轻量检查。捕获期间的新帧不会误标为已处理。暂停、换页、关闭后清理缓存并拒绝旧回调。已交给 Android RenderThread 的图片仅释放引用，不立即 recycle。双图菜单已经在独立原生 probe 实拍：main/aux-1 两个实际地图、菜单四个23px圆角及10px blur均被收集，菜单和上下工具栏不再丢底板；见 native-dual-menu-after.png。

### 路线编辑

`modules/tracks/RouteViews.tsx` 与 `routeWindows.css` 清除旧框选容器/标题白底；名称输入使用共享底色、浅白文字和内部圆角，聚焦整块加亮无装饰描边。框选加/减选中使用共享主操作色，吸附选中使用对应深色文字避免黄底黄字。主双图共用组件；没有改变路线数据和编辑算法。

### 收藏定位

用户追加要求：收藏面板打开时，定位照片、标记或路线的中心必须参考下方未被面板遮挡的地图区域，不能使用整张地图几何中心。需要读取实际面板边界并排除底栏/安全区；同类主双图入口统一。点型与范围型分别适配，验证状态见下表。

根因：单点 focusPoint 未取收藏遮挡，原生 fitCollection 忽略现有 padding。新增共享测量和中心 offset；原生显式 padding 路径按剩余视口拟合并纠正垂直 FOV。无 padding 导航/路线原路径保留。相机偏移在地形网格未加载时使用 WorldWind 椭球交点回退，仅用于相机摆放，不替换真实 GPS 或业务取点。底栏扣除及390俯视/360大倾角浏览器实际像素已验；原生另有投影误差单调下降与正面可见性求解，避免全球尺度盲推到极区。

点型收藏此前还会按约30米 footprint 走 fitCollection，强制放大到18级。现 pin/model（包括照片标记）按原坐标走 focusPoint；范围对象仍保留范围 fit。390 实拍：面板底439.988、底栏顶801.289、期望中心620.639，标记尖端620.498，差-0.141 CSSpx。360×780 / pitch80 实拍最终通过：期望中心564.502，标记尖端564.883，差+0.381 CSSpx；opacity=1，zoom12.1334934016、bearing-179.452保持。补修高倾角附近范围误剔除、默认Mercator getProjection未显式返回对象、面板入场期间动态offset以及地形idle后复核；后者只在收藏定位短窗口生效，用户新相机操作会取消。

### 处理中新追加的界面反馈

- 右栏选中底色：`roundedSpring.css` 中定位栏按钮使用外框半径减 3px 内缩，当前外框 23px/按钮 20px；实际右栏仍 50×326px，间距和按钮布局不变，没有裁掉弹出菜单。
- 3D/框选提示：原深色文字是误用了实心主按钮的前景色；改为透明底上的浅色选中文字，附清楚的当前状态/点击行为提示。2D→3D→2D、进入→退出框选均实点检查，未加选中底框。
- 框选操作条：`boxSelection.css` 旧白底接入共享玻璃/圆角/按钮令牌，保留 44px 触控、计数和四操作；`.map-box-tools` 纳入原生玻璃区域。
- 颜色弹窗标题：`appColorPicker.css` 精确覆盖旧 route-dialog header 白底，标题与外框共用玻璃；色块、用户当前颜色和事件未改。“选择颜色”和“自定义颜色”两态实际 computed background 均为透明，截图 `color-picker-header.png`。

## 已完成验证

| 检查 | 结果 | 证据与限制 |
| --- | --- | --- |
| Web 区域协议/显隐/伪元素/会话清理 | PASS，14 项 | `tests/native-glass-regions.test.mjs`、`native-ui-regions.test.mjs`、`native-ui-stroke-regions.test.mjs` |
| TypeScript | PASS | `.openai/glass-regions-tsc-final.log` |
| 原生策略、层级/触控、生命周期、收藏视口/偏移 | PASS，27 项 | `.openai/glass-collection-native-tests-final.log`；Kotlin 编译成功，含静态去重与相机回退 |
| 原生实际记录面板与右栏 | PASS，隔离模拟器静态画面 | `artifacts/screenshots/native-glass-route-20261114/native-recording-glass.png` |
| 关闭记录面板清理 | PASS，隔离模拟器 | 同目录 `native-panel-closed.png`，未留下模糊矩形 |
| 路线编辑 390 与 360 | PASS，浏览器局部 | 同目录 `route-editor-active-390.png`、`route-editor-360.png`；名称未修改，退出返回正常 |
| 右栏圆角与框选提示/底板 | PASS，浏览器局部 | 同目录 `right-rail-rounded-selection.png`、`box-selection-glass-and-state.png`；框选条300×109，内容不溢出 |
| 收藏点定位 390 俯视 / 360大倾角 | PASS，实际像素误差均<1px | 同目录 `collection-visible-center-390.png`、`collection-visible-center-360.png`；标记可见，当前缩放/倾角/方向保留 |
| 最终合并定向 JS + TSC / Web构建 | PASS，71项 | `.openai/glass-route-merged-final-tests.log`、`glass-route-merged-final-tsc.log`、`glass-native-web-build-final.log`；含实际DOMRect原型getter、默认Mercator、动态offset和nearby候选回归 |
| 预览脚本语法及 diff | PASS | Node check、Python AST、git diff --check |
| 双图原生菜单 | PASS，隔离模拟器静态画面 | 同目录 `native-dual-menu-before.png` / `native-dual-menu-after.png`；两个原生地图、菜单及底栏有效玻璃参数恢复 |
| OPPO、快速连续拖动、功耗/帧率 | 未验证 | PNG 刷新不等于 App 帧率；模拟器静态截图不等于手机验收 |

路线实际 computed：名称 border=0、outline=none、radius=10px，标题背景透明；360 宽下 dock clientWidth=scrollWidth=262。保存的材质预设未改。

## 隔离原生验证方式

仅验证用 APK 为 `D:/ShantuNativeTools/glass-check/hybrid/outputs/apk/debug/hybrid-debug.apk`，包名 `com.shantu.hybridprobe`、版本 `0.2.204-glass-check`，由新 native-hybrid Web 资产和 Kotlin 构建。安装到专用模拟器 `127.0.0.1:16480`，不覆盖 `com.shantu.oldengine`，不接触用户手机数据。

临时 Gradle init 脚本位于 `.openai/glass-probe.init.gradle`，不修改正式 applicationId/version。截图服务增加显式 probe/oldengine 包名选择和打开目标 App，probe 不调用旧助手的配色接口。界面明确显示包名和版本、手动截图非实时交互。用户日常预览继续使用 `phone-preview.html`；实时原生预览和设备热调色仍未完成。

模拟器启动日志另出现 WorldWind 道路图层 `NativeViewportTileDemand.mark` 的既有调用栈异常，非玻璃代码栈；本轮没有归因或扩展修复，须独立复现。未发现本轮玻璃导致的 AndroidRuntime 崩溃。


## 双图工具栏底色追加反馈（2026-11-14）

用户指出顶部、上下图源栏、底部操作栏仍是深蓝。实际 computed 已使用共享材质，不能重复换色或增加 alpha 掩盖：双图原有投影视口主动排除 36px 标题、32px 图源条与 44px 底栏，透明底下没有地图，露出宿主背景。

`comparisonChromeBackdrop.ts` 在已有 WebGL 地图 render 事件中复制真实边缘像素作为装饰背景（最长 512px、最多 10Hz，无第三张地图、无独立动画循环）；原生仅对显式标记的双图 chrome 区域使用对应真实帧的 CLAMP 延伸。保留图源、投影视口、准星、命中、按钮尺寸与全部材质参数。实际 DOMRect 的边界是原型 getter，必须显式读 top/bottom，不能对象展开；已添加对应回归。

浏览器390实际截图 `dual-bars-after-390.png` 显示四条区域已透出对应地图的磨砂底；此前 `dual-bars-before.png` 仍为深蓝。两张实际地图各复制两条区域，像素 alpha=255（仅验证时诊断，已从最终源码移除）。最终 TSC 与18项定向测试通过，日志 `comparison-chrome-tsc.log` / `comparison-chrome-tests.log`。原生新源码已编译并在新 probe 实际核对：顶部/上图源使用main，下图源/底栏使用aux-1，四区域blur10/saturation1.25；2026-11-14 15:51 CUA稳定帧显示均已透出对应地图，深蓝宿主条消失。没有把网页截图当原生证据。


### 最终收藏原生复验

新 probe 实际点击收藏测试标记后，目标位于列表底部与底栏之间的可视中心，未再飞往南极。`ShantuCameraOffset` 仅数字日志 residualPx=1.418916 / evaluations=2（物理像素，约0.44 CSSpx），截图 `native-collection-visible-center.png`；全球尺度用点状标记显示。对应真实WorldWind投影5项+offset4+viewport4+follow4，共17项原生定向PASS（替代前一版盲推求解检查），日志 `camera-offset-projection-tests.log`。原生测试只在com.shantu.hybridprobe独立数据内进行，没有更改手机或204数据。

### 收尾状态

最终合并71项定向PASS、TSC PASS、native-hybrid Web最终构建PASS。临时网页数值调试已清理；原生probe专用数字诊断不在正式oldengine包输出。实际浏览器测试页关闭，主phone-preview保留；手动安卓截图桥停止。既有204文件、版本和保存材质文件没有改动。本轮没有新的用户安装交付包，也没有提交/推送；后续如需手机测试，仍须从最终源码及用户最终调色重新构建并单独验收。
