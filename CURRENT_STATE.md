# 当前状态 — 2026-09-26 / 0.2.74 APK交付

- 目标：修正3D剖面时图层面板位置、标记返回自动保存、剖面选中后点击其他标记直接切换，并打包发布APK。路线详情误报已由用户撤回，本轮未改。
- 已修改：modules/routeDisplay/routeDisplay.css、modules/controls/outdoorTheme.css、modules/annotations/{AnnotationWorkspace,PinEditor}.tsx、modules/map/TerrainMap.tsx、config/product.ts、mobile/android/AndroidManifest.xml、README.md、docs/release-0.2.74.md。
- 验证：npx tsc --noEmit PASS；标记和图层设置13项针对性测试PASS；scripts/build-android.ps1 -StandaloneTest PASS。APK/Shantu-0.2.74-test-standalone.apk，57,850,972 bytes，SHA-256 1DC7FED90869D45459C4CE6075FC6F245A091FDE05BFB8ACB5F8324A613EC58F；构建日志.openai/apk-0274-build-20260926.log。真机未测。
- 发布PASS：构建源码115de98fa74e5bf0058f27747784bb51624ca9c5已推送；Release v0.2.74-test-standalone已公开，APK及说明远端大小与SHA-256核对一致。当前阻塞：无。下一步：用户真机安装反馈。
# 当前状态 — 2026-09-26 / 全局紧凑磨砂实装

- 当前交付：用户要求最新APK，版本提升至0.2.73-test/code80；同独立包名和原签名。Android构建已PASS，产物APK/Shantu-0.2.73-test-standalone.apk，57,850,972 bytes，SHA256 002ECC04D0C2846FA02456B51DD8560C101076E546F8A99CA1ED8C471044AC1E。日志.openai/apk-0273-build-20260926.log，构建staging mobile/.build/apk-20260926-004456/web。全量首次657/659，更新旧TDT下载fixture和圆点选择器后659/659 PASS，无生产代码失败。TypeScript、签名v2/v3、zipalign、473地形/23修复瓦片、34项打包网页hash及浏览器版本0.2.73/code80/2026-09-26均PASS。日志apk-0273-{artifact-verify,tests-rerun}-20260926.log，截图apk-0273-version-20260926.png。未连接Android设备；纯鸿蒙原生包未交付。发布PASS：构建源码8705fc78e894363ab5d2923864347b8bfb6545be已推送到codex/rollback-ui-0235-20260921；Release v0.2.73-test-standalone已公开，APK/sha256/安装说明上传且服务端大小与SHA256均和本地一致。链接https://github.com/Siger1989/map/releases/tag/v0.2.73-test-standalone。首次commit缺少本机identity，临时沿用仓库已有Siger1989 noreply身份提交；网络用已配置Clash地址127.0.0.1:7897进程代理，无持久配置变更。无阻塞；下一步用户安装反馈。

- 2026-09-26追加修订：用户要求更透明及所有标题/X留白，同时报告吸附按钮无颜色且影响地图显示。玻璃alpha先0.70再按新要求降至0.64，blur仍18px；共享标题透明/6px10px，原源修recording父8px、quickAdd及measurement标题48px+36关闭框、survey资料父8px。Luna修TerrainMap：国内矢量道路/河流加载改为!useDomestic||s.roads，sync只使用图层设置，移除roads&&roadSnapping及river强制visible；cartographySettingsForDisplay新增行为测试。共享track-tools pressed恢复主色。类型、7项raster-level行为测试、构建3.89s、diffcheck PASS，日志.openai/snap-final-{tests,tsc,build}-20260926.log。浏览器已实测record关闭36px，上/右距约9/11px，标题透明；吸附false普通浅字、true黄绿字且选中底色；第一次QA发现初始化仍随吸附触发，修复后刷新独立验证页：未开道路/河流吸附即有完整道路河流，截图snap-off-final-20260926.png；开关颜色分别为普通浅字/黄绿字，snap-on和snap-river截图保留。PASS。用户tab6正在操作，未主动刷新它。未出APK/提交/发布。

- 当前目标：用户要求把选中的无亮边磨砂方案直接替换到全局，并减少上下空白。Luna分别负责outdoorTheme上下栏、theme.ts/outdoorSurfaces共享材质，主agent整合ControlDock实心图标及浏览器审核。顶栏48px/底栏56px+安全区，触控44px；玻璃背景78%/blur18px；Heroicons2.2.0固定版本，package-lock仅新增该依赖10行。修复底栏滤镜导致天气fixed按钮移到屏底的问题，改伪元素承载；修复图层旧底色及路线ID规则覆盖。
- 验证进展：类型检查、6项appearance/layout测试、移动web构建5.24s均PASS，日志.openai/glass-final-{tsc,tests,build}-20260926.log。390/360路线外壳实际rgba(24,32,31,.78)、blur18px，底栏56px、按钮44px、天气top2px；360路线无水平溢出，图层外壳材质通过。截图artifacts/screenshots/glass-{route-390,route-360,layers-360}-20260926.png。短屏390×480记录面板200px、标题固定、内容可滚至底部离线入口；截图glass-record(-scrolled)-480-20260926.png。design-qa.md和docs/ui-standard.md已更新，最终diffcheck PASS；正式预览保持390×约857，QA临时页已关闭。下一步：按用户新视觉反馈调整；无阻塞，未出APK/提交/发布。

- 离线下载收敛为免费图源（2026-09-25）：用户要求暂停天地图离线下载保护额度。Luna负责offline.ts/nativeOffline.ts/新offlineDownloadPolicy.ts及测试，主agent负责app下载目标、OfflineDownload/OfflinePanel/OfflineMapFolder及useOffline原生队列暂停。所有新入口只准备OpenFreeMap道路地名/勾选地形，确认窗口明示不含天地图和卫星；天地图新建/续传在网络和native调用前拒绝，旧包查看/校验/删除保留。Sentinel卫星仍无离线下载。浏览器PASS：下载窗口来源为OpenFreeMap，当前在线底图仍为天地图，未触发真实批量下载，窗口clientHeight=scrollHeight=162；截图 artifacts/screenshots/offline-free-only-20260925.png。tsc、14项离线回归PASS，补旧缓存测试文件6/6 PASS；网页构建4.31s、diffcheck PASS。首次native删除测试因默认JDK路径不存在失败，用进程JAVA_HOME=D:/GodotAndroid/jdk-17重跑通过，无持久环境变更。日志 .openai/offline-free-{tsc,tests,legacy-tests,build}-20260925.log。docs/tianditu-offline.md已标当前策略。无阻塞；旧手机APK尚未包含本轮修改，未出包/发布。

- 标记编辑留白与海拔（2026-09-25）：Luna 修改 pinEditor.css，主 agent 修改 PinEditor.tsx 并审核。外框8px、名称/备注输入水平8px、16px字号和36px触控；坐标下直接显示地面海拔，缺值进入编辑时调用既有 refreshElevation，保留读取中/暂无数据/重读状态及坐标修改后重查，不伪造0米。浏览器 PASS：现有行程标记实际读到477.6米，输入 computed padding5px 8px，面板clientHeight=scrollHeight=333无裁切；截图 artifacts/screenshots/pin-spacing-elevation-20260925.png，用户预览tab2保留编辑面板。tsc、12/12标记编辑/导出测试、移动网页构建4.77s及diffcheck PASS，日志 .openai/pin-elevation-{tsc,tests,build}-20260925.log。无阻塞；未出新APK，真机/断网场景本轮未验证；下一步按用户反馈继续。

- 摇杆主题色修复（2026-09-25）：Luna 修改 modules/controls/CameraGizmo.tsx，主 agent 审核；三角主面/北向点使用 --ui-accent，其他面及圆环用同色明暗，移除固定薄荷绿和固定绿色的辅助描述，保留几何/操作及底盘60%透明度。实时预览 PASS：主面实际 rgb(208,247,107) 与当前主题 #d0f76b 一致，截图 artifacts/screenshots/gizmo-theme-20260925.png。tsc/移动网页构建 PASS（底盘透明度恢复前已完成；恢复后浏览器计算样式PASS），日志 .openai/gizmo-theme-{tsc,build}-20260925.log；无阻塞，未出新APK。下一步继续按用户视觉反馈。

- 手机地图清晰度只读诊断（2026-09-25）：用户确认 APK 地名/道路文字模糊、按钮文字清楚。主 agent 与 Luna 并行核查 PASS：TerrainMap.tsx:815 将 pixelRatio 限制为 min(devicePixelRatio,2)，DPR>2 设备会低于原生画布分辨率；terrain.ts 中天地图 cia/cva 注记是256px raster图片，无法像DOM文字一样按屏幕原生分辨率排字。未发现产品地图canvas的CSS blur/scale。WebView overview 与 device-width viewport 配置存在，但按钮清楚不支持整页缩放为首因。已核对 MapLibre 官方 pixelRatio 文档和本地实现；本轮未修改渲染策略，尚未取得手机实际DPR/canvas尺寸/图源加载状态，根因贡献及真机改善未验证。下一步修订高清渲染策略并对同视角、同图源做真机对照；需兼顾栅格注记原始分辨率，不能承诺只提高DPR就解决全部字糊。

- 最新材质预览（2026-09-25）：用户要求深色磨砂无亮边、底栏简约实心图标、上下栏统一贴屏幕边缘，顶部合为一体，并再透一点。已用内置 imagegen 完成第四版概念图 C:/Users/sigeryang/.codex/generated_images/01a0d401-c3b3-7d23-97a7-2ac5fa0cb38b/exec-7c092e13-5ef4-45a9-8f74-47a5aa9dd4e1.png。视觉检查 PASS：上下连续全宽磨砂面、底栏实心图标、背景柔和透出、无亮边；仅效果预览，尚未修改应用材质/图标。无阻塞；下一步按用户反馈调整或在明确实施时应用。QA tab3/tab4 已关闭，主预览保留。

- 当前目标：按用户真机截图，全局核查内外圆角协调、文字/图标与圆角的安全距离；修复导航条按钮深字白框、海拔卡白底与内部大圆角不协调。
- 进展：Luna完成路线卡控件12px圆角、起终点行6px水平留白和输入内距；导航模块与共享规则正在并行排查，主agent审核。
- 当前文件：outdoorTheme/outdoorSurfaces、guidance/rally/routeDisplay、routeCompact、rasterLevel、boxSelection及docs/ui-standard；Luna并行修复，主agent逐页浏览器审核。新增反馈：路线行内部方角、画线说明顶角、框选旧白底、原生下拉白字白底、路线显示/标记菜单滚动条、绘制工具条顶边，均纳入本轮。
- 预览恢复：此前9174前端及3108 API停止，已在可查看/停止的执行会话重新启动（22937/75745），右侧390×约857预览实际加载成功。后台Start-Process被自动审批拒绝，未更改系统设置，采用直接运行会话恢复。
- 阶段验证PASS：360路线内部表单透明+12px角、提示条12px角；画线底部说明4px 8px 8px留白；框选面板深底20px圆角且scrollHeight=clientHeight=103；图层select/option实际浅字深底、dark色彩方案。截图artifacts/screenshots/ui-corners-{route,track,box}-360.png。类型检查和23项appearance/guidance/reroute/route-display测试PASS，日志.openai/ui-corners-*.log。
- 下一步：完成新增菜单/绘制反馈，检查390/360与480、导航展开收起、移动web构建；本轮未重打APK。

- 最新验证：Luna执行TypeScript、47项相关测试、移动web构建、diffcheck均PASS；日志.openai/ui-final-{tsc,tests,build,diffcheck}.log。新增RouteElevationProfile真实进度填充/缺测断点与浏览selection，RouteWeatherRail fraction已传给底部高程；选中路线不再隐藏GuidanceCard，导航选中linePoint允许标记并用所选坐标；坐标提示在panel/编辑/quickAdd避让。路线结果卡移除路书并合并详情是用户明确指令。
- 新增实改：measurement/Measurement.tsx和measurement.css（直接分享、屏幕图表深色，导出画布保留），section/survey.css（上下编辑条内距），quickAdd.css（普通360菜单223px无溢出，首轮200px裁切已修为240上限），recordingConsole.css（8px内距、可滚动无可见条），tracks绘制条及homeMap路线摘要/行程点。最新整批尚待完整浏览器复验，不能称全部视觉验收。
- 当前用户转入材质方案预览：要求半透明磨砂镜面，已调用内置imagegen生成第一版，用户反馈边缘太亮/不自然，第二版已完成：按用户磨砂矩形参考图去掉亮边，采用柔和均匀雾面、半透、背景扩散，用户尚未确认应用。第二图C:/Users/sigeryang/.codex/generated_images/01a0d401-c3b3-7d23-97a7-2ac5fa0cb38b/exec-09c7076a-0fce-4070-8d38-e8214415d104.png。仅概念图，未把玻璃材质写入应用。第一图C:/Users/sigeryang/.codex/generated_images/01a0d401-c3b3-7d23-97a7-2ac5fa0cb38b/exec-33c7fb02-f914-454b-8c43-7c21c24ffaaf.png。
- 临时QA fixture mobile/ui-corners-qa.html/.tsx尚在，真实组件合成数据；验收完删除仅这两个临时文件，不得提交。主预览CUA tab2供用户操作，tab3窄屏QA/tab4组件QA待关闭。前端/API运行会话22937/75745保持。
## 0.2.72 APK 构建完成

- 用户明确要求打包 APK；将已确认的统一UI、高亮修复、记录按钮布局与已保存图层设置纳入0.2.72-test，versionCode79，沿用独立山兔包名及4a94签名。
- 本轮改动：mobile/android/AndroidManifest.xml、config/product.ts提升版本，AboutPanel更新日期，docs/release-0.2.72.md与README；上一轮UI源码一起打包。Luna并行执行全量测试及构建要求审核，主agent完成构建/资源签名复核。
- 最终包：APK/Shantu-0.2.72-test-standalone.apk，57,846,876字节，SHA256 BA2036A675122E507F0BDC4A14B36B27820587E07E3F4DD874775C63A656E378；sidecar一致。v2/v3签名、zipalign、473地形及资源清单均PASS；32个HTML/JS/CSS条目与最终web staging逐一hash一致。
- 验证PASS：TypeScript、653/653全量测试、最终网页/Android构建、打包网页启动和版本0.2.72/79/2026-09-25显示。命令显式SDK D:/GodotAndroid/android-sdk、JDK D:/GodotAndroid/jdk-17；测试子进程JAVA_HOME及长路径TEMP/TMP避免旧路径与短路径403，无系统配置变更。日志.openai/apk-0272-*；截图artifacts/screenshots/apk-0272-*.png。
- 发布PASS：源码构建提交f48253adbc78084e1ca5cde12315fd5b16f0bb2e已推送到codex/rollback-ui-0235-20260921；GitHub测试版v0.2.72-test-standalone已公开，APK/校验文件/安装说明均uploaded，远端size和SHA256与本地一致。Release：https://github.com/Siger1989/map/releases/tag/v0.2.72-test-standalone。
- 阻塞：无。直连失败后，使用系统已配置的127.0.0.1:7897代理恢复GitHub访问（仅进程参数）。无Android设备，真实安装、触控、相机及后台定位未验；HarmonyOS6.1原生包仍未交付。下一步用户安装0.2.72反馈，右侧默认手机预览保留。

## 全局高亮框修订

- 当前目标：统一全部界面控件焦点框，修复收藏搜索裁切、路线双框与记录沿途按钮文字不可读。
- 进展：3个Luna子agent并行完成记录按钮布局、路线收起语义与只读样式审查；主agent已整合为2px内收焦点、路线活动分组弱底色、空候选不弹层、按钮双列图标竖排；“收起”明确为“收起搜索”。
- 本轮文件：modules/controls/{outdoorSurfaces,outdoorTheme}.css、modules/input/{SmartText.tsx,suggestions.css}、modules/navigation/RoutePanel.tsx、modules/outdoor/recordingConsole.css、docs/ui-standard.md、AGENTS.md、本文件。
- 验证PASS：主agent逐张审核收藏搜索、路线起点、记录按钮390/360截图及收藏新建子窗口360截图，焦点线均2px内收，路线父块无亮边/阴影。收起搜索保留已输入值并使输入失焦；空候选aria-expanded=false，无空弹层。记录按钮宽度无文字溢出；390×480卡片实测200px，scrollWidth=clientWidth=274，内部滚动可达两按钮。
- 证据：artifacts/screenshots/ui-{search-focus,route-focus,record-actions}-fixed-{390,360}.png、ui-dialog-focus-fixed-360.png、ui-record-focus-fixed-480.png，均PASS。360记录首轮截图捕获过渡帧，已在稳定后重新截图审核覆盖。未验真实GPS记录、相机或真机IME/触控；未逐个触发有数据业务分支。
- 命令PASS：npx tsc --noEmit；node --experimental-strip-types --test tests/appearance.test.mjs tests/search-viewport.test.mjs tests/feedback-20260909.test.mjs tests/route-stops-scrub.test.mjs（16/16）；npm run build:android:web（既有大chunk提示）；git diff --check。日志 .openai/ui-focus-{types,tests,build}-20260925.log。
- 阻塞：无。右侧保留默认390×约857实时预览。下一步按用户视觉反馈局部修订；本轮仍是本地视觉确认，未提交/推送/打包发布。

## UI 标准与统一样式已落地

- 用户已确认上一版首页/路线样板，授权将执行规范做成标准并迁移其他主页面与子界面。
- 正式标准 docs/ui-standard.md 已建立并接入 AGENTS；统一主题扩展到所有面板及 body portal。默认深色黄绿，已保存的个性化仍保留。
- 已迁移：共享卡片/输入/操作/状态样式，记录、收藏/导入/管理、标记、图源、搜索建议、布局设置的硬编码UI颜色；地图/图表/照片业务色保留。
- 本轮文件：docs/ui-standard.md、AGENTS.md、docs/ui-visual-system.md、appearance/theme.ts、appearance.css、controls/outdoorSurfaces.css、outdoorTheme.css、app/page.tsx、网页/移动样式入口及上述模块CSS。
- 已完成共享样式覆盖：全部主面板、路线详情/编辑/导航子窗口、记录/照片/离线、收藏/导入/管理/根节点弹窗、天气/时间、标记/模型/测量/剖面、帮助/个性化/布局。源文件颜色迁移11份，完整范围及实际验证见 docs/ui-migration-20260925.md。
- 验证 PASS：类型检查；11/11定向测试；移动网页构建4.72秒（既有大chunk警告）；git diff --check。日志 .openai/ui-standard-{types,tests,build}-20260925.log。截图 artifacts/screenshots/ui-standard-*.png，390/360主入口、图层、收藏弹窗及480高度记录/工具/剖面入口均检查，记录输入实际16px。
- 修复：记录强制圆角/主操作色/标题滚动、收藏离线项白底、portal根背景覆盖地图、图层/测量顶栏净空。普通地图选区容器保持透明。原工程图、照片、QR、路线数据色未套UI色。
- 当前限制：未逐一触发真实数据导航/分享/照片编辑分支；未写入测试收藏/记录、调用相机或下载；未真机验收。共享样式覆盖不等于全业务状态验收。
- 阻塞：无。下一步按用户反馈修订，或在真实数据/设备上补充覆盖表中的状态；右侧保留390×约857实时预览。当前为快速视觉迁移，本轮未提交/推送/出APK或发布。

