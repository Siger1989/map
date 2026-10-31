# 152候选与可交互原生预览（2026-10-31）

本轮正在视觉复验，未宣称最终交付或手机验收。旧151及固定APK保留；模拟器专用MuMu3已覆盖安装152候选，用户数据保留，Unreal未操作。

## 已确认原因和修改

- 黄线过密：`NativeCartographyLayers`把道路直接交给SDK默认样式，没有网页原有颜色、UI缩放门槛及动态线宽。新`NativeRoadStyle`恢复主路/小路/铁路与河流规则；一个MVT源和原resident tile上限，后台分组一次，实际帧按UI zoom/CSS scale更新，不按source z判断UI门槛，不拆成五份缓存。
- 区域过实：原生把完整颜色同时用于填充和描边。`NativeAreaStyle`仅把填充alpha乘0.22，与网页相同，描边和存档保持。
- 等高线错位/缺失：SDK瓦片row南起，DEM XYZ Y北起；原适配直接混用。改从实际sector中心纬度求XYZ行号，采样和几何共用。新增实际SDK四象限适配回归。
- 等高线152实际画面已出现，但标注偏密、整体视觉仍待继续调整；不能仅以0.45/1.05参数一致就报告视觉通过。

## 已验证与未验证

- 原生定向19项通过：区域2、道路4、地形叠加13；Kotlin编译、fresh私人React、optimized候选构建通过。
- 候选152/code159，原包名`com.guanyun.weather.shantu.preview`，165150284字节，SHA256 `3b61bf1e57a8fa32dabcf336cd1742142b4e087cd266559b1f399fc6e9d9fe5c`。构建路径仍在本机stage，尚未替换固定交付入口或公开发布。
- 真实151两轮17个姿态采样：zoom6/8轻倾斜及zoom6/10的35/55/75度姿态；各转回原角度阶段无新增HTTP/磁盘命中/解码，驻留最大约179.4MiB、容量192MiB。此处未复现用户手机持续闪烁，不证明手机没有问题，不据此盲目扩大缓存或固定LOD。
- SDK SSE层级比较无迟滞，但仅是候选原因；旋转不在瓦片缓存身份里，不直接清图源层。尚未采集逐帧z/x/y/SSE证据，不称层级抖动已定位或已修复。
- 151用户标记采样前后1→1。首轮helper遗漏maps计数的记录保留为不完整证据，随后修正白名单重测。
- Find X8、完整主双图/多尺寸/长时间内存均未验证。152完整包审计、正式交付、提交推送待本轮视觉问题闭环。

## 右侧真实APK交互预览

`http://127.0.0.1:9174/native-app-preview.html` 是MuMu实际APK视频和真实MotionEvent触控，不是网页地图替代。支持点击、连续单指拖动、滚轮/按钮缩放、返回；浏览器双指在松开时转换为一次双指缩放。视频有传输延迟，不能用于手机本机FPS结论。

Helper使用`interactive-preview`模式，Android只绑定`127.0.0.1:23458`，通过定向ADB forward接入；本机HTTP只绑定loopback，输入要求运行时随机token。支持有限坐标和动作，不支持任意命令。页面断线不finish；root需更换APK时先发stop，再安装并重启interactive模式。

可复现入口：`scripts/android/native-marker-regression/preview-server.py`（Python和imageio-ffmpeg）。当前视频尺寸628×1380、触控屏幕1256×2760，适配其它模拟器前需同步尺寸。运行时日志、截图、本机缓存和私有配置不上传。

当前本机证据：`.openai/raster152-diagnostics/`、`.openai/native-road-contour-style-directed-20261031.log`、`.openai/private152-optimized-build-20261031.log`；预览连接截图`artifacts/screenshots/native152-interactive-preview.jpg`。截图含当前地图与存档，只留本机。

下一步：先压缩等高线标注并核对几何平滑/线宽的实际画面；继续复现手机远景倾斜闪烁，必要时采集SSE/瓦片层级，完成实际主双图及候选完整性审计再更新固定APK和同步交接。

## 后续实际FAIL（优先于上述构建通过）

152在等高线打开时两次Java512MiB heap OOM退出，第一次main Path.makeDrawable → NativeContourLayer.renderTileContent，第二次GLThread。右侧交互曾连接并实际点击/缩放，但随后退出，不能称持续稳定。当前状态FAIL，禁止正式交付152或替换固定151。正在转有字节上限的batch几何及标签屏幕碰撞，尚未完成。真实日志只在本机`.openai/native152-oom-logcat-20261031.log`。

## 153候选FAIL与154源码阶段

153/code160候选构建、签名/CRC/1925fresh资源/39源及私人Key一致性/64位16KiB通过，但等高线无显示，实际低heap不构成稳定证据。新TiledVectorLayer工厂遗漏plain Sector转换，且墨卡托南边界浮点反算导致generic根组装row=-1。已补原SDK安全转换和普通Sector网格原点，实际子瓦片仍用Mercator；24项定向检查（区域2/道路4/地形18）通过，新增真实layer.render→SSE→request以及全球唯一覆盖/z13缓存复用门禁。154/code161私人候选构建中，尚未实际验收。152/153均不合格，不替换固定151。

用户已明确确认9176原WebView的等高线表现为目标；原生手机继续球形地图、按该视觉还原。参考页与原生APK证据严格区分。原始153截图`artifacts/screenshots/native153-original.png`1256×2760 lossless PNG，不用低码率视频帧冒充画质证据。
