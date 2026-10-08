# 2026-10-08 地图与行业生图桌面合并

## 项目目标与范围

这是已确认山兔项目的桌面交付扩展。按用户本轮要求，在项目根目录建立 `EXE/`，将完整地图与行业生图放进同一个可全屏的Windows应用。保留地图业务、图源、轨迹/收藏/标记/绘制及存档格式；不重新设计手机版地图。之前的独立行业EXE作为构建依据，本轮最终交付以合并应用为准。

## 功能清单

- 顶部地图/行业生图切换，两个页面保留挂载，切换不重载相机、草稿、表单或生成结果。
- 完整地图复用 `mobile/main.tsx` 的原应用入口，在桌面可用区域铺满；不是手机预览框。
- 行业页面复用Python实测剖面/钻孔柱状图管线、Excel模板与SVG/PNG及附表输出。
- 可调整窗口大小，顶部按钮/F11控制全屏。地图自己的Escape操作保留。
- 随包携带Node与Python运行资源，用户无需另装开发环境。WebView2为Windows窗口依赖。
- 同源本机服务与持久化WebView目录，保留本机存档。平台原生能力按实际支持分别验收。

## 施工文档

`scripts/build-desktop-map.mjs`构建完整地图静态资源、本机API和主题脚本，复制Node到 `EXE/山兔桌面/resources/map-runtime/`。主题复用 `modules/appearance/theme.ts`，不另造调色板。配置只读取本机需要的Key/种子，不拷贝整个环境文件，不输出Key。

`scripts/build-desktop-exe.ps1`再通过PyInstaller打包 `desktop-app/desktop_main.py`、原行业管线、模板及 `desktop-app/shell/`。输出 `EXE/山兔桌面/山兔桌面.exe` 与配套资源；发布须复制整个目录。

Python网关固定本机9190端口：`/map/`转发完整地图首页，地图资源/API转发自带Node；`/industry/`与行业API由原Python服务处理。两个iframe同源，各自DOM保留。Node使用动态内部端口、ready JSON就绪握手；关闭应用结束自己的服务。不得结束用户已有9174预览与3108服务。

用户文档目录 `山兔桌面`保存行业上传/生成/日志及WebView profile；不写入可执行程序资源，不清除真实用户缓存。内部服务只绑定loopback，端口冲突不能静默换源导致存档似乎丢失。

## 鼠标与手机操作研究

源码证据：`TerrainMap.tsx`启用单指/鼠标拖移与触摸缩放俯仰，当前MapLibre默认启用滚轮、右键旋转、键盘与Shift框选。双图继续复用TerrainMap。以下普通操作映射由当前安装源码确认，运行验收另列。

|操作|Windows鼠标|手机触摸|
|---|---|---|
|浏览平移|左键拖动|单指拖动|
|缩放|滚轮或缩放按钮|双指捏合或缩放按钮|
|旋转/俯仰|右键拖动或Ctrl+左键|双指转动/上下滑动|
|绘制|左键承担笔画|单指承担笔画，第二指可中断并转为地图操作|
|自定义框选|左键拖矩形|单指拖矩形，双指可操作地图|
|长按添加|源码中静止左键约550ms同样触发|长按约550ms|

实测绘制时左键产生笔画，相机不平移；松手后滚轮可缩放，右拖改变方位/俯仰，不能替代平移。需先暂停绘制，再左拖地图并继续草稿。框选时左拖产生矩形，鼠标没有双指导航的直接对应；需退出框选再平移。没有用合成触摸事件冒充真实手机手势。

发现框选透明层z-index24挡住原z-index12的右侧缩放栏，按钮虽然可见却不能点击。桌面shell只在地图iframe载入后附加一条限定框选状态的样式，将右栏/视角控件提升到25；退出恢复12/13。未改手机CSS、地图计算或选择逻辑。三种桌面尺寸实际点击放大、镜头控件命中、空白区域矩形拖选及退出通过。

## 项目门禁与验收

- 构建与运行：自带Node独立启动，状态/静态资源/API/模板路由有效；隐藏自检生成两种SVG/PNG。
- UI：1366×900、1920×1080、1024×768实际computed、截图、点击切换；地图铺满余下区域、无横溢。F11与按钮全屏退出不吞地图Escape。
- 状态：切换前后相机/草稿、行业结果和表单保留；关闭重开使用同一origin/profile，不能清真实用户数据做验收。
- 原生能力：Windows真实定位/相机/分享/后台、原生全屏与下载保存对话框分别记录，未测不能称通过。
- 用户反馈修复：此前保存窗口源于自动GUI下载验证，已移除测试触发代码并停止测试EXE；本轮不再自动打开原生保存对话框。
- 安全交付：`EXE/*`产物默认忽略，仅README进Git。包含私有Key的桌面目录/APK不公开上传；源代码单独同步当前功能分支，不声称已合main。