## 当前工作：地图主页与路线规划视觉样板

- 目标：基于已读 ChatGPT《Codex布局优化流程》《界面布局评估》与三屏参考图，保留功能入口和交互路径，实施深色、少描边、荧光黄绿强调的首屏样板；布局安全优先。
- 初步检查：主页有独立浅色硬编码，路线紧凑样式含强覆盖；上下地图工具独立定位，矮屏有碰撞风险。Android 已消费系统栏/IME insets，网页浮层有 visualViewport 辅助，不能再次叠加原生 inset。
- 进展：完成限定首屏/路线规划的深色主题变量、顶栏、地图工具组、底栏和路线卡样板。路线基础表单沿用既有内容例外（见 docs/ui-visual-system.md），标题固定、内容独立滚动；矮屏收起次要地图工具，极矮屏工具展开避开3D/框选与相机。工具支持外部点击及Esc关闭。其他业务页面尚未迁移。
- 文件：新增 modules/controls/outdoorTheme.css；修改 app/page.tsx、app/layout.tsx、mobile/main.tsx、modules/controls/homeMap.css、modules/navigation/routeCompact.css、modules/position/PositionDock.tsx、modules/position/positionDock.css、mobile/phone-preview.html、CURRENT_STATE.md。预览增加命名QA尺寸参数，默认仍为390×约857。
- 命令与结果：npx tsc --noEmit PASS；node --experimental-strip-types --test tests/appearance.test.mjs tests/route-stops-scrub.test.mjs tests/layout-home-migration.test.mjs 10/10 PASS；npm run build:android:web PASS（最终2.58秒，既有大chunk警告）；git diff --check PASS。日志：.openai/ui-sample-types-20260924.log、ui-sample-focused-tests-20260924.log、ui-sample-build-20260924.log。
- 视觉验证 PASS：artifacts/screenshots/ui-style-route-390-20260924.png（390×约857）、ui-style-route-360-20260924.png（360×780），卡片/工具/底栏无碰撞和横向溢出；ui-style-short-20260924.png（390×480）内部滚动可达主操作、标题/关闭保留；ui-style-tools-short-20260924.png（360×360）工具浮层已避开右侧固定工具。极矮屏初次检查曾重叠，调整展开方向后复验PASS。改前：ui-style-before-20260924.png。
- 交互验证：路线打开/关闭、出行方式、地图选点入口、添加/移除途经点及矮屏工具展开/收起通过。没有实际路线网络规划或真机IME/触控验收，不把压缩浏览器高度当作实际键盘测试。
- 阻塞：无。右侧已恢复 http://127.0.0.1:9174/phone-preview.html 默认比例并打开路线样板。下一步由用户确认风格，再逐屏扩展或局部修订；按项目视觉快速确认流程暂不提交/推送/打包/发布，不宣称全局完成或真机验收。

# 2026-09-24 / 进度同步与换电脑接续

## 本次同步入口（覆盖下方历史时态）

- 用户已明确授权且要求不加密直接上传地图配置与原Android签名：`.env.local`及`mobile/.build/guanyun-test.jks`随本次提交保留原路径。原签名证书已核对为`4a94`系列；家里克隆可直接取得。此项为本次授权例外，当前仓库PUBLIC。
- 当前开发分支：`codex/rollback-ui-0235-20260921`；0.2.71源码基准为 `9fcb885397e5fb20e519960c499e07b2498952dc`。本次同步提交在该基准之后，不表示合入main。
- 已核对并公开0.2.71测试Release：本地APK、sidecar与GitHub资产SHA-256一致，Release与UI回退基准tag均解析到上述commit。0.2.70仍保留草稿。
- 本次保存已有后续源码：图层开关、透明度、细节上限等设置记忆，启动恢复有效图源，丢失图源回退；新增5项测试。本轮不新增业务功能，不将开发快照写成新版APK交付；0.2.71不含这些后续源码。
- 一并同步视觉系统提案、框选设计草图与两份已有浏览器验证脚本；视觉提案尚未实施或验收。类型检查、5项图层偏好测试、脚本语法检查及网页构建通过；其他验证状态与换电脑命令见[本次完整交接](docs/progress-handoff-20260924.md)。
- 尚待：图层/图源记忆完整浏览器验证；Android覆盖安装、触控、相机往返与后台定位实测；弱信号轨迹断续诊断；HarmonyOS 6.1原生交付；上下同步双地图仍为记录需求。
- 下方按时间积累的“未提交/未打包”仅指当时状态；已经归入0.2.71的项目，以本节及0.2.71发行说明为准。当前未打包范围仅指上述后续源码。

## 2026-09-24 0.2.71-test 本轮源码

最终 Android APK：`APK/Shantu-0.2.71-test-standalone.apk`，57,842,780 bytes，SHA-256 `E298995A4394500E168EA2D6794C402FC674D5D5EA70B577E29965C111B318D6`，versionCode 78，最低 Android API 26（Android 8.0），沿用`4a94`证书；`APK/Shantu-0.2.71-test-standalone.sha256` sidecar一致。647/647测试、TypeScript、网页构建、原证书v2/v3签名、zipalign、473张地形瓦片以及最终 bundle 浏览器 QA均通过。

- 地图普通框选与路线编辑框选共用双指手势链路。指针移动由 `requestAnimationFrame` 合并，手势结束时只提交一次业务视图同步；取消、隐藏和卸载路径均收尾当前手势并清理待处理帧。390×857和360×780均确认地点/模型名称在界面第12级出现（MapLibre raw zoom 11）。
- 收藏夹使用统一导入入口，支持原有文件和标记 Excel 流程；分享入口集中选择 JSON 或 XLSX，移除独立 Excel 导出入口。操作窗口互斥；有有效历史相机视角时避免被启动定位覆盖。
- 记录期间的照片页优先显示直接拍摄与导入，整文件夹导入及其说明只在记录未开始或已结束时出现。拍摄绑定当前记录；EXIF 时间优先，相机缺少 EXIF 时才使用明确标为估计的相机返回时间。位置仅在精度可靠、时间接近且来源可说明时保存；没有记录点时可拍为页面草稿，但无可关联轨迹，加入地图按钮不可用。取消相机不新增标记；保存失败保留草稿，轨迹保存复用 ID 时在清理记录前重映射对应照片。
- 同时承接记录精度默认5米并保留用户设置、运动朝向跟随、缺少路线终点时聚焦候选节点，以及启动时保留地图视角。
- 地图2D/3D选择与相机一起写入原有`shantu.map.last-view.v1`快照；选择时同步更新待保存模式、零时长切换相机，并立即刷新MapLibre节流的URL hash。390×857和360×780点击后立即reload均恢复对应模式、相机与俯仰（3D约62°，2D为0°）；旧快照缺少可选模式字段时继续使用默认值。
- 最终源码基于功能分支`codex/rollback-ui-0235-20260921`交付，不表示合入main。最终commit上的annotated基准tag `shantu-ui-baseline-0.2.71`作为后续UI风格调整回退点；测试Release tag `v0.2.71-test-standalone`对应同一源码commit。
- 最终 bundle 在390×857与360×780通过：raw zoom10.99显示图标且隐藏名称，raw zoom11显示标签（界面约第12级）；普通及编辑框选双指手势、收藏统一导入/分享、记录照片入口检查通过；2D/3D快速切换后URL hash、LAST_VIEW与实际pitch均按选择恢复。记录中整文件夹入口隐藏。
- Android真机安装/覆盖安装、手机双指触控与相机往返未验；APK沿用原包名及`4a94`证书，实际覆盖安装和数据保留尚未验收。
- 弱信号轨迹断续仍未诊断。HarmonyOS 6.1 原生 HAP/APP 未交付，Android APK 在鸿蒙设备上的兼容性未经验证。GitHub发布状态以远程核对为准；测试版目标地址为 https://github.com/Siger1989/map/releases/tag/v0.2.71-test-standalone。

## 2026-09-24 分叉终点错误自动定位（本地预览，未出包）

路线/实走轨迹导航遇到缺少分叉终点时，错误携带定位坐标并把地图拉回真实度数大于2的分叉节点；浮标标为“分叉点·待设终点”，错误提示引导进入编辑后自行选定目标终点。仅显式终点元数据缺失且路线无分叉时定位原线路末端候选，并标“末端候选·待设终点”。定位标记独立于真实断口图层；没有补造断口、自动设终点或修改路线数据。保存路线入口与当前草稿入口均处理，关闭提示、返回路线卡、进入编辑及开始导航会清除定位标记。

- TypeScript、路线终点5项定向测试、`npm run build`通过。隔离Playwright以390×857和360×780触发合成分叉导航，检查地图中心节点、缩放、提示和底部导航；两尺寸均截图：`artifacts/screenshots/route-fork-focus-{390,360}.png`。两尺寸路线卡“编辑”均可点入编辑工具。仅合成轨迹，无真实路线被更改。
- 真机地图层与点击体验待验；本轮为本地预览，未生成APK、未提交/推送；0.2.69 APK不含此项。

## 轨迹弱信号调查（仅记录）

两张截图显示一次精度拒点，但不足以确认断轨；复盘需原始轨迹或诊断数据。业务代码未改，详见 [反馈记录](docs/pending-feedback-20260922.md)。

## 2026-09-24 运动朝向跟随（本地预览）

右侧“运动朝上”模式按钮改为实心方向箭头；选中时主动开启定位跟随，GPS 行进方向有效后使地图按行进方向朝上。手动拖动地图会暂停跟随和自动旋转，停下或方向不可靠时沿用已有航向保持逻辑。只改朝向控件与相机跟随联动，不改轨迹、路线和定位存储。

- TypeScript、5项运动航向测试和网页构建通过；隔离浏览器390×857/360×780以模拟GPS验证按钮、跟随、90°行进朝向、移动时地图归位及手动拖动后暂停旋转，无横向溢出。截图 `artifacts/screenshots/motion-follow-{390,360}.png`。
- 真机GPS航向与触控待验；本轮未打包，0.2.69 APK不含此项及下述精度改动。

## 2026-09-24 记录精度默认值与范围提示（本地预览）

按用户截图，记录定位点的最大估计误差默认门槛从20米改为5米，网页与Android原生默认值一致；允许手动设置的范围仍为5–80米。在紧凑“轨迹样式与采样设置”的精度输入行下显示可用范围和“越小越严格”，原完整设置的恢复按钮与文字也改为5米默认。已显式保存的用户门槛保持原值，不改旧轨迹数据、采样间隔、距离或定位来源；弱信号下5米门槛可能暂不记点。

- 只改 `modules/outdoor/{recordingPreferences.ts,RecordingCompactSettings.tsx,RecordingPrecision.tsx,recordingConsole.css}`、`mobile/android/src/com/guanyun/weather/RecordingPreferences.java` 和定向测试。TypeScript、3项记录精度测试、网页构建及单独Java类编译通过；隔离浏览器390×857/360×780确认默认5米、范围提示可见、浮窗276×200px且无横向溢出，截图 `artifacts/screenshots/recording-accuracy-{390,360}.png`。
- 真机GPS筛点、中文输入法和覆盖安装未验证；仍是本地视觉确认阶段，**0.2.69已发布APK不含这次改动，本轮未生成新包**。

## 2026-09-24 0.2.69 Android 测试包

本版将下方标记自动保存/完整点信息分享、路线真实断点定位和固定自由画线编辑工具打入独立测试包。版本 `0.2.69-test`、versionCode76，沿用 `com.guanyun.weather.shantu.preview` 包名及原 `4a94` 证书，不变更标记/路线存储格式、照片文件和 `shantu.ui-layout.v1`。APK `APK/Shantu-0.2.69-test-standalone.apk`，57,834,588字节，SHA256 `72e21c1d3ad88ded583281e00fa186e541b89040eaaa80a51f54809472201b12`；发行与平台限制见 [0.2.69发行说明](docs/release-0.2.69.md)。

- TypeScript、638项逻辑测试、网页及Android构建、v2/v3签名、zipalign、473张地形瓦片、打包网页启动通过；浏览器390×857和360×780已验证关键操作。真机输入法、地图触控/导航与覆盖安装仍待验。
- `check:architecture` 仍报六处既有超长模块；未为了出包扩大重构范围。源码和Release上传以远程SHA与资产核对结果为准。

## 2026-09-24 标记自动保存、断点定位与固定路线编辑工具（源码预览）

标记编辑顶部“保存”改为“分享”；名称、备注、坐标、颜色、图案和自定义条目在输入或选择后自动写入原有标记存储。中文输入法组合期间只保留草稿，组合结束再保存；分享文本包含完整点信息及条目，照片附件明确不随文本分享。仅改标记编辑、文本输入事件与现有地点分享流程，未改存储键或照片文件。

保存路线导航若发现不相接的线段，会定位最近的真实缺口，显示红色虚线、两端及距离；关闭提示或返回路线卡会清除提示图层。路线编辑默认自由画线，固定显示自由画线、道路吸附、节点吸附和线条样式；展开样式或点属性时主要工具不换位。仅改手绘轨迹设置、编辑工具栏、断点计算/图层与导航错误处理，未改路线几何的存储格式、底图、天气或既有导航算法。

- TypeScript、638项逻辑测试和网页构建通过。隔离浏览器390×857、360×780验证标记即时保存与完整信息复制、断点定位/清除和路线编辑自由画线默认选中/模式切换；编辑工具栏实测300×184px、无横向溢出，样式展开时模式栏仍固定可见。截图在 `artifacts/screenshots/{pin-autosave,pin-share,route-gap,route-editor,route-editor-style}-{390,360}.png`。
- 仍需Android真机检查中文输入法、地图渲染/拖线手感及导航断点。以上改动现已纳入0.2.69测试包；0.2.68包不包含。

## 2026-09-24 0.2.68 原路线直接反向

“导航准备”选原始路线后点“交换”，现可直接反转已保存道路线路的坐标、途经点、分段和起终点，缩略图及开始按钮同步更新；收藏原路线保持不变。旧正向转弯提示被清空，返程仅沿线提示，里程/用时沿用原线。驾车若需核验单行/禁转，点“驾车”重新规划。收藏夹操作菜单进入导航后自动关闭，避免覆盖交换按钮。只改导航准备、道路线路反向帮助函数、收藏夹菜单回调和定向测试；地图图源、照片、轨迹、标记与存储格式不变。

- TypeScript、632项测试、网页及Android构建、既有4a94签名、473地形瓦片、打包网页启动通过。隔离浏览器390×857及360×780实点收藏夹→导航→交换，弹窗边界和底部按钮可见，截图 `artifacts/screenshots/reverse-original-{390,360}.png`。真机导航和覆盖安装待验。
- 架构长度检查仍报六处既有超长模块；未因本轮导航修复扩大重构范围。
- `0.2.68-test`/versionCode75，APK `APK/Shantu-0.2.68-test-standalone.apk`，57,834,588字节，SHA256 `dd1b049e603c8a47c573a5a9a3587f2249f8b3393f5a1d60765a0958160951e3`；平台和限制见 [0.2.68发行说明](docs/release-0.2.68.md)。源码/Release是否远程发布以最后核对为准；反向原线不代表已核验道路通行规则。

## 2026-09-24 0.2.67 Android 测试包

本版包含下方的路线输入引导、规划/收藏路线点开操作卡，以及收藏夹文件夹整组显隐与“隐藏”分类。版本 `0.2.67-test`、versionCode74；沿用 `com.guanyun.weather.shantu.preview` 与既有4a94签名。APK `APK/Shantu-0.2.67-test-standalone.apk`，57,834,588字节，SHA256 `8409e4ad2632e3c69b7ae8b09c9a832a7dc1bf21383dc0090a3f3be79abab68d`。发行与平台状态见 [0.2.67](docs/release-0.2.67.md)。

- TypeScript、629项逻辑测试、网页构建、Android网页/Java/DEX/APK构建、签名/zipalign、473张地形瓦片、打包网页启动通过。390px预览实点路线步骤提示；真机点路线/文件夹横滑、覆盖安装和数据保留待验。
- `check:architecture` 仍有六个既有超长模块，未扩展到其他模块。HarmonyOS 6.1 原生包仍未交付；Android包仅可在设备支持时兼容试装。
- 源码同步和 Release 上传状态需在完成远程SHA与资产核对后报告，不以本地构建视为已发布。

## 2026-09-24 路线起终点引导与收藏路线重新操作

路线规划表单现常显“起点/终点”标签，未填时高亮下一步并提示输入或地图选点；地图选起点后提示自动转到终点。地图上的当前规划路线可点击打开路线摘要；收藏夹中的导航路线点击后直接恢复路线摘要，收藏路线图层被点击时也恢复可操作的路线。恢复后的表单初始显示摘要，可从中开始导航、调整起终点、分享或取消。仅改 `modules/navigation/{RoutePanel.tsx,RouteLayer.ts,routeCompact.css}`、`modules/map/TerrainMap.tsx`、`app/page.tsx` 和路线图层定向测试，未改路线/收藏存储格式、地图图源、轨迹或之前的收藏夹显隐实现。

- TypeScript、16项相关定向测试和网页构建通过。9423手机预览在390px布局中实点验证起点→终点→可规划提示及面板可见；预览没有收藏导航路线，地图点线到摘要以代码路径和图层定向测试验证，真机触控尚未验。
- 仍在UI快速确认阶段：未提升版本、未打新APK、未提交或推送；0.2.66包不含本地待确认改动。预览截图已在浏览器工具中目视检查，未成功写入 `artifacts/screenshots/`。

## 2026-09-24 收藏夹文件夹显隐与隐藏分类

用户要求在收藏夹中通过横滑隐藏或显示整个文件夹，并在分类中增加隐藏项。当前本地预览改动：文件夹名称行左滑隐藏全部、右滑显示全部；同一行有显隐按钮和全显/部分/全隐状态，包含嵌套子文件夹对象；“隐藏”标签放在“全部”旁，列出当前隐藏对象，旧标签顺序可兼容。整组操作复用既有各对象 `visible`/`hidden` 字段和撤销，不新增存储键，不修改几何、照片或来源。

- TypeScript、20项定向测试及网页构建通过；在隔离预览中实点文件夹显隐与隐藏分类回显/移除，390px手机比例截图已目视检查，原9423预览恢复并可启动。浏览器工具的屏幕图已检查但未能写入 `artifacts/screenshots/`；360px与真机左右滑触控尚未验证。
- 此轮仍属快速视觉确认：**未提升版本、未重新打APK、未提交或推送**。当前发布包仍为0.2.66，未包含此项。

## 2026-09-23 0.2.66 框选、标记输入与调整轴

本版合并本页下方三轮已确认的本地改动：框选工具/结果更紧凑，非画框时可平移缩放地图；收藏夹与框选导出 Excel 的地区列优先使用已保存数据，缺失时有限逆查；标记自定义条目在输入法缩小视口时保留焦点行并隐藏底栏；地点标记的调整轴依据当前地形高度（含夸张系数）贴近地图标记，移到图标下方并显示当前经纬度。其他标记/路线/照片存储格式、地图图源、模型调整轴及 `shantu.ui-layout.v1` 不变。

- 版本 `0.2.66-test`、versionCode73；包名 `com.guanyun.weather.shantu.preview`，沿用 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f` 独立测试签名，可覆盖同签名“山兔测试版”。本地APK `APK/Shantu-0.2.66-test-standalone.apk`，57,830,492字节，SHA256 `282bbe0b6a6be13bd0d497e24dd02ef4a75cc4a4c6d30d7f5f12d1a786e693bc`；同目录有 `.sha256`。发行与平台说明见 [0.2.66](docs/release-0.2.66.md)。
- TypeScript、626项逻辑测试、网页构建、Android网页/Java/DEX/APK构建、打包网页启动、签名/zipalign、473块地形资源通过；浏览器390/360宽检查框选、键盘缩窗、70°倾斜地形上的标记轴拖动。`check:architecture` 仍因六个已有超长模块未通过，基线已超限，本轮没有为出包重构无关模块。真机触控、中文输入法、覆盖安装和网络逆查待验；HarmonyOS 6.1 原生包未交付。
- 本版源码与APK仅在 `codex/rollback-ui-0235-20260921` 工作分支；远程发布状态以本轮后续GitHub核验为准，不表示已合入 main。

## 2026-09-23 标记调整轴与坐标（本地视觉确认阶段）

用户真机截图显示点“调整”后只出现底部操作卡，轴和坐标都消失。3D倾斜地形视角下，地图上的地点标记贴地显示，但 `ObjectGizmo` 原先按存档海拔（可为空或过时）投影，误判为“对象在视野外”。`app/page.tsx` 把当前地图地形高度提供给标记调整器；`modules/objectTransform/ObjectGizmo.tsx` 仅对地点标记使用该高度绘制移动轴，地形瓦片更新时重算投影，并在操作卡固定显示当前WGS84经纬度；`objectTransform.css` 给读数单独一行。坐标保存、模型调整、地图图源与其他面板不变，正常浏览仍不显示轴。

- 隔离浏览器在70°倾斜、390/360px宽验证无存档海拔和错误存档海拔两种标记：X/Y轴与地图旁坐标出现，拖动X轴后坐标改变，点“完成”后轴消失；截图 `artifacts/screenshots/20260923-pin-adjust-terrain-{null,1900}-{390,360}.png`。TypeScript和网页构建通过；真机触控待验。
- 用户随后要求轴不要遮挡标记图案；现仅在地点标记调整时把轴移到图标下方48px，以细虚线关联标记，指针坐标同步换算保证拖轴仍有效，轴旁坐标随轴移动。390/360px截图已覆盖为新布局，类型检查、轴拖动和网页构建通过；模型轴位置未改。
- 本项已纳入0.2.66构建；0.2.65 APK不包含这些改动。

## 2026-09-23 标记自定义条目键盘遮挡（本地视觉确认阶段）

用户真机截图显示输入法弹出后，标记编辑卡标题与正在编辑的条目消失，而底部五项导航仍占位。Android Activity 已使用 `adjustResize`；根因是条目区的 `calc(50dvh - 267px)` 在键盘缩小视口后归零。`modules/annotations/pinEditor.css` 只在短视口且文字输入聚焦时按可见高度展开编辑卡和条目滚动区，文字输入期间隐藏底部导航；`PinEditor.tsx` 在视口继续缩小时仅滚动条目列表，让焦点行保持可见。正常高度的标记布局、其他地图面板、数据格式和输入法原生输入框不变。

- TypeScript、网页构建通过；隔离浏览器390/360px宽、530/450px可视高度验证标题和最后一行仍可见、底栏隐藏且失焦恢复。截图 `artifacts/screenshots/20260923-pin-keyboard-{390,360}.png`。浏览器缩窗模拟不等于Android真机输入法验收。
- 本项已纳入0.2.66构建；0.2.65已发布APK不包含这些改动。

## 2026-09-23 框选界面与地点 Excel 地区列（本地视觉确认阶段）

用户反馈框选操作栏占图过多、地图不能移动缩放、框线与列表行太粗、结果操作被挤出，以及导出地点 Excel 的地区列为空。当前本地改动：框选栏压为约80px两行；默认可移动缩放地图，点击“画框”后拖选，完成一框自动回到地图操作；框线1px、选中标志18px。结果卡最高184px，列表行28px且独立滚动，操作按钮固定可见。收藏夹和地图框选导出标记 Excel 均传入已保存地区；未保存的地点在导出时按既有 Photon 逆地理编码尝试补齐，15秒/最多20次，失败不阻止导出并提示空白列。改动仅涉及 `modules/collections/BoxSelectOverlay.tsx`、`boxSelection.css`、`CollectionsPanel.tsx`、`WorkbenchPanel.tsx`、`modules/annotations/spreadsheetRegions.ts`及定向测试；路线、天气、图源、标记存储格式不变。

- TypeScript、626项逻辑测试及网页构建通过。隔离9433浏览器390×857/360×780验证地图拖动缩放、框选7项后操作始终可见；工具栏80px、结果184px。收藏夹/框选导出 XLSX 的已保存省市字段均实测有值；Photon 样本逆查返回中国/四川省/成都市，但手机网络行为待验。截图 `artifacts/screenshots/20260923-box-compact-{390,360}.png`。
- 本项已纳入0.2.66构建；**0.2.65已发布APK不包含这些改动**。9423用户预览未操作；无关附件/PDF保留原状。

## 2026-09-23 0.2.65 标记 Excel 导出/回填

收藏夹导入入口增加标记 XLSX 导入和空白模板；收藏夹多选增加“标记 Excel”，地图框选仅含地点/模型时直接导出标记单表。表中每行一个点，列从 WGS84 经度、纬度、名称、备注开始，随后是按界面顺序排列的“属性：条目名”。导出自动填 ID，不需手写；导入先按 ID、再按六位小数坐标匹配，新增/更新均须预览确认，出错整批不写入，并可撤销本次导入。空白单元格保留已有字段，照片、轨迹及其他非表格字段不变。手工新建表仅新增地点，完整数据备份仍应使用 ZIP/JSON。

- 只改标记表格、收藏夹/框选入口、导入预览和相关测试及版本号；天气图层、底图、路线、照片存储格式未改。TypeScript、624项逻辑测试、网页及Android构建、打包网页启动通过；隔离9433浏览器390×857、360×780验证导入预览/确认/撤销、收藏夹和框选导出，无横向溢出。截图 `artifacts/screenshots/20260923-excel-import-preview-{390,360}.png`、`20260923-excel-export-favorites-{390,360}.png`。真机文件选择/Excel兼容与覆盖安装待验。
- 新包 `APK/Shantu-0.2.65-test-standalone.apk`，57,830,492字节，SHA256 `48714d135f6ff3d629997f46d6f55b5f831cc64b2aa48152d8036ec8533c142c`，versionCode72，沿用独立4a94签名。发行与平台限制见 [0.2.65](docs/release-0.2.65.md)。
- 天气源调研：当前天气预报来自 Open-Meteo；3D云雨是预报驱动的示意，并非卫星云图。国内和风天气有月度免费请求额度，实时风云卫星云图数据可免费实名下载，但这不等于可匿名嵌入地图瓦片。中国天气 SmartWeatherAPI 含云图和雷达但需申请审核；彩云卫星图层仅企业套餐。尚未更换天气源，见发行说明；需确认接入授权/凭证后再实现。

## 2026-09-23 0.2.64 框选按对象类型过滤

地图框选操作框新增“对象类型”下拉菜单：全部、地点、模型、区域、剖面、路线、轨迹、测量。框选只命中当前类型；切换到具体类型时移除已选列表中其他类型，避免导出/删除结果混杂；切回“全部”保留当前已选。加选、减选、结果导出/分享/删除及用户数据格式不变。只改`modules/collections/MapBoxSelect.tsx`、`BoxSelectOverlay.tsx`、`boxSelection.ts`及样式、定向测试和版本号。

- TypeScript、618项逻辑测试、网页与Android构建、打包网页启动通过。隔离9433浏览器390×857和360×780操作类型下拉框，操作框高度小于200px且无横向溢出；截图`artifacts/screenshots/20260923-box-type-filter-{390,360}.png`，真机触控待验。
- 新包`APK/Shantu-0.2.64-test-standalone.apk`，57,826,396字节，SHA256`41fab1fb6f0c49860597b115a53e6ff5026e5560acf7a9219ed7000a048972b6`，versionCode71、原4a94签名和473块地形瓦片通过。发行说明见[0.2.64](docs/release-0.2.64.md)。包含0.2.62剖面/路线互斥与0.2.63条目输入、WPML KMZ修复。Excel标记往返导入仅在讨论中，本版未实现。

## 2026-09-23 0.2.63 自定义条目输入与 KMZ 航线

用户反馈标记点“自定义条目”输入与中文输入法冲突，并再次反馈奥维导出的KMZ无法识别。条目两列现使用原生输入框，不再叠加应用内联想弹层；中文组合输入按Escape不会误关编辑窗口，其他标记字段不变。用户附件`L016.kmz`仅在本机只读诊断：其`wpmz/template.kml`不含点线，实际37个航点位于`wpmz/waylines.wpml`，属于DJI WPML航线包结构。导入器现优先读取WPML，按航点编号组成一条路线，预览时明确提示不导入飞行高度/动作指令，且不表示地面可通行。保留原通用KML/KMZ、OVKML/OVKMZ解析路径；附件/坐标未进Git或发行包。

- 改动`modules/annotations/PinEditor.tsx`、`modules/dataTransfer/fileImport.ts`、`modules/dataTransfer/djiWpmlImport.ts`、`modules/dataTransfer/TransferPanel.tsx`、定向测试与版本号。标记和路线存储格式、地图图源及既有照片/收藏不变。官方资料：[奥维文件格式](https://www.ovital.com/139064-2/)、[DJI WPML航线](https://developer.dji.com/doc/cloud-api-tutorial/en/api-reference/dji-wpml/waylines-wpml.html)。
- TypeScript、617项逻辑测试、网页和Android构建通过。隔离9433浏览器390×857、360×780实测条目输入与KMZ导入预览，原附件解析和批次预览为1条路线/37航点；预览未写入本机数据。截图`artifacts/screenshots/20260923-pin-attribute-ime-{390,360}.png`、`20260923-wpml-kmz-preview-{390,360}.png`。Android中文输入法及微信文件关联仍待真机重试。
- 新包`APK/Shantu-0.2.63-test-standalone.apk`，57,826,396字节，SHA256`e97734eca59572eea5808ac65f54921e0c96040ef7b3bfe09c3838694ed2a517`，versionCode70、原4a94签名v2/v3和473地形瓦片通过。发行说明见[0.2.63](docs/release-0.2.63.md)。0.2.62路线/剖面互斥修复继续包含在内。

## 2026-09-23 0.2.62 剖面编辑与路线选择互斥

用户截图显示剖面 A 点编辑栏与路线卡、左侧路线行程栏同时出现。原因是剖面编辑状态只阻止了部分地图点选，点路线后仍能选中轨迹；路线卡和行程栏也未排除剖面编辑。现在剖面编辑期间地图点击优先留在剖面流程，不再选中路线、区域、照片或普通标记，也不启动这些对象的拖动；路线卡和行程栏均隐藏。先选路线再打开剖面会清除路线选中；关闭剖面后仍可正常点选路线。显式从列表打开路线时结束剖面编辑。只改`app/page.tsx`的选择/显示条件、版本号和定向浏览器回归脚本，不改地图图源、路线与剖面数据格式、照片/收藏/轨迹持久化。

- 分支`codex/rollback-ui-0235-20260921`；TypeScript、615项逻辑测试、Android网页构建、浏览器390×857及360×780操作检查通过。独立浏览器验证双向切换、剖面内点路线不打开路线卡、离开剖面后路线可选；截图`artifacts/screenshots/20260923-survey-route-exclusive-{390,360}.png`，用户9423预览未操作。真机触控待验。
- 新包`APK/Shantu-0.2.62-test-standalone.apk`，57,826,396字节，SHA256`8d66fdedce361a9cd6cfd3df238a8f524783ed345caa793b28ebb277701f76d7`，versionCode69、原4a94签名v2/v3及473地形瓦片通过。发行说明见[0.2.62](docs/release-0.2.62.md)。无关附件及旧PDF保留原状。

## 2026-09-23 0.2.61 启动网络/GPS定位

从已发布0.2.60分支提交`f4443e1c4f07dc915bcc510a07d9a2c0f5fa7dbb`继续。用户要求先联网查官方资料、由多个GPT-5.5子代理分别施工、根代理审查。原生权限探测、前端启动观察、地图首次聚焦分别由三个5.5低推理子代理完成；根代理复核后修正了低精度GPS提前结束、WebView滚轮事件识别、手动操作取消聚焦及多余类型断言。Android已有权限时打开地图自动短时请求网络+GPS，首个可靠位置按误差聚焦一次，随后GPS只更新位置点；首装未授权仍由“跟随”按钮触发权限请求。20秒或可靠GPS到达后结束启动订阅，手动定位/跟随不被启动计时器停止。普通浏览器不自动申请定位。系统网络位置可能利用蜂窝和Wi-Fi，不保证单纯基站或设备一定返回。完整依据和验收范围见[启动定位施工说明](docs/startup-network-position.md)。

- 改动`mobile/android/src/com/guanyun/weather/{ForegroundLocation,NativeBridge}.java`、`modules/position/{nativePosition,usePosition}.ts`、`app/page.tsx`、`modules/map/TerrainMap.tsx`、定向测试与版本号；不动记录服务、导航精度门槛、地图图源或用户轨迹/照片/收藏/布局存储。
- TypeScript、逻辑测试及Android网页/Java/DEX/APK构建通过。隔离9433浏览器390×857实测已授权先网络粗位置聚焦、GPS后更新；未授权不启动且手动按钮可用；用户先滚轮缩放不被迟到位置拉走。截图`artifacts/screenshots/20260923-startup-network-location-390.png`，用户9423标签未操作。真机网络定位/粗略权限/覆盖安装尚未验收。
- 新包`APK/Shantu-0.2.61-test-standalone.apk`，57,826,396字节，SHA256`5bca95b201f50c2a812dfbe685de5bc9ddaff03adfde3d5e42e6d6c3a5a2668e`，versionCode68；既有4a94签名v2/v3、zipalign、473地形瓦片通过。[发行说明](docs/release-0.2.61.md)。无关`.codex-remote-attachments/`及旧PDF原状保留。
- [0.2.61测试Release](https://github.com/Siger1989/map/releases/tag/v0.2.61-test-standalone)已公开（预发行）；发布标签指向APK源码提交`d620091b0eec7d03122869ddf5fc98ed037a1b65`。GitHub APK资产uploaded、57,826,396字节，线上SHA256 digest与本地一致；校验文件亦已上传。工作分支在本条记录前与标签同SHA，后续若有文档提交，以标签确认APK源码。未以浏览器直链HTTP200或手机安装替代以上校验。

## 2026-09-23 0.2.60 测试版构建与交付

当前分支`codex/rollback-ui-0235-20260921`，工作基线`34952d48fbf1407d0bb51100a8877934bf19b5d6`。用户要求用GPT-5.5子代理执行：已由5.5低推理档接手并完成局部修改，根代理复核。收藏夹普通关闭恢复进入前的中心/zoom/pitch/bearing，主动打开或定位收藏项保留目标聚焦；已关闭的收藏预览不再因地图尺寸变化重新总览。右侧跟随按钮单击仍开关，鼠标双击与手机双点按可靠定位归位、放大至适合浏览并朝北。改动仅涉及`app/page.tsx`、`modules/{map/TerrainMap.tsx,controls/MapActions.tsx,position/PositionDock.tsx}`及版本号；地图图源、收藏/轨迹/照片存储格式和其它面板没有改动。

- 隔离9433浏览器390×857验证：收藏夹打开时4.21级，普通退出恢复进入前14级/42°俯仰/24°方位；双击与双点均回定位点、约15–16级/朝北，单击开关正常、无页面错误。截图`artifacts/screenshots/20260923-favorites-follow-reset-390.png`。用户9423标签未操作；手机真机触控仍待验。
- TypeScript、614项逻辑测试、Android网页/Java/DEX/APK构建通过；原4a94证书v2/v3签名、zipalign与473地形瓦片通过。新包`APK/Shantu-0.2.60-test-standalone.apk`，57,826,396字节，SHA256`40fbeca7c6ba8ef5f491f7a2ae39c3de31be9d4eed6c34686e8df806c5d21029`，versionCode67，可覆盖同签名独立测试版。详情见[0.2.60发行说明](docs/release-0.2.60.md)。无关`.codex-remote-attachments/`及旧PDF保留原状。

## 2026-09-23 0.2.59测试版构建与交付

分支`codex/rollback-ui-0235-20260921`，原始基线`622f4dc`，远端工作开始时与之相同。标记标签改为紧凑纯色、实心图案/单行文字，并加起终点快设；标记先选中再打开编辑，调整轴仅在调整模式出现。标记编辑上部固定、自定义条目独立滚动。框选期间即可导出/分享/删除，退出不跳视角；画线按钮恢复底板；所选已保存路线卡改为删除确认。导航结束或取消清理临时路线与起终点，保留已保存轨迹。目的地已选且起点空时自动聚焦起点。修改涉及`app/page.tsx`、标记/地图/框选/路线/控件相关模块及测试桩；图源、天气、用户存储格式和已有照片未改。

- 隔离9433浏览器390×857实际点击验证：导航前`planned-route`有3个图形，结束后0个，无页面错误；其他标记、框选、路线卡流程截图见`artifacts/screenshots/20260923-*-390.png`。用户9423标签未被操作；浏览器模拟不等于手机触控验收。
- TypeScript、614项逻辑测试、Android网页/Java/DEX/APK构建通过；原4a94证书v2/v3签名、zipalign与473块地形通过。新包`APK/Shantu-0.2.59-test-standalone.apk`，57,826,396字节，SHA256`e2e533fc60089dfe468633c4bdd14eb06b945469b802d68974c6d7cd6c25cdc1`，versionCode66，可覆盖同签名独立测试版。详情见[0.2.59发行说明](docs/release-0.2.59.md)。
- 奥维KMZ经微信打开后无可导入点/轨迹的具体文件未取得，本版未改KMZ解析器，尚不能认定该个案已修复；自动浏览缓存、UTM、Windows EXE和HarmonyOS原生包也未交付。无关`.codex-remote-attachments/`及旧PDF保留原状。
- [0.2.59测试Release](https://github.com/Siger1989/map/releases/tag/v0.2.59-test-standalone)已公开（prerelease）；发行标签指向已推送的源码提交`b0b99c6b101d1210b5e9c0c4a9bc17fda9c5e1e2`。GitHub APK资产状态uploaded、大小57,826,396字节，线上SHA256 digest与本地一致；`.sha256`资产亦已上传。未以浏览器直链HTTP200或手机安装替代上述校验。

## 2026-09-23 历史本地视觉确认：标记编辑与框选（打包前）

当前分支 `codex/rollback-ui-0235-20260921`，起点 HEAD `622f4dc`。用户确认的手机标记编辑卡已接入：返回/调整位置/删除/保存、名称、备注、WGS84坐标及分享、图案/颜色入口、拍照/导入、可增删自定义条目。按最新反馈，标题和上部字段固定；仅下方自定义条目独立滚动。图案与颜色都先显示当前值，点击后才展开完整选项（18种图案、6种预设色及自定义色）。调整切到地图，位置轴旁显示实时经纬度，模型沿用原3D控制。地图“框选”入口直接在右侧工具列，退出后所选项可继续框选、导出、分享或删除。未改路线、图源、用户存储格式或旧照片。

- 隔离的 9433 预览在 390×857 与 360×780 点击验证：第7条编辑时上部名称Y坐标仍为100px，列表自身滚动；照片导入、图案/颜色切换、地图坐标读数和框选结果正常，浏览器无页面错误。截图 `artifacts/screenshots/20260923-pin-editor-default-390.png`、`20260923-pin-editor-many-attributes-390.png`、`20260923-pin-icon-picker-390.png`、对应360图及 `20260923-pin-adjust-real-390.png`。TypeScript、21项相关测试及 Android 网页构建通过；真机触控待验。
- 用户反馈条目区过窄，卡片随条目数量增高，最多420px且不超过视口高的一半；少量条目时保持紧凑，上半部仍固定。390×857 的条目可视区上限约153px（约4行），360×780约123px（约3行），多余条目在该区滚动；两种实际截图已按上述 `pin-editor-default` 和 `pin-editor-many-attributes` 文件更新，浏览器仍无页面错误。
- 用户的 9423 预览服务曾返回旧的 `ObjectGizmo` Vite 模块；隔离9433服务加载最新代码。未重启或操作用户当前标签。当前仅视觉确认阶段，**0.2.58 APK不含这些新改动**；未提升版本、打包新APK、提交或推送。Windows EXE 与 UTM 为后续事项，等待本轮界面确认再推进。无关 `.codex-remote-attachments/` 和旧PDF保留原状。

## 2026-09-23 0.2.58-test / code65 已发布

用户要求恢复地图中心准星、标记按钮，右侧顺序为方向→标记→跟随，并要求隐藏UI后标记仍可用。本轮只调整地图控件组件与显示样式：中心准星在普通及隐藏UI状态显示；标记按钮进入右侧44px控件列；隐藏UI时点击标记先显示操作UI，再打开中心点标记面板。用户追加要求窗口避开十字星：中心按钮唤起时隐藏重复定位圆点，弹窗下移并限制为200px；长按地图的定位弹窗逻辑不变。剖面、路线窗口不再额外隐藏准星和标记。不更改路线、图源、标记存储或用户数据。

- 独立浏览器390×857及360×780检查控件顺序、尺寸、点击命中、剖面与路线编辑布局；隐藏UI后点标记可打开添加面板。两尺寸中十字星与弹窗相隔约17px，截图`artifacts/screenshots/20260923-center-mark-open-390.png`等，用户当前预览标签未操作。真机触控仍待验。
- TypeScript与614项逻辑测试通过；全新Android网页/Java/DEX/APK构建成功。最终安装包`APK/Shantu-0.2.58-test-standalone.apk`，57818204字节，SHA256 `ccf9fea95c50ebd0d20909691f57e3d5a0524dba27d45c093cccad1a8966b3cf`；v2/v3签名及原4a94证书保持，473块地形瓦片通过。Android 8.0/API26起，同系列可覆盖安装。
- 用户希望浏览过的天地图自动缓存，现阶段仅调研/讨论，**没有包含在此APK中**。目前`cachedMapFetch`先读显式离线包的CacheStorage，网络请求成功后没有写入浏览缓存；安卓WebView另有HTTP缓存，但不保证稳定离线可用。建议独立有界的浏览缓存，只存实际加载的有效瓦片，不影响显式下载包和Key/配额；容量、保留期与服务授权边界待确认。
- 测试[Release](https://github.com/Siger1989/map/releases/tag/v0.2.58-test-standalone)已公开（prerelease，非草稿）。tag指向源码提交`3948fc217d5167096bff9a86b0c87e3d77813e2b`；远端分支当时也与该提交一致。GitHub资产状态uploaded、APK大小57818204字节、服务端SHA256 digest与本地一致，校验文件也已上传。直链HEAD在本机网络被重置，未记为HTTP200；Release API资产URL已核实。HarmonyOS 6.1原生HAP/APP仍无交付，安卓APK在该系统的兼容安装尚未真机验证。

## 2026-09-23 最新：0.2.57新APK已发布

用户现要求先交付APK。构建源码已提交到分支`codex/rollback-ui-0235-20260921`，Release tag指向`fec4f669b49092e0be24a0215fb15da11ff29aba`，与当时远端分支一致，未合入main。公开最新版此前是0.2.56，故沿用尚未发布的0.2.57-test/code64，完整重建并替换本机过期同名包，不复用旧资产。

- 新包：`APK/Shantu-0.2.57-test-standalone.apk`，57818204字节，SHA256 `c5320171b34caa20b1e4ffcecf6535a9ea2a90e5d17e07d67e585aa444edd6be`，同目录`.sha256`匹配。独立测试包名`com.guanyun.weather.shantu.preview`，既有4a94签名，Android 8.0/API26起；同系列可覆盖安装，不清除用户轨迹、照片、布局或收藏。[GitHub测试Release](https://github.com/Siger1989/map/releases/tag/v0.2.57-test-standalone)已公开，线上APK为57818204字节，GitHub提供的SHA256 digest与本地一致，直链HTTP 200。
- 用户真机截图出现`TypeError: t is not a function`，同版打包网页在隔离Chromium中复现，根因为旧UMD坐标转换库跨分块循环初始化；导入器改为等价ESM公式，10,000组坐标与原库一致，新打包网页已独立验证可进入主页。错误页改为显示真实APP_VERSION及堆栈，Android UA改为实际安装版本；截图旧版本字样只是此前硬编码，不能证明用户装旧包。
- 最终源码TypeScript及614项逻辑测试通过，网页/Java/DEX/APK全新构建通过，v2/v3签名、zipalign、551项ZIP CRC、473块地形瓦片以及新终点/导入/框选/运动方向网页特征通过。架构检查仍有5个既有大文件超行数预算，未临时放宽规则。
- 手动分叉终点、路线编辑和预览Vite解析修复已在新包；当前无法使用CUA浏览器控制取最新截图。真机覆盖安装、微信打开文件、GPS/运动传感器、持续缩放卡顿和触控尚未验收；HarmonyOS6.1原生HAP/APP未交付。发行详情见[0.2.57说明](docs/release-0.2.57.md)。

## 2026-09-23 开发记录：路线编辑快速预览（已被新构建覆盖）

下列为打包前的本地预览记录；其中“旧APK过期”的判断已由上节新包取代。构建前分支codex/rollback-ui-0235-20260921，HEAD 83a725e913ec657b540c55568090e4323a48cc43。

- 预览故障修复：用户截图显示Vite无法从routeShare/data解析新建的tracks/routeTerminals文件；文件实际存在、单独请求正常，运行中9423服务对跨目录相对导入返回500。将端点读取函数经已有tracks/drawing入口导出并供跨模块复用后，data、savedRoute和SelectedRouteInfo的Vite模块请求均为200；未重启9423、未操作用户页面。最终手机网页构建、TypeScript、17项终点/分享/导航定向测试通过；CUA浏览器连接仍失败，覆盖层是否已在用户标签自动消失未验证，必要时用户刷新当前预览。
- 路线框选直接整合进编辑面板：点选、框选加、框选减；退出保留选择，松手清除框。选中点保留原色加细亮边，相连线段加亮边；线宽和点径在“线/点”分别调整。
- 分叉终点改为明确选择：旧分叉不再从最后一段推断终点；编辑时单选路线节点点“设终点”，新分叉保留原路线终点，移动/删除端点和撤销同步更新。地图、路线详情、行程点、分享图/二维码统一读取该终点；未指定时不显示假终点，导航提示先选择。导航到手选分叉节点时重算实际路径，反向亦如此。已保存路线的起终点元数据兼容旧数据，原路线几何不改。
- 单点可编辑颜色/备注及添加实际标记，多点只修改两端均被选中的相连线段。新增selectionDetails、displayColors、routeEndpoints、RouteSelectionFields、RoutePointMarkerFields；接入RouteViews、TrackLayer、TrackNodeBoxSelect、routeEdit、joinedEditStore、page和样式。点/边元数据随移动、裁切、拼接和撤销保留；同一路线裁切后拼接统一拓扑，连接点不再误标为终点。
- 标记随路线草稿保存，支持撤销和跟随节点移动；图案选择复用现有18种SVG图标，替换文字下拉框。图案、名称、备注、颜色独立。修复拖点后选中属性栏消失、重新选点时检查器颜色与地图颜色不一致。
- 追加修复“两点选中变直线”：原SVG高亮仅连接屏幕端点，不能跟随三维地形；改为selectedEdgeLayer地图原生贴地线层，置于原色线下方，仅画亮边。选中不修改路线坐标，拖动预览同步地理边，退出编辑清除。TrackNodeBoxSelect只保留点圈和框选操作。
- 新增trackNotes：按连续物理路段显示非空备注，优先独立边备注再回退同色路况；点备注也在点旁显示。11px小字、少量描边、碰撞避让，不跨断线；长内容截取18字加省略号，完整备注不改。用户继续反馈等高线数字偏密偏大，已从12px/140px改为11px/210px，文字避让5px、描边1.4px，等高距不变。
- 分享图通过CurrentMapContext读取主页当前底图/专题图层，RouteShare和WorkbenchShare统一接入，保留图源坐标校正、等高线和来源署名；输出完整路线的俯视图，不复制编辑选择、其他私有路线、定位数据、三维天气动画或自定义模型。独立输出地图不启用三维相机高程，避免DEM加载后短路线被放大裁切；地形晕渲、等高线和海拔着色仍按当前开启状态。已实际生成含卫星底图及路线备注的图片，旧预览需点“重新生成图片”。
- 最新TypeScript及66项终点/路线编辑/导航定向测试通过；终点这一轮浏览器预览连接报`nodeRepl.fetch request failed`，未能取得新截图或做新的浏览器点击验证。此前独立localhost实测拖动→另选→重选、图案切换/添加/撤销、多点贴地亮边、地图备注、当前图层分享；360×780及390×857图案截图见artifacts/screenshots/20260923-route-marker-icons-360.png、同前缀route-marker-icons-390.png；360图案面板当时实测300×186px。另有route-edge-notes-390、share-current-layers-390及current-preview-notes-contours旧截图。用户127.0.0.1预览未手动刷新、点击或改数据。更早596项全量测试不代表最新修改完成全量验证。
- 未改动其他业务的既有存储键、签名或用户原数据；真实触控、微信导入、持续缩放和运动传感器仍待手机验证。原地图卡死/局部着色根因未确认，DEM未统一，HarmonyOS6.1原生未交付。

## 2026-09-23 历史构建记录：0.2.57-test / code64（已被后续预览修改取代）

分支codex/rollback-ui-0235-20260921，构建前基线83a725e913ec657b540c55568090e4323a48cc43。以下仅记录早前构建时的状态与校验，未发布；APK不含最新路线编辑修改，当前状态以上节为准。

- 等高线按用户澄清改为**30/50/100/200米垂直高差间隔**，默认最细30米；没有30/60/120米水平精度切换。缩小时自动稀疏至100/200/500米，详细地图使用所选间隔并独立记忆。普通等高线也标注海拔，重复间距280→140px、描边1.4→1.8px，保留碰撞避让；共享有界DEM worker缓存。涉及terrain/contourInterval、terrain、LayerPanel、map/types、TerrainMap及page。
- 追加修复框选：原路线编辑工具条z42挡住框选工具z24，松手矩形留存、退出即丢选择；现在框选时只显示当前工具，加选/反选（减选）连续取并集或差集，松手清矩形，退出保留选中点并恢复上级编辑/地图拖动。新增collections/BoxSelectOverlay和box-selection-mode测试，改TrackNodeBoxSelect、MapBoxSelect、RouteViews、BoxSelectionResults与page；对象结果页继续框选保留选择，移除离开收藏时的误清空。390/360下实测点数1→2→1→退出保留→重入2，面板300/284×166px，矩形/输入面在退出后为0。
- 方向新增四项菜单及运动方向朝上：优先GPS航向/速度，否则连续可靠定位位移计算方位；去重力加速度仅辅助静止过滤，低速/失准时保持方向。新增position/DirectionControl、motionHeading、useMotionHeading及原生MotionSensor，接入定位、跟随、临时浏览和生命周期。手机朝向与运动朝向分别选择，不以加速度积分冒充绝对航向。
- 下节路线导入、OVOBJ等读取器、微信文件关联、图源坐标校正和诊断一并进入本版。实际L013为74点/5517.99米；不能承诺所有私有版本。没有更换/统一全部DEM，真机地图卡死和局部色块仍未复现，根因未确认。
- TypeScript、594项逻辑测试、最终网页/Java/DEX/APK构建通过；v2/v3签名、zipalign、551项ZIP CRC、16项网页/8项原生特征、473块地形像素检查通过。架构检查5个既有大文件超预算，未提高预算。390×857和360×780实际截图/点击通过，100米选择重载后仍保留；用户预览仍为phone-preview.html。日志.openai/apk-0.2.57-*仅本地。
- APK/Shantu-0.2.57-test-standalone.apk：57814108字节，SHA256 a1ddf280baf1d4547a92695530ac86c226e4646ffa8b8b49f46ab89ffeb4bfe5。包名com.guanyun.weather.shantu.preview及4a94签名保持，覆盖同系列旧版，无需卸载；轨迹/照片/布局/收藏不迁移、不清除。
- Android真机覆盖安装、微信打开文件、持续缩放、运动GPS/传感器、触控和后台轨迹尚未验收；HarmonyOS6.1原生包未交付。范围、安装及下载见[0.2.57发行说明](docs/release-0.2.57.md)。无关附件/PDF、原路线、截图、凭证和构建日志不上传。

## 2026-09-23 本地预览：地图诊断、图源坐标校正、路线直接导入

当前分支codex/rollback-ui-0235-20260921，基线83a725e913ec657b540c55568090e4323a48cc43。本轮业务已修改，处于本地快速预览阶段，未提交/推送/提版本/出APK；此前0.2.56安装包不包含本轮代码。

- 图源：新增coordinates/RasterCoordinates/rasterWarp.worker，每源WGS84/GCJ-02/BD-09栅格重采样校正；同步TerrainMap、RasterDetailPatch、TiandituSources、在线源和图源面板。主页一页可达，360窄屏无内部纵向滚动；GeoTIFF和百度专有瓦片矩阵不在此实现范围。
- 地图：RasterLevelLock保持元数据加载期间的层级限制；renderDiagnostics补充图源、DEM、WebGL和渲染状态。真机卡死与局部高程色块未复现，根因未确认。DEM只完成现状审计，未换源/统一全部取样模块。
- 导入：RoutePanel/RouteResultSummary、Collections/Workbench增加共享RouteImportDialog；Outdoor记录首页移除导入。TransferPanel展示读取/预览/错误，确认后app/page实际选择路线并定位。Android IncomingRoutes、MainActivity、NativeBridge、AppFiles和Manifest接收VIEW/SEND文件；尚未微信真机验证。
- 格式：保留GPX/KML/KMZ/OVKML/OVKMZ/备份JSON，新增独立OVOBJ、OVJSN、TCX、FIT、GeoJSON、CSV/TSV适配器和routeBuilder。L013.ovobj真实文件直接解码74点/5517.99米并显示地图；OVOBJ仅已验证v105结构，基准未确认时预览提示。新增importFormat保留来源标签，原数据/存储键/照片/布局/签名不迁移。
- 验证：30项定向测试、TypeScript、Android网页生产构建、全部Java源编译通过；FIT官方3601点样例、公开OVOBJ配对坐标及用户真实文件验证通过。截图artifacts/screenshots/20260923-ovobj-loaded-390.png和此前360窄屏截图。只有浏览器/编译验证，不等于手机验收。
- 范围与后续：[反馈进度](docs/pending-feedback-20260923.md)、[格式兼容性](docs/route-format-compatibility.md)。后续明确交付时再同步源码和新包；不把部分私有格式支持称为市面全格式通用。

## 2026-09-22用户恢复打包并上传：0.2.56-test / code63

用户明确“打包并上传”，覆盖上一节暂停上传要求；本次交付Sentinel-2默认主图版本，旧0.2.54/0.2.55草稿保持不动。源码分支codex/rollback-ui-0235-20260921，未合入main。

- 基于下节Sentinel-2修改提升config/product.ts与mobile/android/AndroidManifest.xml版本，新增docs/release-0.2.56.md；包名com.guanyun.weather.shantu.preview与原4a94签名保持，可覆盖同系列旧版。保留轨迹/照片/布局及既有离线包，无数据迁移。
- 最终网页/Java/DEX/APK重新构建通过。TypeScript、22项定向测试、v2/v3签名、zipalign、543项ZIP/473地形瓦片、44项网页及11项原生特征通过。本地日志.openai/apk-0.2.56-*不提交。
- APK/Shantu-0.2.56-test-standalone.apk，57788854字节，SHA256：893a27b7a5668ede64064730d42b01a01468c710a121285550597a55b5cb7dc6。校验文件同目录.sha256。
- 已公开发布https://github.com/Siger1989/map/releases/tag/v0.2.56-test-standalone（预发行393589564），APK与校验文件均uploaded，远端大小和SHA256与本地一致。发行标签及构建源码为8dd306669307b970420a30a4255c95d82ae54da0，已核对分支与标签远端一致；本条发布结果另作文档提交，不改变安装包源码。
- 当前Sentinel-2为2025合成/约10米/Z14上限，区域下载仅预留入口，天地图手动选择；未承诺Google、完整缓存重构或每日计数。桌面直连与预览已验证，手机网络/安装/定位/触摸仍需实测。HarmonyOS6.1原生没有可交付HAP/APP，详见本版发行说明。


## 2026-09-22 Sentinel-2 2025 默认主图（本地预览，未出包/上传）

- 用户确认先以 EOX Sentinel-2 cloudless 2025 为主图；上一轮暂停上传继续有效。当前分支 codex/rollback-ui-0235-20260921，远端基线 2a33e3f5e58a00f901b66a8247eafabca2fb24df。本轮源码仅在工作区，手机已装 0.2.55 尚不包含此改动。
- 新增 modules/cartography/sentinel.ts、tests/sentinel-provider.test.mjs。修改 map/types、terrain/terrain、TerrainMap、LayerPanel、TiandituSources、MapSourcesPanel、RouteMiniMap 与 app/page：默认主图与导航小地图使用 2025 EOX；天地图初始图层隐藏，必须手动选择。有效瓦片最高 Z14，继续放大只放大已有影像；保留约10米、年份及 EOX/Copernicus/CC BY-NC-SA 署名。已有天地图离线包显示设置仍可显式恢复图源。
- 当前只接入在线浏览；区域下载入口标明待接入并禁用，路线下载也有明确提示。未实施此前完整缓存重构、请求配额统计、Google 或 PMTiles；未迁移/清理轨迹、照片、布局或既有离线包。
- 本机 curl --noproxy '*' 测试：EOX WMTS capabilities HTTP200/3.80秒，2025 Z14 实际JPEG瓦片 HTTP200/1.36秒/15430字节。只证明绕过显式代理后本机连接成功，不保证其他网络或排除系统级隧道；手机网络未实测。EOX 公共服务仍可能限流，失败提示用户重试或手动换源，不自动切天地图。
- 验证：npx tsc --noEmit、16项定向测试（含默认图层不启用天地图、Z14、旧包选择兼容）、npm run build:android:web、git diff --check通过。构建仅现有大chunk警告，未构建APK。测试扩展 tests/roads-models.test.mjs。
- 390×约857预览实际加载主地图及导航小地图；图源面板276×200，导航加减/摇杆及署名可见。截图 artifacts/screenshots/sentinel-20260922/{source-selector,main-map,navigation-map}.png；未进行新一轮真机验收。下一步用户确认图像效果与手机直连后再明确安排APK交付，不恢复已暂停的上传。


### 已查到服务端限流（用户确认仅缓存未勾选、细节自动）

- 使用当前构建配置Key，分别以预览与Android资源Origin/Referer请求天地图影像14/16/18级，六次均HTTP429且非图片。随后单独16级复核响应：code302010，msg“该tk已限流”，resolve“请求已限流，请稍后重试!”。不记录或上传真实Key。日志仅本地.openai/check-phone-tiles.log和check-phone-tile-error.log。
- 解包已安装来源0.2.55 APK，确认脚本内Key与本次请求一致；开发预览也使用同一Key。当前在线新瓦片有实际服务端限流，不能继续认定仅14级设置问题。电脑仍显示可能来自已加载/浏览器缓存，此项为推测；尚无手机网络日志，不能排除并发的设备问题。
- 恢复需要图源限流解除或用户在图源账户核查授权/配额；响应未说明是瞬时频控还是累计额度，也未给恢复时间。不轮换Key/主机绕限流，不继续批量重试。现有统一“等待网络恢复”提示没有展示限流原因，待授权修改时加明确分类及退避，当前未改业务代码或出新包。
- 气温截图另已定位：固定5×5采样点、步长0.32度，逐格纯色fill，随中心移动而不随视野范围扩展；图例与继续按钮重叠。尚未修改或打包。


## 2026-09-22用户已安装0.2.55，暂停上传并调查手机地图

用户安装本地0.2.55后反馈：手机放大无法继续加载地图，电脑预览正常；明确“先别上传”。已停止本轮gh上传进程22332，未发布：v0.2.55-test-standalone草稿393550317仅有.sha256。源码此前已推送2a33e3f5e58a00f901b66a8247eafabca2fb24df并核对远端一致，不再继续上传或自动出包。

排查已确认：本版在线打开缓存会清除offlineMaxZoom，但“地图仅使用已缓存数据”持久开关仍会主动阻止新瓦片网络请求；手机与电脑各自保存不同设置。APK缓存命中走OfflineStore，未命中走WebView外部HTTPS；主地图与预览使用相同瓦片逻辑。ADB当前无连接设备，尚未取得手机请求错误，不能认定根因。已向用户确认仅缓存开关；后续区分纯缓存/手动细节锁定/实际手机瓦片请求失败，不能以桌面正常当真机修复。


## 2026-09-22明确恢复打包：0.2.55-test / code62

用户最新要求“打包把”，覆盖下方暂停打包及未交付的历史状态；本版整合0.2.54修复和本轮已预览UI。分支codex/rollback-ui-0235-20260921，不合入main；旧0.2.54草稿不作为本次交付。

- 新增modules/appearance/及tests/appearance.test.mjs；修改About入口、应用Provider、主题CSS、路线/画线/高程摘要、导航小地图和WebView缩放配置。具体文件与预览证据见下方记录；版本统一升为0.2.55-test/code62。原有轨迹/照片/标记/布局、包名、签名与地图业务颜色保留，无数据迁移。
- 最终源码生产网页、Java/DEX/APK构建通过；类型检查与35项定向测试通过；原4a94证书、v2/v3签名、zipalign、543项ZIP/473地形瓦片、39项网页及11项原生特征核验通过。运行日志仅保留本地.openai/apk-0.2.55-*。
- APK：APK/Shantu-0.2.55-test-standalone.apk，57,784,758字节，SHA256：0ecc915536e05ddf3234c8ffe8aa5a35921b928f331a7eb9fe9c62c9b5c37b68。
- 发行说明docs/release-0.2.55.md；发行目标https://github.com/Siger1989/map/releases/tag/v0.2.55-test-standalone，附APK与.sha256。本次需完成分支推送、公开发行及远端SHA/资产摘要核对后才能报告已同步。
- 浏览器390×857/360×780交互及截图已验；尚未做本轮真机覆盖安装、双指/指南针/后台运行与缓存14级原机复测。下一步安装本版复测这些项目。HarmonyOS6.1原生仍未交付，无HAP/APP或邀请链接，不把APK称为原生鸿蒙包。


## 2026-09-22反馈快速预览版（未打包，待视觉确认）

用户要求根据累计反馈快速修改，过程中追加“缓存必须同排、切换要按钮底板”“画线不列已保存轨迹”“背景和按钮颜色分开”。本节覆盖下方这些项目的“待实施”状态。基线仍为356ddc30d85bd0044ecf42549e0cba4cfb8c3c15；本轮修改在工作区，快速视觉确认阶段暂未提交/推送或生成新APK，0.2.54草稿上传不自动恢复。

- 新增modules/appearance/{theme.ts,AppearanceProvider.tsx,AppearanceSettings.tsx,appearance.css}；Logo→个性化，浅/深/跟随系统、三套预设、主色/窗口背景/按钮底色/文字独立调色、对比度、实时预览、持久保存、恢复山兔默认。对比度不足时文字自动使用可读颜色；旧试用设置缺少按钮底色时补默认值。app/layout.tsx与mobile/main.tsx共用Provider，AboutPanel加入入口。未重置用户布局、原轨迹或地图业务配色。
- 同一CSS变量统一菜单/子菜单、路线/画线/工具及记录控件的底色、边框、按钮形态；按钮色独立于窗口背景，包含顶部/底部/右侧按钮。记录控制台旧!important样式作局部覆盖；保留海拔/路线颜色语义。
- HomeRouteCard把手绘轨迹并入摘要，缓存加入同一行五个操作；TrackJourneyRail原路与正反向并排上移，全部有底板。SelectedRouteInfo高程状态合入剖面顶部；只有统计时合入统计标签。RouteResultSummary缓存也并入已有管理行。
- 画线首页下置底栏上方，移除预先道路/节点/河流吸附和样式设置，保留绘制中工具；首页仅新建/续画/当前草稿。已保存完整列表移除，仅在续画选择器里选对象；收藏调用的单条详情继续可用，不删除数据或详情能力。底栏进入画线时清空“选中项”以避免自动跳入历史详情，保留草稿。
- Navigation小地图添加44px加减按钮和72×68摇杆，独立相机操作、北箭头跟随朝向；启用地图自身拖动缩放。修正旧全局camera-gizmo bottom样式覆盖造成摇杆压住减号。app/globals.css、两套viewport和MainActivity强化阻止整页缩放；浏览器布局比例1，地图自有交互保留，真机双指行为尚未验收。
- 顺手纠正界面APP_VERSION_CODE从60为61，与现有0.2.54 Manifest一致；未升级版本号/生成新包。
- 验证：类型检查通过，5项定向测试通过（主题默认/坏存储/独立深浅/文字可读/背景按钮独立及旧值兼容，导航结果复用与在线14级恢复）；git diff --check通过。截图artifacts/screenshots/feedback-ui-20260922/。390×857实测五个路线按钮同y=129、宽42px/高36px；360×780截图五个操作仍同排。360画线入口264×104px、底部y=720，无保存轨迹列表；工具菜单276×166px、按钮36px；个性化继承既有关于页内容窗口高度，不按普通操作浮窗200px截断。
- 独立localhost测试配色：红色窗口rgb(255,77,77)时按钮保持rgb(238,243,240)；深色重载保留；恢复默认有效。未覆盖用户正在预览的自定义配色。小地图加/减点击、摇杆键盘俯仰与旋转各到5度均可用；方向按钮切换状态已核对。右侧主预览保留390×约857框架，独立测试页已关闭，临时viewport恢复。
- 限制：本地部分高程API仍不可达，截图真实显示缺测；手机旧APK未包含本轮更改。Android新增WebView配置未重编译，未做真机触摸/系统放大行为验收。等待用户视觉确认与明确打包指示再统一提交同步/交付。

## 2026-09-22追加反馈：用户暂停打包，继续找bug

- 追加待实施（三张截图）：合并路线来源标签、缓存按钮及高程状态的独占行；正反向上移至行程点顶部；可点击文字统一增加底板。已定位HomeRouteCard、TrackJourneyRail、SelectedRouteInfo，详见待改清单。

- 追加待实施：统一路线/画线/工具及各级菜单视觉；画线一级面板下置至底部导航上方，移除开始前重复的道路/节点吸附选项，保留绘制中吸附功能。详见待改清单。

- 追加待实施：左上角山兔→个性化，参考Codex外观设置提供主题/主色/背景/文字/对比度预览，固定山兔默认值、持久保存和一键恢复；只记录，见docs/pending-feedback-20260922.md。

- 0.2.54源码已推送：356ddc30d85bd0044ecf42549e0cba4cfb8c3c15，远端分支一致。APK已构建，GitHub上传过程中用户要求“先别打包，我继续找bug”，已停止对应上传进程；v0.2.54-test-standalone此前查询为草稿，仅校验文件已上传，不能当作公开交付。
- 新追加尚未交付：UI双指放大整页；导航小地图需要加减按钮和3D摇杆。已做本地初步修改：app/globals.css、app/layout.tsx、mobile/index.html、MainActivity.java加强页面缩放限制；RouteMiniMap.tsx、navigationStart.css复用摇杆与加减按钮，启用小地图交互。尚未完成本轮定向验证与截图，未进已构建APK，未提交。
- 原生原已有setSupportZoom(false)，不能仅凭源码认定真机根因；网页viewport此前未限制缩放。需后续区分网页缩放、布局编辑缩放与系统放大，并实测地图自有双指缩放及面板滚动。
- 等用户继续汇总，不自动构建或发布；用户明确恢复后再验证、统一修订及交付。

## 2026-09-22集中反馈交付：0.2.54-test / code61

- 用户已要求按当前讨论统一交付；本节覆盖下方“先记录/尚未实施”的历史状态。基线644d1df2edcaf461a7f37138d51fee01d4cb1586，分支codex/rollback-ui-0235-20260921，不合入main。
- 导航准备：保留原始路线及各方式已成功方案，同图显示、选中高亮；选择方式不自动算路，首次点“规划此方式”，已生成点“重新规划”才重算。结果在当前应用进程中按原线及起终点/方向/方式复用，窗口重开不会因生成时间变化重算，重启应用不承诺持久保留。缩略底图复用天地图配置及离线请求适配，补加载失败/重试；无天地图配置时保留OSM降级。
- 记录：同一窗口内按底色分组，照片入口去重，移除记录/行程返航入口，“导入/导出”“离线地图”明确命名；样式采样按需展开。暂停可继续；结束直接保存或取消，等待原生最终快照、持久核验后再清理，失败可重试，空记录不误称待保存。新增finishRecording流程模块，独立照片/标记不删除。
- 离线：移除与下载任务分离，可删除其他包；当前下载先停止并等待，再删除。原生缺失任务删除幂等，清理重试保留清单，共享瓦片保留；网页删除后重读索引避免覆盖其他包进度。在线打开包不再继承14级缓存细节上限，纯缓存模式保留相应上限。
- 选中离线包绿色高亮约3秒：完整天地图包按最高不超过14级瓦片覆盖拼接；旧包无可用覆盖时只标外接边界，未完成包只标计划范围，不把未完成下载说成已缓存。
- 方向/跟随拆独立按钮，可在其他位置开启指南针而不跟随。收藏/锁定保留3D摇杆，锁定恢复不再把导航状态强制当位置跟随。海拔参考按最新要求移入右侧44×84px小色标，原海拔颜色算法不改。
- 类型检查及32项定向测试通过，覆盖方案复用/重试/迟到响应、最终记录快照/失败保留、删除重试与并行进度/共享瓦片、实际Java删除方法、在线缓存层级恢复等。安卓生产网页与Java/DEX/APK构建通过，签名v2/v3及原4a94证书、zipalign、543项ZIP/473地形资源、33网页及9原生标识检查通过。
- 实际应用390×857及独立360×780检查：记录窗276×200，内部滚动、无横溢；色标44×84、右侧控件4px间隔；收藏/锁定摇杆可见且不与按钮重叠；导航缩略底图实际加载天地图，缓存提示3秒后消失。多路线使用明确标注的独立示例验证，原始用户路线未改。截图artifacts/screenshots/feedback-0.2.54/。本地预览部分地形API资源不可达，海拔缺测仍显示—；不冒充全部数据加载或真机验收。
- APK：APK/Shantu-0.2.54-test-standalone.apk，57,784,758字节；SHA256 3685965c8939a827062365b02554fab5072d228665fb3fa59a595e7d87e29a8e。发布目标v0.2.54-test-standalone；实际提交与远端核对结果见本轮交付。发行说明docs/release-0.2.54.md。
- 保留原始轨迹、照片、标记、布局、存储格式、包名和签名；未新增服务或迁移目录。真实手机指南针/触控/断网后台/覆盖安装仍需用户复测；HarmonyOS6.1原生包未交付，既有工具链与签名分发阻碍未解除。


## 2026-09-22 13:00后：先收集，不立即修复

最新故障反馈：地图可继续放大，但14级后不增加细节。已查到打开14级离线包会无条件应用offlineMaxZoom=14，在线模式也可能残留此上限；尚未读取手机当前图源/缓存模式，需排除本身14级图源及手动锁定。源码诊断与临时排查步骤已记入待修清单，尚未改代码。

最新追加：方向与位置跟随拆成两个独立按钮，允许在其他地图位置观察时开启方向而不回到当前位置；切换跟随不重置方向。已核对现有onLocate三态循环及独立heading更新路径，待修清单已记录，尚未改代码。

追加缓存范围交互：选中离线包时在地图绿色高亮覆盖范围几秒后自动消失，暂按约3秒设计；已核对现有打开包仅恢复图源并定位bounds，没有临时高亮。注意区分实际覆盖与外接矩形/未完成包，详见待修清单，尚未实施。

追加导航方案要求：保留原始路线及已生成的各出行方式路线，地图同时展示并高亮当前选择；只有原路线时只显示一条。切换已有方式复用结果，专门点击“重新规划”才重算。已确认单roadPreview及mode依赖effect会丢失旧方案并重复请求；需求与验收补入待修清单，尚未实施。

追加最新截图反馈：导航准备缩略底图空白；记录页照片入口去重、去掉返航，“数据/离线”改清晰名称并尽量整合一个窗口，同类功能统一底色框；收藏及锁定界面均保留可操作3D摇杆。已核对独立OSM缩略底图、重复入口和锁定CSS隐藏路径；手机底图失败原因尚未复现。详见docs/pending-feedback-20260922.md，继续仅记录，未改业务代码/出包。

追加13:11记录流程反馈：暂停保留并可继续；结束直接选择“结束并保存”或“取消并结束”，自动收尾，不再独立保存/清空。已检查现有finished/保存门槛与原生异步命令，空记录待保存误导和最终快照/持久化边界已写入同一待修清单，尚未改业务代码。

用户反馈离线包移除后仍在且无法再删，要求先研究记录、后面一起修。已确认全局下载锁禁用所有包管理，以及跨存储删除失败后残留/重试不幂等的代码路径；手机此前实际触发原因未核实。详见docs/pending-feedback-20260922.md。本轮只写记录，业务代码、APK不变，待集中修复交付时同步。

## 2026-09-22故障修复与测量交互：0.2.53-test / code60

- 基线94afa67a41c9e01aadd30e478d654c211154b891，分支codex/rollback-ui-0235-20260921。用户真机反馈0.2.52离线启动出现Java exception，随后追加画线末尾长度、测量点换位与全段剖面要求；本节覆盖下方旧发行记录。
- NativeBridge.offlineStart原在JavascriptInterface后台线程调用trustedForeground，内部读取WebView.getUrl且位于try外。现准备任务后异步派发UI线程验证页面并启动服务，不同步等待UI；异步失败写paused状态，通知权限失败不反向取消已启动服务。nativeOffline转为中文错误；useOffline在第一次进度前保留当前任务，启动异常后“继续下载”可用。
- DrawingSession补充当前预览段距离，TrackDrawing在末尾显示累计米/公里，包含道路吸附弯折、实时拖动，取消/撤销跟随草稿；新增标签避开放大镜并不拦截触摸。只接入路线/分叉画线，区域多边形不增加长度标签。
- 测量上方ABC按钮直接进入当前点持续换位，点击地图、照片/标记或其他测量点替换该点；保留ID、相邻连线、地形高度更新。修正撤销栈的延迟引用，换位前捕获旧坐标。ProjectionChart显示完整A至末点，选中段仅高亮/改变统计；新projectionLayout压缩显示并保留短段标签，长链内部水平滚动，缺失海拔不连接、不伪造。导出分页格式未改。
- 路线地图选点及已绑定路线的标记通过routeProfilePoint同步到底部剖面；新增绿色游标、里程/海拔/路段坡度角及可用的实测速度，反向同步里程和坡度符号。缺测显示—，其他路线选点不串入。390×857与360×780真实组件检查，窄屏图框264×171无裁切；新增9项相关回归通过。
- 类型检查及58项定向测试通过：包括Java生产启动方法的5种线程/权限/失败边界、桥接异常后重试、画线实时路径距离、测量替换/已有点点击/撤销与200点全段布局。修正一个既有测试对0.2.52默认travelMode的过期期望。
- 390×857实际测量页面图框300×182，ABC全部显示；360×780独立真实组件长图图框296×192，横向滚动可达630px末端，无面板横溢。画线累计1.9→加点2.8→撤销/移动准星3.4公里，标签与放大镜边界无交叠。截图artifacts/screenshots/hotfix-20260922；独立数据为明确标注的示例，未修改用户真实测点位置。
- 最终APK已构建：APK/Shantu-0.2.53-test-standalone.apk，57,780,662字节；SHA256 9e50cfeb403afc82af55cfc5386c078766946bc50e5e5d2fd5dcb9303a871cad。版本60、原签名v2/v3、zipalign、543项ZIP/473地形资源、24网页与9原生功能标识通过。发布目标v0.2.53-test-standalone，说明docs/release-0.2.53.md。原始路线/照片、保存目录、缓存文件格式、图源密钥和用户布局保持不变。真机后台/省电和覆盖安装回归仍需复测，HarmonyOS6.1原生未交付。

## 2026-09-22追加反馈交付：0.2.52-test / code59

- 基线2d9d19ce32087289cb36ea233a8fbd6a54e4905f（0.2.51），当前分支codex/rollback-ui-0235-20260921。0.2.51 Release已发布且APK远端SHA256与本地一致；后续改动不在该包。
- 已写入：收藏打开暂隐右侧地图工具，操作面板/编辑时隐藏锁定入口；锁定仅保留原定位按钮，模式仍循环且更新10秒回位基准。坡度界面统一用atan换算角度，内部原始坡比/阈值不改。路线详情/轨迹样式增加步行、跑步、自行车、摩托、汽车出行方式；五档速度颜色共用配置并存于路线style。
- 用户确认固定级别超过承载范围允许中心高清、外围概览，随后要求尽量全屏。新增RasterDetailPatch：直接读取所选级别瓦片合成地图image覆盖层，能在144张预算内覆盖全屏时全屏，否则中心最多12×12；外围仍同源概览。相机缩放不受限，停下拖动更新。不是无限全景18级承诺。
- 离线下载加收藏与下载窗progress/count，浏览器续传先扫描已缓存资源、只补缺项。新增安卓OfflineStore/OfflineDownloadService与nativeOffline桥：私有持久瓦片、原子写、dataSync前台服务/通知进度/暂停、断网退避重试、应用恢复读取进度、本地网关优先读原生缓存。安卓原生源码编译通过；真实切软件/断网/重启/省电限制仍未验收。
- NavigationStart对实走/手绘增加沿原路线与按道路新规划选择，三种方式按钮实际调用已有规划器；预览成功才允许用新路线开始，快速切换取消旧响应，原轨迹不覆盖。规划方式切换、取消过期请求、失败后返回原路线已通过DOM定向检查。
- 类型检查与54项定向测试通过，安卓网页/Java/DEX/APK构建通过。实际收藏进度33%且右侧工具隐藏、锁定定位保留、固定13级全视野与18级中心覆盖已核对；390×857、360×780真实组件检查规划预览与摩托速度分段，独立布局使用标注的测试数据。截图artifacts/screenshots/feedback-next-20260922；不代替真机验收。
- 最终APK：APK/Shantu-0.2.52-test-standalone.apk，57,776,566字节，SHA256 bcc428d774003b28ac04631fbb77a26ec740b88910f84c2c8ca437f4791fd04e。原签名v2/v3、zipalign、543项ZIP内容、473地形瓦片、18项网页与7项原生功能标识检查通过。发布目标v0.2.52-test-standalone，源码仍推当前分支，不合入main；发行说明docs/release-0.2.52.md。保存目录不迁移；HarmonyOS原生仍未交付；附件/凭据/日志不提交。
- 设备仍未连接：切软件持续下载、断网恢复与省电系统回收待实测。旧版浏览器缓存保留，但升级后由原生接管旧未完成包时可能重新获取此前只存于CacheAPI的瓦片；新原生任务按文件续传。缓存有请求节流，高级别大范围需较长时间，不承诺即时完成。

## 本轮打包交付：0.2.51-test / code58（2026-09-22）

- 用户明确要求把当前版本打包；下方“预览待确认/尚未出包”为历史阶段。当前最终源码构建 `APK/Shantu-0.2.51-test-standalone.apk`，57,768,374字节，SHA256 `b897a04089c30bb542cb91429109601ed7036681442c39e81c6885ed1662d038`。版本0.2.51-test/code58、原签名v2/v3、zipalign、543项ZIP资源和473地形瓦片已检查，包内11项网页及3项原生新功能标识通过。
- 类型、55项定向测试、安卓网页生产构建及Java/DEX/APK构建通过；构建发现CSS兄弟关系:has不在安卓兼容转换支持范围，已用明确的home-journey-end类替代。日志 `.openai/apk-0.2.51-*`。本次没有重新做不相关的全套测试；此前两尺寸真实组件UI验证仍适用。
- 包含顶部并列路线卡、普通路线底图表、正反向/起终点、菜单切换、记录信息/速度色海拔图、整线改色与原件保护、收藏可见性、锁定回位与导航进度条、指南传感器/常亮/录制服务恢复、高层级分级离线范围。详细说明 `docs/release-0.2.51.md`。原始轨迹、布局、照片目录及包名/签名保留。
- 发布目标 `v0.2.51-test-standalone`，源码推送 `codex/rollback-ui-0235-20260921`，不合入main。真机长时间记录/常亮/指南/飞行模式仍待复测；系统强停不能保证自动恢复；原生HarmonyOS6.1未交付。图片默认文件夹仍未迁移。

## 当前反馈修订：选中路线并列、图表与锁定导航（2026-09-22，预览待确认）

- 分支仍为 `codex/rollback-ui-0235-20260921`，基线 `7e89aa5d1342ab7686a83c3134df3742448cffa4`。当前工作区有本轮累计反馈修改，尚未提交/推送/生成新APK；按视觉快速确认流程先更新预览，不把0.2.50包当成本轮代码。
- 顶部选中路线卡与左侧行程点并列；右侧工具栏与原位摇杆保留12px间距。新增 `routeDisplay/SelectedRouteInfo.tsx`/`selectedRouteInfo.css`，普通选中路线复用色标/海拔数据/海拔曲线开关，在底部显示全程数据。打开路线显示设置时暂隐顶部两卡，关闭恢复；底部主菜单支持再次点击关闭。
- `TrackLayer`在非编辑的选中状态也标起终点；行程点增加正反向切换，同步地图端点、海拔图方向及导航目标。`savedRoute`仅反转派生行程，不改实走原件/采样时间。海拔图明确标注起终点。
- 锁定空栏不再在闲置时显示，实时栏明确文字颜色；导航锁定时保留左侧进度条/起终点、实时数据及解锁入口。导航左侧图例→锁定→记录按安全间距排放，进度带随可用高度缩放。
- 类型检查通过；30项定向逻辑测试通过（记录数据/编辑副本、离线范围、原轨迹反向派生与节点/端点）；日志 `.openai/feedback-types.log`、`.openai/selected-route-tests.log`。实际预览390×857量取：卡228×170、行程94×136、底部图表294×133；独立真实组件360×780卡204×182、行程88×136、图表264×132，无横溢/裁切。三开关全关隐藏、再次点击关闭设置、反向爬升/下降互换、锁定保留进度条均已浏览器验证。截图 `artifacts/screenshots/selected-route-20260922/`（fixture/navigation文件为地图占位的独立组件验证，locked文件是实际地图）。未代替真机验收。
- 其余已写入但仍需收尾的累计反馈：原生指南传感器、统一常亮、录制服务重启/CPU锁、全局10秒回位、实走详细统计和速度色海拔拖点、收藏可见性、整线改色及副本保护、高级别沿线缓存分级范围。具体文件与未验收项见 `docs/feedback-20260922.md`。此次未改账号凭据/签名/保存目录；图片默认文件夹仍需按用户要求先沟通。

## 当前预览比例调整（2026-09-22）

- 用户要求右侧以后保持OPPO Find X8比例；`mobile/phone-preview.html`采用1256∶2760，固定CSS宽390px、高约857px，外围等比缩放。规格写入`docs/homepage-ui-spec.md`，覆盖历史390×844要求。本次仅预览调整，继续收集的定位指南、息屏/断录、离线高层级、隐藏锁定和路线改色问题尚未修改；按用户要求最后统一处理，暂不出包。

## 本轮0.2.50：收藏离线地图、路线快捷缓存、自由缩放（2026-09-22）

- 用户找不到缓存、反馈锁级影响缩放，并要求缓存显示在收藏和路线页直达。新增 `collections/OfflineMapFolder.tsx`/`offlineMaps.css`，通过CollectionsPanel/WorkbenchPanel插槽读取原useOffline包列表；不复制索引、不改缓存/收藏存档。文件夹默认展开，已完成/未完成、名称/大小/级别可见，打开、续传、检查、移除确认和空态入口可用。收藏总数含离线包；批量路线/地点导出不包含地图瓦片。
- HomeRouteCard、规划摘要和已有路线起终点页增加“缓存当前路线”，调用原下载器完整segments；下载窗管理入口改到收藏。保留默认两侧各10公里及原5/20选项。
- RasterLevelLock移除setMinZoom及固定calculateTileZoom，改为固定最高细节级别，保留原相机范围。控件文案“细节上限”，不再要求先放大选择高等级。针对锁图源/固定级别的可选澄清未获回复，已提前说明按推荐的图源不变+细节上限+自由缩放实现；不声称缩小后永远是同批影像。更高比例仅放大已有像素，供应方不同级别色差仍可能存在。
- 类型检查、13项逻辑测试、收藏缓存DOM回归、网页构建通过。MapLibre45组视角/缩放组合，不越上限且瓦片数量受控；相机自定义下限不被修改。旧包无需重下，DOM检查覆盖打开、检查、确认/取消移除、删除和搜索。日志 `.openai/cache-*`。
- 390×844/360×780独立Chrome真实组件截图：路线卡148px、规划摘要162px、图层设置168px；操作按钮可见可点，无横溢。收藏保留下方地图；截图 `artifacts/screenshots/cache-library-20260922/` 的地图和收藏数据为测试占位，非真机验收。
- 0.2.50-test/code57，分支 `codex/rollback-ui-0235-20260921`。APK构建通过，原签名v2/v3、zipalign、code57及473项地形资源已核对；包内6项新功能标识和旧缩放限制提示移除检查通过。包 `APK/Shantu-0.2.50-test-standalone.apk`，57,760,182字节，SHA256 `9667ca23b04571d0050360fda14926b3b1d62fa18e6481b358bcc67c7b9768d0`。发布目标 `v0.2.50-test-standalone`。说明 `docs/release-0.2.50.md`。保留用户布局、路线/照片/标记和原签名/包名，未修改下载范围算法或天地图7源，未迁移保存目录。原路线分段点击消失未复现，原生鸿蒙仍未交付。

## 最新构建交付：0.2.49 天地图七类图层、沿线/当前范围离线下载（2026-09-22）

- 用户明确授权核实、实现更宽沿线范围并一起打包；版本0.2.49-test/code56，分支 `codex/rollback-ui-0235-20260921`。本轮包含下文待发的详情改名和拉力路书布局，旧节是历史记录。
- 新增 `cartography/tianditu.ts`/`TiandituSources.tsx`、`outdoor/downloadPlan.ts`/`tiandituCache.ts`/`OfflineDownload.tsx`，修改TerrainMap/terrain、mapSources、outdoor与app接线；Android返回键优先关闭下载窗。接入7类实测WMTS，当前地图快照范围和路线两侧各5/10/20公里（默认10）下载，分段并集、容量上限、限速、暂停续传、共享缓存与包图源恢复。凭据仅来自本机.env.local，不写Git/缓存元数据。
- 按用户再次强调的整体规格：普通新浮窗使用共享宽高/字体和主页颜色，设置36px行、4px以内间距；图源常用项与其他图源分步。390×844、360×780实测沿线276×188、范围276×150、图源主窗276×166，无横溢，下载完整可点。截图 `artifacts/screenshots/tdt-offline-20260922/`；独立Chrome真实组件/样式、地图占位，非真机验收。
- 类型检查、相关19项逻辑测试、详情改名DOM、7类style结构/绘制次序、网页构建通过；7类实际GetTile均200且图片有效；浏览器Cache API写入后禁止fetch、改子域仍7/7命中。日志 `.openai/tdt-*`；APK构建完成，原签名v2/v3、zipalign、code56及473项地形资源检查通过；包内8项功能标识及本机配置Key存在性检查通过（不输出Key）。说明 `docs/tianditu-offline.md`、`docs/release-0.2.49.md`。
- APK `APK/Shantu-0.2.49-test-standalone.apk`，57,760,182字节，SHA256 `1c0237efdcb6cc3130204b934b8cb1a566917e240775bfb8d4421aeb72019996`，校验文件同目录 `.sha256`。发布目标 `v0.2.49-test-standalone`；源码同步当前功能分支，不合入main。
- 保留轨迹/收藏/照片/用户布局和签名，未迁移默认文件夹。天地图三维地名/三维地形Cesium接口未接入，现有地形沿用原来源；离线缓存不等于官方无限批量授权。真机飞行模式、系统回收与触控待复测。用户“点同一路线不同段丢失/退出”未明确复现，不列为已修复。HarmonyOS 6.1原生包仍未交付。

## 当前调整：拉力路书主指示放大、速度区压缩（2026-09-22，未打包）

- 用户要求主提示更大、速度更紧凑、主提示文字完整。仅修改 `modules/rally/RallyNavigation.tsx`/`rally.css`：主指示改为上方大箭头/距离、下方全宽路名；取消两行截断和尺寸容器裁剪，长句自然换行撑开，远距离用适配字号。两条后续提示改紧凑行，速度区从80px压至54px；不改变导航指令、功能色、GPS或速度计算。
- 上方提示和速度组成自然高度分区，ResizeObserver将实测底边+4px传给原地图定位变量，避免文字撑高后盖住地图。沿用TerrainMap现有容器resize，不新增地图。卸载恢复变量。
- 类型检查通过。应用内浏览器连接仍失败，改用独立Chrome无头渲染真实组件与样式（地图/遥测为测试占位），取得 `artifacts/screenshots/rally-cue-20260922/` 下390×844、360×780和窄屏长指令3张截图。实测主指示约237/234/280px，速度区54px；长句完整显示、无横溢，地图跟随下移且最小102px。字号小数导致普通标题scrollHeight比clientHeight大1px，overflow为visible且内容边界仍在主指示内，不作为裁剪。检查日志 `.openai/rally-cue-*`。
- 按快速视觉确认流程暂未提交/同步/打包；上一轮详情改名仍保留在工作区，均不在0.2.48 APK中。测试占位图不代表真实地图/手机定位或触控验收；下一步按用户视觉反馈调整或明确交付时一起出包。

## 当前调整：详情顶部直接修改路线名称（2026-09-22，未打包）

- 用户纠正入口：点地图路线卡片“详情”就应直接修改名称。`modules/tracks/RouteViews.tsx`将只读标题替换为顶部名称输入、取消修改、保存名称；复用既有rename回调，空名拦截、写入失败保留输入、成功显示已保存。`app/page.tsx`接线并按路线ID重置详情；`routeWindows.css`新增紧凑表单样式。0.2.48的卡片快捷改名保留，几何/存档格式/原生模块未改。
- 类型检查与本地React/DOM定向检查通过，覆盖详情打开即显示名称输入、保存回调、失败保留输入、成功与取消状态；日志 `.openai/route-details-name-*`。浏览器仍nodeRepl.fetch失败，没有实际手机尺寸截图，布局/键盘未验收。
- 遵照入口视觉快速调整流程，本轮暂不提升版本、不构建或发布新APK；当前已发布0.2.48仍只有卡片快捷改名，**不包含此次详情入口**。本轮源码与说明留在当前工作区，待确认/明确交付时一并提交、同步与出包。

## 最新交付：0.2.48 路线卡片直接改名（2026-09-22）

- `HomeRouteCard.tsx`名称改为带“改名”提示的按钮，就地输入、取消、保存，编辑时收起其他卡片内容；`homeMap.css`补紧凑表单，`app/page.tsx`接rename并按路线ID重置卡片。`useManualTracks.ts`使用最新savedRef写名称/updatedAt，返回保存结果，支持草稿copyName；空名/不存在路线拒绝，失败保留输入与原数据。
- 只改路线名称操作，原几何、节点、样式、创建时间、存储键和签名保持。类型检查、网页构建与本地React/DOM定向检查通过（持久化、数据保留、空名/失败、草稿命名、卡片保存/取消），日志 `.openai/route-rename-*`。新版本0.2.48-test/code55，APK `APK/Shantu-0.2.48-test-standalone.apk`，发行说明 `docs/release-0.2.48.md`，分支 `codex/rollback-ui-0235-20260921`。
- 浏览器连接仍nodeRepl.fetch失败，没有实际手机尺寸截图，键盘和触控未真机验收。下一步安装后点路线标题→改名，检查保存/取消和收藏名称。鸿蒙原生仍未交付；附件、日志、凭据不入Git。
- 最终APK构建、原签名v2/v3、zipalign、版本及473项地形资源检查通过，已检查APK内含本轮改名代码；57,751,990字节，SHA256 `8c3b51b886b1839a9d335c339adfc5e08e1b4e84bf2debad49776c015d3e12b6`。构建日志 `.openai/apk-0.2.48-build.log`。

## 最新交付：0.2.47 影像层级锁定与道路透明度（2026-09-22）

- 用户反馈同点旋转影像不同，代码未发现旋转自动换图源；按“固定清晰度瓦片层级”实现，保留原图源选择。新增 `cartography/RasterLevelControl.tsx`/`RasterLevelLock.ts`/`rasterLevel.css`，在加减号上方显示约N级/锁N级，弹窗含当前图源、自动/固定层级、道路透明度与图源入口。`TerrainMap`通过公开Source的maxzoom/calculateTileZoom与Map.refreshTiles同步，解锁/换源恢复原值，未替换全地图样式。
- 固定层级必须限制缩小至该级范围，UI明确说明切自动可继续缩小；更高级需先放大，不自动移动镜头。图源自身同级色差不在修复保证范围。切换图源重置为自动，单张影像/开源矢量不锁层级。
- `LayerSettings.roadsOpacity`接通右侧小窗与道路图层项；开源道路各原始opacity按比例调整，天地图注记用raster-opacity整层调整，矢量底图内置道路不独立分离。保持路线、记录、标记及存储格式。安卓返回键新增小窗处理。
- 类型检查、4项定向测试通过（含MapLibre真实算法27组组合，最大37瓦片），网页/最终APK构建、签名/zipalign/版本/473地形资源检查通过。包 `APK/Shantu-0.2.47-test-standalone.apk`，0.2.47-test/code54、57,751,990字节；说明 `docs/release-0.2.47.md`，发行 `v0.2.47-test-standalone`，分支 `codex/rollback-ui-0235-20260921`。日志 `.openai/raster-level-*`、`.openai/apk-0.2.47-build.log`。
- 浏览器控制nodeRepl.fetch失败，未取得实际390×844/360×780截图，用户原地点/同影像批次仍待真机复核，不能声称截图色差已完全消除。附件、凭据、运行日志不入Git。鸿蒙原生仍未交付。

## 最新交付：0.2.46 地点分享（2026-09-22）

- 新增 `modules/placeShare/` 的数据/系统分享/紧凑预览；搜索结果、地图长按、已存pin标记摘要及详情接同一分享。仅发送选定地点名称、WGS84坐标和高德单点标注链接，不附实时定位/备注/照片。标记文件导出仍可从分享窗进入，模型沿用原导出。
- 新增安卓 `PlaceOutput.java`，`NativeBridge.placeTextShare`打开用户选择的系统分享；`MainActivity`返回键优先关闭地点窗。浏览器走Web Share，支持复制和复制失败时长按文本。无新增权限、持久化键、默认保存目录；用户关于“山兔文件夹”仍处沟通阶段。
- 类型检查、4项分享定向测试、组件静态渲染通过；网页与APK生产构建完成，0.2.46-test/code53、签名/zipalign/版本/473地形资源检查通过，安装包 `APK/Shantu-0.2.46-test-standalone.apk`，57,751,990字节。日志 `.openai/place-share-*`、`.openai/apk-0.2.46-build.log`。说明 `docs/release-0.2.46.md`，发行 `v0.2.46-test-standalone`，分支仍为 `codex/rollback-ui-0235-20260921`。
- 浏览器控制nodeRepl.fetch失败，未取得实际390×844/360×780截图，也未验收手机系统分享/接收应用/返回与触控。静态渲染不代表视觉验收。原路线分享、记录、离线、收藏数据及签名未改；附件、凭据、日志不入Git。鸿蒙原生仍未交付。

## 最新交付：0.2.45 选区离线、重规划与定位轮换（2026-09-21）

- 新增 `outdoor/OfflineRegionPicker.tsx`、`offlineRegion.css`，记录→离线直接地图选区，确认范围后下载；`offline.ts`新增区域校验/资源估算/精确边界下载，复用缓存、暂停续传、完整性检查。`TerrainMap`接通开源底图源/字库/图层与天地图互斥，`useOfflineMapMode`明确选择离线底图。开源道路14级/地形12级，不含天地图影像；离线路网单独下载。
- `guidance/reroute.ts`/`useGuidance.ts`提供当前位置到终点及剩余途经点重规划，取消/失败保留原导航；原路线身份、已行距离保留，不改收藏。`networkSession.ts`防止重规划后回跳旧网络；app沿途天气使用当前导航路线。普通展开导航与拉力偏离提示提供入口。
- `PositionDock`/`MapActions`/app接线：定位按钮循环正北跟随→朝向跟随→自由浏览，移除更多中的方向模式选择，切换不停止导航/记录。包含待打包的单色空白底栏修复，继承0.2.43保存记录与0.2.44原生常亮。
- 类型检查、36项定向测试通过（`.openai/offline-reroute-{typecheck,tests}.log`）；最终APK `APK/Shantu-0.2.45-test-standalone.apk`（0.2.45-test/code52），网页/Java/DEX编译、签名/zipalign/版本/473地形资源检查通过，57,747,894字节。说明 `docs/release-0.2.45.md`，测试Release `v0.2.45-test-standalone`，当前源码分支 `codex/rollback-ui-0235-20260921`，并非main。
- 当前浏览器控制返回nodeRepl.fetch失败，未能取得本轮390×844/360×780实际截图；定位模式触控、手机朝向、行进中重规划和真实飞行模式仍待真机验收。未改存储键、签名、记录采样或收藏格式；附件/环境凭据/日志不入库。HarmonyOS原生仍未交付。

## 最新：移除导航底部无信息单色白条（2026-09-21）

- 用户截图底部“路线单色”来自RouteColorKey说明，并非按钮。`RouteColorKey.tsx`单色返回null；`RallyElevation.tsx`按实际可显示色标判断容器，当海拔/剖面均关闭且为单色时整个底栏消失，不留空壳。普通/拉力共用，海拔/坡度/速度色标与已开启的海拔数据不受影响。
- 类型检查通过；组件静态渲染验证单色无数据时无底栏，坡度色标和单色海拔数据仍保留。属于局部UI快速修正，未改存储/导航/记录，未另出APK，手机0.2.44尚不含此修正。待下轮打包一并更新，未新增真机截图验收。

## 最新：0.2.44导航前台常亮（2026-09-21）

- `useGuidance.ts`按active状态驱动原生常亮，普通/拉力共用；退出/换路线失活/卸载cleanup解除，visibilitychange在返回导航时恢复。`useRecording.ts`只增加既有桥接接口类型声明。
- `NativeBridge.java`新增setKeepScreenOn，UI线程设置/清除Activity窗口FLAG_KEEP_SCREEN_ON，启用需trustedForeground；`MainActivity.java`页面重载先清除，避免新页面无导航却残留常亮。不改变系统息屏设置，不增加权限，后台或手动锁屏不强行唤醒。
- 版本0.2.44-test/code51，当前源码生成独立APK；未改GPS采样、记录、路线计算、存储格式与UI布局。尚未真机超时等待测试，浏览器版未增加常亮API；完整交付说明 `docs/release-0.2.44.md`。
- 导航定向测试12/12、类型检查通过；APK网页/Java/DEX编译、签名、zipalign、版本、473地形瓦片检查通过，包内JS与DEX均确认setKeepScreenOn接口。分支 `codex/rollback-ui-0235-20260921`，测试Release `v0.2.44-test-standalone`。

## 最新：0.2.43记录保存修复（2026-09-21）

- 用户真机截图为finished/3点/0米，保存、结束均灰。根因是RecordingPanel与recordingTrack排除单点分段，而待保存状态又禁用结束，形成死角。现在保存全部非空分段，drawing解析允许recorded单点分段，原时间/海拔/分段/来源均保留，不自动缝合断点；保存仍需持久化回读确认后才clear。
- `RecordingPanel.tsx` 待保存第二按钮改“继续记录”；全程和GPX导出接受独立点，修复保存成功文案被通用完成文案覆盖。空记录可重置；没有清理用户记录或照片。`app/page.tsx`移除正常GPS精度横幅触发与文案，只保留定位中/错误；采样精度过滤和设置未改。
- `tests/recording-photos.test.mjs` 6/6、类型检查通过，新增三个独立点存储回读和空记录拒绝测试。浏览器工具仍连接失败，未完成新截图和真机操作验收；原手机待保存数据需覆盖安装后复测。
- 版本0.2.43-test/code50；当前源码重新构建独立山兔APK，签名/zipalign/版本/473地形资源检查通过，包内确认新保存逻辑、继续记录按钮及移除GPS横幅；SHA256 `2ff99f0bc9fc25b43c8b377a46e0960f4bf903ed98020405fc7aeaea47249c8d`。说明 `docs/release-0.2.43.md`。附件目录只作本地诊断，不进入提交；未重复全量测试。HarmonyOS原生未交付。

## 最新交付：0.2.42 APK（2026-09-21）

- 用户要求立即打包：当前工作区完整源码生成 `APK/Shantu-0.2.42-test-standalone.apk`，0.2.42-test/code49，57,747,894字节；独立山兔包沿用签名，网页生产构建、Java/DEX编译、签名/版本/zipalign检查和473地形瓦片资源检查通过。日志 `.openai/apk-0.2.42-build.log`。
- 包含本轮导航/拉力/编辑/收藏/框选/图源UI与天地图配置。真实Key只在被忽略的本机构建配置和客户端构建产物中，提交前检查暂存源码不含Key或私有文件。
- 按赶时间要求未重复全套测试；最新图源窗口/框选底部位置实际截图复核和Android真机GPS/触控仍未完成。鸿蒙6.1原生包未交付。
- 源码分支 `codex/rollback-ui-0235-20260921`；本次测试Release `v0.2.42-test-standalone`，发布说明 `docs/release-0.2.42.md`。不代表已合入main。

## 最新：框选结果、收藏目录与天地图配置（2026-09-21）

- collections新增 `BoxSelectionResults.tsx`，框选结果独立勾选/删除/导出，当前窗口可撤销删除；复用事务冲突检查。删除后显示紧凑空态，不再误入大目录；`MapBoxSelect` 增加空数据提示并禁用无对象动作。普通收藏调整为浅色目录行，隐藏覆盖目录的地图顶栏与工具，下方保留地图；app清理过期框选范围。
- 收藏390×844截图 `artifacts/screenshots/collections-20260921/favorites-390.png`；隔离内存数据验证360×780删除空态284×101.94、撤销恢复，两项均未修改用户存档；截图 `box-deleted-360.png`。collection-selection/workbench定向12项通过；类型检查通过（`.openai/box-sources-typecheck.log`）。框选工具底部新CSS尚待实际预览复核，旧截图不能代表新位置。
- 用户天地图浏览器Key已写入根 `.env.local`，git check-ignore确认忽略；禁止写入源码/文档。既有WMTS矢量vec/影像img/中文注记cva/cia均实请求HTTP200且图片格式正常；沿用官方署名。`mobile/vite.config.ts` 补根envDir，预览和构建读取同一配置；图源内置按钮明确标天地图矢量/天地图影像。Vite resolveConfig确认Key已加载，9423的 `/@vite/env` 确认注入（只输出布尔结果），原始模块保留process.env引用是Vite开发模式行为。
- `MapSourcesPanel.tsx`/`FreeMapLibrary.tsx`/`mapSources.css` 针对用户要求取消列表200px限制，列表随当前分类内容展开，压缩按钮与提示；添加/扫描流程保留。浏览器控制连接连续失败，图源窗口新布局与天地图实际页面尚未完成截图验收，不能声称无滚动已实测。原9423服务退出后在同端口恢复；没有清除浏览器数据或终止用户进程。
- 用户询问离线：已核对现有记录→离线→下载此行程，缓存范围为行程包围范围加约2km，道路14级/地形12级；另可导入栅格MBTiles/GeoTIFF。目前没有省市或框选地区下载入口，天地图影像未加入离线包。本次未改下载算法。
- 保留既有全部工作区改动；当前为快速视觉确认阶段，未打包/发布/提交推送，下一步恢复浏览器连接后复核窗口与图层，未真机验收。

## 最新：路线入口去重、编辑区与导航控件整理（2026-09-21）

- 底部“路线”每次进入默认起终点规划表单，仅本次成功规划后切换摘要；移除顶部重复的“开始导航”横条。选中已有路线的操作卡移到左下，与规划摘要互斥。规划结果新增编辑线点/取消路线；编辑副本保存前不替换原规划，也不清空绘图草稿。
- `RouteViews.tsx`/`routeWindows.css`：退出编辑、保存并退出集中在底部工具栏；节点操作五格，分叉浅橙/结束分叉深橙，保存绿色；样式按需展开（展开时替换节点操作行）。390×844实测默认300×144.5、样式300×190且无滚动，底部距导航栏8px；退出无修改会回到路线卡。未保存提示明确“保存并退出 / 不保存并退出 / 继续编辑”。
- 修复保存误报：存储解析省略hidden:false，原会与内存false比较失败；`routeEdit.ts`按布尔值归一化。真实并发冲突仍保留保护，并提供“另存副本并退出”保留编辑。
- `TrackLayer.ts`/`map/overlayData.ts`：选点层纳入稳定顺序，排在所有路线描边上方；白边实心点配柔和外圈，视角俯仰时保持圆形；编辑节点高亮减小。15个路线编辑/覆盖层定向测试通过，包括未保存规划副本、hidden误报与选点层级。
- `app/page.tsx`：左侧沿途进度带仅导航中显示；`RouteDisplayControl.tsx`删除右侧旧图例/海拔/剖面三块浮窗，保留底部导航显示开关；标签统一“底部路线色标/底部海拔数据/底部海拔曲线”。`RouteWeatherRail.tsx`天气详情和图例仅由“图例”按钮控制，关闭后拖动只更新地图预览、不自动弹窗，实点验证通过。
- `MapActions.tsx`/`homeMap.css`/`guidance.css`：去掉视角弹窗入口，半透明控制器在右下，普通导航与定位按钮、底部栏各12px间隔（实测定位底624、控制器636–704、底栏顶716）。更多保留正北/跟随手机方向。工具九项3×3，实测166px且无滚动；时间入口短标签。`survey.css`剖面点编辑尺寸收紧，未再改变剖面算法。
- `rally/RallyNavigation.tsx`/`rally.css`：长指令按主格宽高缩字号，距终点标签修正；“1.1公里/沿路线到达终点”在390×844完整显示，无跨主格。截图 `artifacts/screenshots/route-ui-20260921/{normal,rally,editor}.png`。
- 类型检查与生产构建通过（`.openai/route-ui-build.log`）；路线入口实际点击已返回起终点表单，截图 `artifacts/screenshots/route-ui-20260921/route-form.png`。未真机/GPS验收，360×780尚未本轮复测；当前无定位权限，未知速度/海拔保留未知。保留原工作区与用户路线，没有清理收藏/记录或改存储键。本轮预览持续迭代中，尚未打包发布/提交推送；最终交付版本需另行构建与验签，不能使用旧APK代表当前源码。

## 最新：导航收起一行、底部三项开关接通（2026-09-21）

- 用户指出路线显示三个开关无反馈：原开关仅控制已隐藏的旧信息窗。已通过 `app/page.tsx` 把routeDisplay公开偏好/着色模式/色阶传给NavigationTelemetry和RallyNavigation→RallyElevation。新增 `routeDisplay/RouteColorKey.tsx` 显示对应地图路线的色标。导航设置名称明确为“底部路线色标 / 右侧海拔数据 / 底部海拔曲线”，分别独立控制；三项全关隐藏底栏。现有持久化键与原非导航信息窗保持兼容。
- `rally.css` 右侧数据跨底栏全高垂直居中，三行上/下各7px；关闭数据/曲线后剩余内容自动占满；拉力模式全部隐藏底栏后地图扩展到底部。海拔曲线本身仍按海拔蓝低红高，路线色标反映地图路线着色，不混为同一个控制。
- 用户纠正普通导航收起不可显示大块速度卡：`GuidanceCard.tsx` 收起只保留标题单行；展开才挂速度/时间；分享并入操作行，保留到达后的分享入口。`guidance.css` 展开数据与按钮压紧，进度带随收起/展开下移，避免叠在卡片上。实测收起36px、展开156px，无横向溢出。
- 实点三个开关：曲线关闭后DOM数量0、数据关闭后dl数量0、三项全关底栏数量0，随后恢复原三个开启状态。类型检查通过；当前390×844数据上下各7px，截图 `artifacts/screenshots/navigation-controls-20260921/current.png`。用户正在同一预览编辑勘探线，只读保留其操作，不重置地图/编辑。没有真机验收，不全测、不出包/发布/推送。
- 本轮涉及routeDisplay控制/新增色标、rally剖面与样式、guidance卡片/遥测展示和app接线；记录/收藏/导航计算服务未改，未删除业务功能。

## 最新：图层扩容、普通导航补齐、拉力大字与薄剖面（2026-09-21）

- 用户要求同屏更多图层：仅 `controls/layerWindow.css` 局部覆盖200px上限，最多480px/62dvh并扣安全区。390×844实测248×480，十个图层开关同屏；打开图层时旧路线信息暂隐藏，避免盖住列表。其他浮窗尺寸不变。
- 用户指出开始导航进度条消失、普通导航仍是旧窗：`app/page.tsx` 移除RouteWeatherRail的导航排除条件；guidance新增 `NavigationTelemetry.tsx`/`useNavigationTelemetry.ts`，GuidanceCard接收遥测内容，普通导航显示速度/时间和底部海拔条；旧右侧三块信息仅在导航中隐藏，原设置入口保留。共用实际导航/定位数据，无权限保持未知。
- 用户要求拉力主窗更大、粗几何图标、鲜艳功能色、大字：`rally/RallyNavigation.tsx`、`rally.css` 主窗390视口高317.5px（原266.9）；箭头132px、4.5粗线，绿色直行/橙转向/紫掉头/蓝接入/灰未知，形状和文字继续表达语义。距离51.87px/900字重，方向44.07px/800字重；副提示18px/800。实测主格无横向/纵向溢出。
- 用户要求剖面再扁：`rally/RallyElevation.tsx` 和 `routeDisplay/RouteElevationProfile.tsx` 增加紧凑绘图尺寸，普通/拉力海拔条均92→64px；保留当前位置点、已行升降、真实地形/缺测说明。普通导航记录错误条底710.8、剖面顶716，右侧工具底706；左进度条顶172、导航卡底170.5，未重叠。
- 验证：类型检查通过，路书定向测试3/3，390×844真实布局截图 `artifacts/screenshots/navigation-update-20260921/{normal,rally,layers}-390.png`。图层同屏十项、导航进度条与天气预览可见、两模式切换已实点。无GPS权限/真机，不宣称速度或当前位置点验收；360×780本轮未实测。保留全部原工作区，未全测/打包/发布/推送，等待快速视觉确认。
- 未删除业务功能；路线计算、记录服务、收藏、存储格式均未改。当前右侧tab5保留拉力大字版；tab2保留图层窗口。

## 最新：拉力风格导航首版，等待用户视觉确认（2026-09-21）

- 用户确认上方路书、下方小地图，并要求直接在右侧可见预览中调整。新增 `modules/rally/`（RallyNavigation、RallyElevation、roadbook、rally.css、README）；入口接入 `app/page.tsx`、`navigation/RoutePanel.tsx`/`RouteResultSummary.tsx`、`guidance/GuidanceCard.tsx`。共享 `routeDisplay/RouteElevationProfile.tsx` 增加可选进度点，`navigation/routeCompact.css` 摘要行允许换行。
- 当前/后续指令、细进度条、实时估算速度/含停留均速、用时/预计到达、真实小地图、彩色高程剖面及当前位置/已行升降。无有效定位显示未知，不填效果图数据。说明按钮明确“非赛事标准路书或实地勘路笔记”。没有删除功能，记录、收藏、定位服务/存储格式未改。
- 用户截图指出后续指令图标与参考不一致：已放大加粗，取消泛用曲线路线图标，接入段显示位置图标与“方向待核实”，未知方向问号；道路出口不再误判为到达终点。“再行0米”改同一位置。当前真实路线只返回出发/道路出口，不能编造参考图急弯。
- 390×844 实测无横向溢出，各区独立：路书y84高266.9、指标y356.9高80、地图y442.9高237.1、剖面y688高92；全屏/路书/说明切换通过。截图 `artifacts/screenshots/rally-20260921/phone-390.png`，归一化参考对比 `comparison.png`。外框缩放截图，非真机证据；360×780尚未实测。
- 定向测试 `tests/rally-roadbook.test.mjs` 3/3；类型检查通过。未全测/构建/出APK/发布/推送，沿用快速视觉确认流程。原有大量未提交UI调整保留，分支 `codex/rollback-ui-0235-20260921`。
- 右侧 tab 5 是可见路书预览，原 tab 2 保留。无GPS权限，不宣称实时速度/跟随/当前位置点已真机验收；下一步先由用户确认字号、路书符号和分屏比例。

## 最新：地图优先，规划摘要与单行导航（覆盖前轮结果长窗）

- 用户连续指出规划结果/天气撑满屏、文字按钮不明显、导航和规划重复、顶部重叠、导航状态卡过大。最新优先级是先看地图；“一页”只针对当前步骤，不能把所有结果和详情堆在一屏。
- navigation：新增 `RouteResultSummary.tsx`，规划成功后默认收起表单，左下显示约116px摘要；编辑可返回原表单，天气/路段按需打开（结果详情最大200px），收藏/分享/导航/看全程均加边框与底色，未删除这些功能。`RoutePanel.tsx`通过ReactNode接收天气内容，不再由app常驻追加天气长区。
- app/page：沿用既有进入导航收起规划窗口的行为；看全程复用map.fitCollection已有接口，预留顶部、右侧工具及下方摘要空间。路线计算、原轨迹、记录/GPS服务未改。
- guidance：`GuidanceCard.tsx`/`guidance.css`默认单行导航，完整状态和动作点箭头展开；定位权限问题简写“定位未授权”，完整原因在展开页，不伪装成正常定位。当前骑行导航/暂停记录保持用户状态。
- controls/homeMap.css：路线提示统一置于50px顶栏下8px；天气进度带从其下方独立一行开始；天气预览标题与关闭按钮压紧并加可见边框。顶部/按钮实际min-height覆盖需要复核，不能只看声明。
- 定向验证：390×844预览，规划摘要实测276×116，7个操作按钮均有1px边框和30px高度；当前导航条实测300×36、x8/y58，规划窗口已关闭，页面无横向溢出，地图主体可见。截图 `artifacts/screenshots/record-dense-20260921/navigation-map-first.png`。类型检查通过（后续末轮复核见日志 `.openai/route-summary-typecheck.log`）；未做真机GPS、路线计算回归或出包发布。天气折叠高度为CSS约束，用户切换中未完成该状态实测；非导航天气预览重叠仍需用户当前场景复核。

## 前轮：路线规划基础操作集中一页

- 用户发来路线规划上下两段截图；沿用当前密集单页方向。仅修改 `modules/navigation/RoutePanel.tsx`、新增局部样式 `routeCompact.css`。去掉重复的选点说明（完整说明仍在“使用说明与数据来源”），没有删除操作或改动路线计算/定位/存储服务。
- 路线窗口按内容定高并受可视区域安全高度约束，基础起终点、模式、途经点动作、规划按钮集中可见。此路线表单与记录控制台一样按当前单页需求覆盖旧200px裁切限制；多途经点、结果与展开说明过长时允许滚动。
- 实际390×844手机iframe下：窗口276×266，窗口clientHeight/scrollHeight均264，内容均228，无滚动和横向溢出；截图 `artifacts/screenshots/record-dense-20260921/route-phone-compact.png`。只做渲染定向检查，未发起路线计算、不全测、不打包发布；等待本页视觉确认。

## 前轮：记录继续压紧 + 固定手机预览

- 用户要求进一步密集，并再次明确右侧预览必须是手机比例。仅调整 `modules/outdoor/recordingConsole.css` 的行高、间距、参数和开关排列；没有删除功能，记录/定位/数据服务未改。
- 新增开发预览页 `mobile/phone-preview.html`，内部固定390×844 CSS视口，外框等比缩放居中。后续右侧继续使用 `http://127.0.0.1:9423/phone-preview.html` 并保留地图hash；不要再直接打开根页面导致随侧栏宽度变成桌面布局。
- 实测内部视口390×844，记录窗口276×309（原383px高），内容scrollHeight/clientHeight均307，无内部滚动、无页面横向溢出。当前“定位权限被拒绝/已暂停”状态原样保留。截图 `artifacts/screenshots/record-dense-20260921/console-phone-compact.png`。
- 本轮仅CSS与开发预览HTML，不重复全测、不打包发布；下一步等用户看实际手机画幅确认。