## 实际验收记录

主代理使用隔离Playwright会话，直接访问合并EXE的隐藏服务9190；未修改用户9174预览存档。截图目录 `artifacts/screenshots/pc-dot-20261008/`。

|项目|证据与结果|
|---|---|
|地图尺寸/布局|1366×900、1920×1080、1024×768，地图CSS及canvas分别为1366×856、1920×1036、1024×724；顶部44px，无横向溢出。主审实际查看三尺寸截图：PASS（浏览器）。|
|行业页面|三尺寸无横溢，内容可真实纵向滚动；实测剖面43记录/26测段、钻孔23分层/131回次，SVG实际载入。PASS（浏览器与EXE管线）。|
|平移/缩放/旋转|实际左拖中心坐标变化、滚轮zoom变化、右拖bearing/pitch变化：PASS。没有伪造GPS。|
|切换保留|地图hash相同；绘制44.0公里隔离草稿切换后保留；行业结果、选中文件保留：PASS。未点完成/保存测试路线。|
|框选控件遮挡|修前FAIL；桌面限定层级修后，三尺寸实际放大zoom+1、镜头控件可命中，矩形300×200px，退出恢复原层级：PASS。截图`desktop-box-*.png`。|
|双图与返回|完整桌面并排双图，2个MapLibre canvas，实际退出恢复1个及主图操作：PASS。截图`desktop-dual.png`。|
|浏览器全屏|顶部按钮进入，文案变为“退出全屏”；焦点在地图内按F11退出：PASS。原生WebView窗口全屏未验证。|
|本机服务并发|初次候选出现连接拒绝；HTTP队列从默认5提高128后，最终EXE新隔离会话首次加载/重载，本机请求失败0、pageerror0：PASS（定向样本，不宣称负载测试）。|
|Node与脚本资源|复制的Node v24.14.0动态loopback启动、ready/PID/版本、首页/JS/API/39项图源与Key布尔一致：PASS。补`.mjs` MIME后worker HEAD/GET200且为text/javascript。|
|EXE隐藏自检|两类模板实际导入、SVG/PNG生成，四模板齐全，网关GET/HEAD与地图API：PASS；报告`.openai/build/desktop-app/EXE自检路径 中文 与 空格/self-test-report.json`。|
|Windows原生能力|窗口显示/原生全屏、WebView重启持久性、真实GPS/相机、后台记录/系统分享、实际保存对话框确认：未验证。未自动打开GUI或保存框。|

桌面业务页面仍完整复用原入口；不把上述定向样本说成所有地图功能均验收。电脑存档独立于手机/9174网页，可使用原导入备份迁移；本轮未清任何真实数据。地质云Token在本机不存在，该API仍按原行为提示未授权，并非新增支持。pywebview已显式开启下载并使用EdgeChromium；iframe的allow权限声明不等于系统授权。原生权限边界依据[pywebview API](https://pywebview.flowrl.com/api/)与[WebView2权限类型](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/winrt/microsoft_web_webview2_core/corewebview2permissionkind)，同时只读核对已安装后端源码。

本轮没有删除业务模块；新增桌面壳/打包/网关，原行业管线只调整资源和可写数据目录。手机中心点与APK独立记录见[本轮手机交付](pc-exe-and-center-dot-20261008.md)。

## 最终本地产物

- 启动文件：`EXE/山兔桌面/山兔桌面.exe`，6,446,100字节，SHA256 `4ef52e424f8382f98d6809ba659a5a28cdc2012a55dc29355cd78a8bc7967a03`。
- 完整目录2,092文件、201,288,779字节（约192MiB）；必须保留 `_internal` 与 `resources`。地图与Python/Node运行资源均随目录交付，PNG管线另需系统Edge/Chrome，窗口需WebView2。
- 最后一次源码/资源更新后重新构建；主代理最终EXE隐藏自检exit0，报告 `.openai/build/desktop-app/root-final-selftest/self-test-report.json`。三个shell文件与最终源码逐字节一致，39图源源/产物哈希一致，Key存在/已注入仅布尔核验。汇总 `.openai/desktop-delivery-manifest.json`，构建日志 `.openai/desktop-final-build.log`。
- 最终类型检查与diff whitespace检查通过；没有跑无关全套测试。仅本机私有产物，没有公开Release/下载链接；源码单独同步当前功能分支，未合main。
- 本轮桌面QA服务和窗口已关闭，用户9174手机预览与3108 API保留。下一步由用户双击启动，在真实WebView窗口验证全屏、存档重开与主动保存；未测试项继续保持未验证，不能把浏览器PASS扩大到原生平台。