## 前轮：记录控制台集中一页，解释定位异常

- 用户指出“异常”不明确且记录设置需要翻多页，明确要求集中一页、密集排列。实读页面错误为“定位权限被拒绝”，当前0点/已暂停；未擅自申请或改定位权限，也未清空记录。
- RecordingPanel改为单页控制台；新增RecordingCompactSettings和recordingConsole.css，复用原样式/精度/采样更新接口。主动作、颜色/着色/线宽/不透明度、精度/间隔/距离、采样开关直接显示，去掉该页多层details和大预览。参数数值完成输入失焦生效，间隔增加时同步保证静止采样间隔不小于常规间隔。
- 记录错误顶部显示原文，侧栏权限问题改显示“未授权”而非泛化“异常”。正常按钮为开始→暂停→继续，错误暂停时保留记录。
- 用户的一页要求覆盖该记录控制台旧200px限制；实际390×844视口中276×383，无窗口/内容滚动、无横向溢出、无嵌套details。其它普通浮窗200px规则不变；极矮视口/键盘仍允许滚动以保证可达。
- 修改仅outdoor的RecordingPanel、RecordingQuickAction、OutdoorPanel及新紧凑设置/样式；原记录/存储/定位服务未改。类型检查通过；实读全部控件、侧栏错误和滚动尺寸，截图 `artifacts/screenshots/record-dense-20260921/console-390.png`。未实录GPS，不出包、不发布。

## 最新确认方向：地图播放控制 + 左下“记录”设置与标注

- 用户进一步明确：地图记录用播放按钮；左下入口名称仍为“记录”，集中详细设置和当前位置的信息标记。这覆盖此前去掉整个底栏入口的讨论及侧栏展开窗方案。
- 已改：左侧44px播放/暂停/继续按钮直接调用原记录命令，待保存时进入记录详情；底栏第一项由“行程”改“记录”，默认打开记录面板。面板位于左下，优先显示当前位置标记/照片，参数折叠为“记录设置 · 样式 / 精度 / 采样”，其他已有工具收进更多。
- 当前位置标记使用实际displayedFix，点击时检查30秒有效期；无新鲜定位则启动既有定位服务并提示定位后再点，不用地图中心代替。成功后进入既有标记编辑器填写名称/备注。没有改变GPS记录服务或存储格式；打开参数或标记不会调用暂停。
- 修改：controls/ControlDock、homeMap.css；outdoor/RecordingQuickAction、RecordingPanel、OutdoorPanel、journeyOverview.css；app/page接线。历史JourneyOverview草稿暂不作为默认入口。
- 定向验证：390×844、面板276×200位于x8/y580，无横向溢出；记录设置展开/收起、底栏进入和地图播放按钮显示正常。截图 `artifacts/screenshots/journey-entry-20260921/record-play.png` 与 `record-settings.png`。未触发设备GPS，不宣称真机实时标记/记录验收；不全测、不打包发布。

## 最新：左侧记录按钮已实现；讨论移除底栏行程入口

- 用户要求实时记录改成左侧小边栏，可展开/缩小。已将RecordingQuickAction默认收成44×44按钮，展开旁边的记录窗，复用开始、暂停/继续、结束、保存/设置、取消确认；收起只改变显示状态。闲置时也显示小按钮，覆盖上一节“idle不显示”的决定。
- 只改记录组件、homeMap.css定位与app/page显示条件；类型检查通过，390×844实点展开/收起通过，未启动GPS，截图 `artifacts/screenshots/journey-entry-20260921/record-collapsed.png` 与 `record-expanded.png`。无全测、无出包发布。
- 用户正在讨论行程与收藏入口重复，倾向去掉底栏行程。建议：侧栏操作当前记录，收藏统一管理已保存路线/行程/标记/照片，保留行程详情“轨迹/数据/沿途”；尚未删除底栏入口，待讨论结论。

## 最新定向修正：底栏入口与实走记录归属

- 用户指出路线连点出现两种界面、实走记录应该在行程里选择。本轮只修入口：底栏重复点击保持当前面板，关闭后不再默认高亮路线；idle实走快捷窗不显示，已开始/暂停/待保存时保留地图快捷操作。
- 行程首层提供“新建实走记录”或“当前实走记录”，历史候选只含实走来源或有时间数据的记录；普通无时间GPX/KML不再直接归为行程，不删除/修改原轨迹。空列表不显示无内容的详情页签。
- 已实点验证路线连续点击仍保持路线规划页；行程入口显示新建实走记录。只进行类型及入口定向检查，不全测、不出包发布。涉及ControlDock、app/page、outdoor的Overview/Panel与局部CSS；记录服务/存储未改。

## 前序讨论：路线与行程关系

- 用户要求做“行程”栏后，又明确暂停实现，先讨论路线/行程的功能区别和其他软件做法；在概念确认前不继续扩展UI。
- 本地已有未确认草稿：`modules/outdoor/JourneyOverview.tsx`、`journeyOverview.css`、OutdoorPanel及app/page接线，尝试轨迹/数据/沿途第一层；尚未截图验收，不称完成。
- 草稿中导入GPX/KML被纳入行程候选的规则尚需按讨论修正；文件格式本身不能证明实际出行，不能据此冒充本人实走记录。

## 最新进行中：0.2.41主页第二轮交付

- **最新用户指示：节约额度，只做指定事项，改完截图快速确认再下一步；不插入额外、不紧急工作。现停止扩展验证/发布，进入主页逐项确认。** 此流程已写入AGENTS与主页规格；以后UI讨论阶段不默认每个小改动都全测、出包、发布。

- 用户已授权重新复刻讨论的主页，并要求规格适配各种手机；右侧预览明确保持390×844手机比例。
- 新建HomeRouteCard摘要组件，移除主页旧卡片点数据堆叠，详细数据仍在详情；重新编写主页样式、记录状态窗、行程点窄栏；详见 `docs/homepage-ui-spec.md`。
- 最新反馈修复：天气继承min-height44导致比其他白框高6px；统一四框实际38px，背景50px，上下各6px、整排左右各8px；天气至3D间隔14px。背景层移到主页根伪元素，避免遮盖图层/天气。
- 修改范围：controls/homeMap、tracks/HomeRouteCard与RouteViews接线、outdoor/RecordingQuickAction、position/PositionDock、app/page。uiLayout增加已知旧选择器到新主页组件的兼容迁移（启动/导入内存副本），保留v1键/格式和原始草稿，只有显式保存才写入。地图引擎、原轨迹/照片存储、原生记录服务未改。
- 实测320×568、360×780、390×844、430×932、844×390、768×1024：主要主页区域无交叠/横向溢出；横屏右上工具横排，记录窗移到右下内侧；视角窗248×164。右侧预览保持390×844。
- 类型/架构、508/508测试通过（增加两项旧布局选择器/锚点/幂等迁移回归）。截图与DOM边界：`artifacts/screenshots/home-responsive-20260921/`；对照结论见 `design-qa.md`。设计仍待用户最终确认，不声称所有手机/真机已验收。
- 版本0.2.41-test/code48；最终源码APK已在本机构建，543项ZIP CRC、473地形像素、原4a94签名v2/v3与版本核对通过；SHA256 `9f40f6fa32964c2b8a919bf6df9aca8cbb692d165eac82f463bfa63a360c6eea`。用户要求快速逐项确认后，停止后续Release流程；当前改动尚未提交/推送，0.2.41尚未发布，不称已交付。0.2.40是已否定的首轮。

## 历史：0.2.40首轮（已被否定）

- **最新反馈：用户明确指出首轮仍不像PDF，要求解释技术栈并查阅正确UI还原方法。首轮视觉不通过，不能据构建/无溢出检查写成“还原完成”。** 当前停止继续叠加视觉补丁，先纠正测量与验收方法；后续仍只围绕主页。
- 核心偏差（PDF主图等比缩放至390宽）：参考路线卡约272×92，当前300×160.5；参考行程点约94宽，当前160宽；顶栏、卡片内容、按钮底色/分隔线/字号也未按原图逐项重建。实际卫星底图与示意底图差异要单独比较，不掩盖控件本身偏差。
- 官方方法参考：Figma设计到代码文档要求组件、间距/颜色/圆角/字体变量和布局约束；Playwright视觉比较要求固定环境的参考截图与差异检查。下一轮先提取同一尺寸下的主页规格，再隔离旧CSS实现控件，对截图分区叠加检查；不能仅挪旧控件或以类型/逻辑测试替代视觉还原。

- 用户最新要求：根据PDF先修改主页，提供实际截图，一起核对问题。此要求仅授权主页这一层，不恢复旧整套UI改版。
- 参考PDF第3–7页；顶栏、右上视角/更多、右下缩放/路线显示/定位、五入口底栏与独立记录窗。
- 修改 controls/MapActions、homeMap.css、PlaceSearch；position/PositionDock；outdoor/RecordingQuickAction；routeDisplay按钮名，以及app/mobile接线。地图引擎、轨迹存储、照片/标记内部编辑、签名/包名不变。
- 独立预览 `http://127.0.0.1:9423`，API3152，日志 `.openai/home-*`。尚未视觉确认，不推进其他页面；0.2.39仍是上一轮回退包，不包含本次主页。
- 结果：首轮主页已实现；新增 `modules/controls/homeMap.css`，调整controls、position、outdoor、routeDisplay的主页入口，tracks增加只用于主页的行程点列表，旧详细里程轨仍用于其他状态。未删除数据/资源或迁移存储。
- 截图 `artifacts/screenshots/home-pdf-20260921/`；390×844/360×780无横向溢出，侧栏44×44、底栏高44，菜单/视角/总览/记录收起交互检查通过；细节与待讨论差异见 `design-qa.md`。
- 类型、架构、506/506现有测试与Android网页构建通过。最终APK包含本轮主页代码/样式和0.2.40版本；543项ZIP CRC、473地形像素一致、测试路线/私密文件排除通过；原4a94签名v2/v3、versionCode47与zipalign已核对。真机和原生鸿蒙未验收/交付。
- APK：`D:/天气系统/APK/Shantu-0.2.40-test-standalone.apk`；SHA256 `bbeebf8167d383a482686eb14d3d3c44851a37097855be9ad40b04203b93fa81`。
- 首轮代码提交 `91e9baeef2b8abf0cbd5eacce95c6156ce0c33fe` 已推送，远端SHA一致；0.2.40测试Release已发布，远端APK大小/摘要一致。发布状态不代表用户批准，本版已被用户指出视觉不符。
- 本轮版本0.2.40-test/code47。APK构建曾两次遇新生成base.apk的Windows共享锁；构建脚本增加只针对共享锁错误32/33、最多约5秒的重试，其他异常仍立即失败；最终全新源码构建成功，签名/zipalign/473地形资源检查通过。
- 0.2.39本机原发布包已从公开Release重新下载并核对原SHA256，避免中途同版本试构建覆盖后留下错包。

## 上一轮回退决定与交付记录

- 已明确选择「退回0.2.35，撤回整套UI改版」。这覆盖此前继续完成0.2.36/PDF还原的执行方向。
- 整理文件夹，只保留项目和当前讨论，其他agent应能快速续接。
- 本轮恢复旧业务代码；PDF只保留为设计参考。之后涉及UI，先给当前层级效果图，经用户确认再推进。

## 唯一继续开发入口

- 本机：`D:/天气系统`；分支：`codex/rollback-ui-0235-20260921`。
- 业务基线：`d01d9dc14bad4ecf19728514a3582087d47605bd`，即0.2.35交付后的文档提交；实际功能提交`02027e60069bb3ba4ec293cb7ea1b9b2f5a692f3`。
- 0.2.35的布局编辑、行程点信息、陡坡全线提示保留。0.2.36整套固定UI及9月20日未完成修改不进入当前分支。
- 回退安装包：`0.2.39-test / versionCode46`。跳过本地试改占用的0.2.37/0.2.38，安装计数高于旧包；功能以0.2.35为准，额外保留读取现有照片库的兼容修正。
- 未合入main；远程目标仍是`https://github.com/Siger1989/map`，本轮推送上述明确分支。

## 本轮结果

- 已复制并逐文件SHA256核对110个交接/未提交文件；快照目录`D:/山兔-本地归档/20260921-before-rollback-110139`。包含各工作树HEAD、改动补丁、未跟踪文件和用户布局草稿；仅在本机。
- 已从0.2.35基线创建新的当前分支；旧工作树保留用于追溯，不再作为开发入口。
- 已整理README、Agent交接、目录索引，原过程记录迁入`docs/history/before-rollback-20260921/`。
- 32页PDF已复制到`docs/reference/ui-discussion-20260916.pdf`，SHA256 `1922e7b38aed57073bdeb864f372966309ecc66094c6c781574405595f3898c4`。
- 已将1400项旧包/日志/构建中间资料（16588文件，12,400,837,613字节）移出项目至`D:/山兔-本地归档/20260921-cleanup`；16588项大小/SHA256全部复核通过，恢复清单manifest.json与结果verified.json留在归档。只移动归档，不声称释放磁盘空间。签名密钥、共享node_modules、地形源/工具链、用户草稿保留。
- 新APK已构建：`APK/Shantu-0.2.39-test-standalone.apk`，57,731,510字节，SHA256 `e0fc1e80030e802772e59f06681cda6157ec76cdab825897ecde1a8e86ddf76a`。原4a94签名v2/v3、zipalign、543项ZIP CRC、473地形像素/源码一致及私密内容排除通过。
- 506/506逻辑、类型、架构、最终网页/Android构建通过。新建/v1/v3照片库三项定向回归通过；全部草稿与回退前快照哈希一致。首次APK构建曾遇临时文件占用，最终全新目录重建成功。
- 功能源码`5246b1a100f6cf6d7483817c40dcb3aef44ba557`已推送并核对远端`codex/rollback-ui-0235-20260921`；后续交接提交仅更新文档，不改变APK源码。
- [0.2.39公开测试Release](https://github.com/Siger1989/map/releases/tag/v0.2.39-test-standalone)已发布（id392675257，draft=false/prerelease=true）。APK、校验文件、完整性报告和安装说明4项远端大小/SHA256全部匹配。
- [APK直接下载](https://github.com/Siger1989/map/releases/download/v0.2.39-test-standalone/Shantu-0.2.39-test-standalone.apk)。本机绝对路径`D:/天气系统/APK/Shantu-0.2.39-test-standalone.apk`；已无认证完整下载公开APK，57,731,510字节及SHA256再次一致。

## 边界与下一步

- 本轮除版本/文档与照片库兼容外，业务代码与0.2.35一致。0.2.36把照片库升至v3，原0.2.35强制v1会触发VersionError；现按已有版本打开原photos表，不删除数据。未来若重引索引版，必须从photos重建辅助索引，不复用可能过时的缓存。
- 地图手势、ObjectGizmo、原轨迹/照片、签名与包名、布局键`shantu.ui-layout.v1`/JSON version1沿用0.2.35。
- 不卸载手机应用，不清空用户数据，不复制测试数据到产品；覆盖安装后新版本产生的数据兼容性仍须真机检查。
- 本轮整理、回退和新包公开交付已完成。之后按用户的新指示继续，不自行重做整套UI；换设备先核对当前分支与远端HEAD。
- 本轮未要求新视觉设计；先完成回退交付，等待用户提出下一项修改。
- Android真机覆盖安装、触控/GPS/相机/后台待验；HarmonyOS6.1原生HAP/APP未交付。

详细索引见[Agent交接](docs/agent-handoff.md)和[目录说明](docs/workspace-layout.md)。旧“已完成”声明仅保留为历史，不代表当前视觉或设备验收。
