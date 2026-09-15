# 当前状态 — 2026-09-15 / 0.2.36 已公开发布

- **交付完成**：[v0.2.36-test-standalone](https://github.com/Siger1989/map/releases/tag/v0.2.36-test-standalone)，Release id389132752，draft=false/prerelease=true。4项资产大小与SHA256均核对；使用公开直接链接无认证完整下载APK后再次比对通过。功能源码8613b45e14c707ac36ef050add88b559fc10189d已推送并核对origin/codex/ui-confirmed-20260915，未合入main；后续交接提交只改文档。
- 用户授权将逐页确认的UI全部落地、构建APK、上传GitHub并提供直接下载。工作树D:/shantu-ui-confirmed，分支codex/ui-confirmed-20260915；基线d01d9dc（0.2.35）。原D:/天气系统业务代码及用户9241窗口未操作。
- 已完成本轮实现：紧凑固定主地图/独立定位/侧栏视角/区域总览；画线六项44px工具、小色板、开始前样式、独立路段颜色与备注、实际路径删除、不自动接线、唯一保存和草稿恢复；独立记录窗及导航直接结束/保存；完整行程与转路线后可选隐藏；收藏隐藏目录/恢复；照片先时间后GPS和索引/预览/原图分层读取；临时标记创建、钻井模型参数和统一最上层返回。完整清单docs/ui-confirmed-implementation.md。
- 模块按职责拆出controls共享返回/颜色、tracks路段/checkpoint/nodeCommands、photos元数据/索引、outdoor记录和行程详情、collections隐藏目录，workbench只通过类型props组合窗口。app及useManualTracks保持原架构预算，未调高上限。保留MapLibre双指桥、ObjectGizmo、原始行程/照片/布局键及备份格式；固定布局不套用旧自定义坐标。
- 最终525/525逻辑、TypeScript、架构、网页和APK构建通过。实际App390/360/266宽验收关键状态；画线292×44和164×80色板，极窄屏两行；原库v2照片升级/单张惰性读取与真实JPEG EXIF样本通过；记录保存和清理、草稿恢复、最上层返回及隐藏目录返回通过。修复路线显示面板低层父容器截获点击（Portal）、重复保存/入口、侧栏和底栏被旧CSS隐藏等。12张图与验收结果见docs/design-qa.md及artifacts/screenshots/ui-confirmed。
- 新APK：D:/shantu-ui-confirmed/APK/Shantu-0.2.36-test-standalone.apk；版本0.2.36-test/code43，57,727,251字节，SHA256 33f5f31613a636637377ced5863627597f4c9f2d7474569fc1bd55aa38449429。原4a94证书v2/v3、zipalign、541项ZIP CRC、473地形资源、当前UI/原生桥代码及私密文件/用户草稿排除通过。APK使用最终源码新构建，签名密钥留在原私密路径。
- 图示ZIP：APK/Shantu-0.2.36-feature-guide.zip（12张实际浏览器图和离线索引）；安装/平台说明docs/release-0.2.36.md。源码与测试Release均已完成。图示ZIP 502,234字节，SHA256 8013d2d02fd6204c157b76558938d816a8eca37df0b44857c8f5a361b0fec94f。APK直接下载：https://github.com/Siger1989/map/releases/download/v0.2.36-test-standalone/Shantu-0.2.36-test-standalone.apk 。后续在此分支继续，先由用户实际手机试用反馈再针对性调整，不默认全部重构。
- 真机覆盖安装/手指双指/GPS后台记录/相机/相册部分权限/系统文件分享待验；预览部分地形路网服务502不可用，不将浏览器验证冒充网络与设备验收。HarmonyOS6.1原生HAP/APP仍未交付，缺工具链/合法签名分发。日志.openai/ui-*-final.log及apk-0236-integrity.json，不提交本机日志或构造fixture。

# 当前状态 — 2026-09-14 / 修复后半段陡坡漏标

- **0.2.35已公开发布**：[v0.2.35-test-standalone](https://github.com/Siger1989/map/releases/tag/v0.2.35-test-standalone)，Release id388321633，draft=false/prerelease=true。APK、校验文件、8张图示ZIP和安装说明四项GitHub大小/SHA256与本地匹配。功能源码`02027e60069bb3ba4ec293cb7ea1b9b2f5a692f3`已推送并核对origin/codex/layout-selection-clipping，未合入main/现用主工作树业务代码；后续交接只改文档。

- 用户反馈0.2.34前面标陡坡，后面点数据角度较陡却不标。已从源码确认两项限制：`useRouteDisplay`只保留最前12个标记；连续绝对坡度≥20%只留全段最高峰，且不区分上坡/下坡。未取得用户原轨迹，不能断言其具体位置命中了哪项，但两项都能复现后段不标。
- 范围：新增`routeDisplay/warningMarkers.ts`纯派生标记与`config.ts`显示密度，useRouteDisplay调用；每个独立陡坡/上下坡分别提示，长坡约200米重复，极长单段最多512处均匀分布而不截掉后半段。复用routeAnalysis既有坡度，不改阈值或伪造缺测高程；RouteWarnings只让文字避让，所有提示圆点保留。显示设置说明20%≈11.3°。不改布局、GPS、离线和轨迹存档。
- 新增6项回归覆盖前12限制、坡顶方向切换、较陡开头之后长坡补标、跨日期线稀疏长边的有界全线分布、缺测/断段/阈值和计算一致性，14项相关测试与TypeScript通过。实际useRouteDisplay+MapLibre在全新后台浏览器390/360验证旧12/新20、长坡尾段、上下坡两标记、尾部圆点实际可见与文字避让，无页面/地图异常。8张实测图在`artifacts/screenshots/steep-markers-fix`，明确为构造测试轨迹，非用户数据；不控制/刷新用户工作窗口。
- **0.2.35最终构建通过**：test/code42；503/503逻辑、TypeScript、架构、diff、网页/APK构建、原4a94证书v2/v3、zipalign、543项ZIP CRC及473地形资源通过。新陡上/陡下、长坡分布代码进入APK；桌面控制器、私密文件和用户布局排除通过。APK57,731,510字节，SHA256`3a42579c6c3977a99183e2b29bbb683a010480ed63e42f002946cc937c434744`；布局键/JSON格式、原包名签名及轨迹存档不变。
- 本机输出`D:/shantu-layout-selection-fix/APK/Shantu-0.2.35-test-standalone.apk`；8张实测对照图与离线索引打包`Shantu-0.2.35-feature-guide.zip`（290935字节，SHA256`2686e5c8be67493bc58bed298dc42ef17d5ec6a8173ad8f437f071aab3f3208a`），说明`docs/release-0.2.35.md`。源码与公开Release均完成；日志`.openai/release-0235-public-verify.log`、`.openai/*0235*final.log`、`.openai/steep-map-gui.log`。无工作窗口控制/刷新，用户草稿未写入；用户原轨迹/实际设备尚未验证，不将构造测试结论冒充其具体路线验收。

# 历史状态 — 2026-09-14 / 0.2.34 APK构建与发布

- **0.2.34已公开发布**：[v0.2.34-test-standalone](https://github.com/Siger1989/map/releases/tag/v0.2.34-test-standalone)，Release id388306522，draft=false/prerelease=true。APK、校验文件、图示ZIP和安装说明四项远端大小/SHA256全部匹配本地；图示ZIP798408字节，SHA256`fd736deced51b9320adf1fe12309778a758ae6c0cb610fb91f8f6a0bd808fbd5`。APK对应源码`96f97a15eea4e2a5090870695021c38b085b6f64`已推送并逐字核对origin/codex/layout-selection-clipping；未合入main或现用业务工作树。后续交接提交只改文档，不改变APK功能源码。
- 本机APK绝对路径：`D:/shantu-layout-selection-fix/APK/Shantu-0.2.34-test-standalone.apk`。当前用户窗口仍使用其原有页面，未控制/刷新；用户真实布局JSON和localStorage未写入或重置。主工作树CURRENT_STATE.md同步发行与分支指引。

- 用户最新明确要求「打包新的APK并上传」，覆盖此前暂不打包指示；保留不控制/刷新工作窗口和保护用户布局的约束。以`0fda5fa2b71f08497201f1dd203644bb8d9a4dfe`已验证功能为基础，在本隔离工作树构建0.2.34-test/code41；`git pull --ff-only`确认最新，主工作树现用业务代码暂不热更新。
- 本轮仅修改`config/product.ts`、AndroidManifest版本及发行/模块说明；上一轮uiLayout、AboutPanel、RouteViews、routeAnalysis、桌面共享控制器修正全部进入新版。包名、4a94签名、布局存储键/格式和原始轨迹数据不变。使用原私密签名文件参数，不复制或上传密钥。
- **最终构建与检查通过**：0.2.34-test/code41，APK大小57,731,510字节，SHA256`40911d0d949e8f79f11696861f567c8a8ed753fe0574461d7fe08b8d69781980`。497/497逻辑、TypeScript、架构、网页/APK构建、原4a94证书v2/v3、zipalign、543项ZIP CRC和473地形资源通过。新增手机布局/点数据代码进入包，桌面控制器、私密文件和用户草稿排除通过；此前独立390/360/桌面功能验证仍适用，版本提升不改变其逻辑。
- 13张实测图示及离线索引打包`APK/Shantu-0.2.34-feature-guide.zip`；说明见`docs/release-0.2.34.md`。源码和GitHub测试Release均完成，远端资产验证见`.openai/release-0234-public-verify.log`。草稿阶段按tag查询404，改用已核对Release id读取后完成核验和发布；没有重复上传或替换旧版。真机覆盖安装/系统文件窗口/手指触控待验，HarmonyOS6.1原生HAP/APP仍未交付；各平台边界见发行说明。日志`.openai/*0234*final.log`。

# 历史状态 — 2026-09-14 / 布局兼容与管理、层级、行程点数据（隔离分支，不打包）

- **本轮新增全部实现并验证**：头像页明确提供调整/导出/导入布局，取消退出后的左侧常驻按钮；右侧原入口保留。层级增加页面/组内范围、实际对象与数值，页面层调整所属堆叠父组；静态块补定位让z-index生效。所选行程节点或沿线点显示海拔、带方向坡度/角度，展开显示沿线里程、点序号、经纬度、真实区间速度/记录时间与来源。app/page节点入口不再把沿线距离写0，删除旧的独立单点高程请求；原始轨迹和地形缓存模块不变。
- **用户布局保护**：保留`shantu.ui-layout.v1`和JSON version1，启动只读不写回默认布局。Android固定页面源和同包名/签名覆盖升级继续读取原存储；未实测覆盖安装，不把后台模拟当真机验收。旧版入口为布局→参数→更多→导出布局，新头像页入口更直接。导出文件`shantu-layout-draft.json`可作为后续视觉优化基准；非法导入不覆盖当前布局。有效手机导入立即保存，桌面导入只预览，手动保存到项目才落盘。
- **新增模块/接线**：uiLayout/LayoutSettings与transfer分离视图和共享会话事件；layers负责堆叠目标，session/mobileEditor和桌面控制器调用同一接口。help/AboutPanel仅挂载入口；routeAnalysis/pointMetrics是纯计算接口、RoutePointSummary/routePoint.css为紧凑显示，tracks/RouteViews和app/page最小接线。README记录职责、依赖和回滚；移除新入口/点摘要或回退本分支即可停用，无存储迁移。地图手势、轨迹编辑/存档、离线引擎/缓存、记录定位、照片分享和通信模块未修改。
- **最新最终检查**：497/497逻辑、TypeScript、架构、diff和完整网页构建通过。独立后台浏览器390/360验证旧布局启动零写回、几何保留、导出JSON一致、浏览器真实下载、有效导入保存重开/非法导入保护、头像入口/无左侧残留、页面层跨组遮挡与组内层保持局部、实际层级字段可见、点高程/正负坡度/序号/时间速度、卡片不超过300×200。原整框/裁切/八边角/多选/辅助线/桌面回归再次通过，页面异常为空。
- 日志`.openai/layout-management-*-final.log`和`.openai/layout-containers-gui-final.log`；图示`artifacts/screenshots/layout-management-fix`6张及`layout-container-fix`7张，总索引`artifacts/screenshots/layout-fix-guide.html`。均为实际组件的隔离测试场景，未读取用户布局、未控制或刷新用户窗口。Android系统文件保存/安装/手指触控仍待真机验证。
## 前半轮修正与过程记录（上文497项最终结果为最新状态）

- 已完成的前半轮源码在8a47c49e94a5cd051a1c3bc5871d8f032ac5a585，已推送origin/codex/layout-selection-clipping；该提交尚未合入现用主工作树。用户仍明确先不打包，后续同样隔离验证并保护D:/天气系统/config/ui-layout-draft.json、所有真实浏览器localStorage，禁止控制/刷新用户窗口。

- 用户继续调布局，明确暂不打包。本轮在D:/shantu-layout-selection-fix独立工作树、codex/layout-selection-clipping分支研究和验证；主工作树D:/天气系统及9241现用页面不热更新、不刷新、不写用户草稿。基线a32985bf590ae57d4655f39f0fb9b94d532ccd90，已确认远端最新。
- 原因：带aria-label的SVG被语义组件规则当成独立外框；route-display-info默认overflow-y:auto裁掉移出的卡片，装饰外框overflow:hidden也会裁切独立控件。修改modules/uiLayout/selection、model、anchorRenderer；新增clipping专门处理已独立调整组件的装饰祖先，桌面插件提供共享入口。SVG仍可在任意元素/层级中选择。真正滚动列表保留滚动，不进行DOM搬移、不改路线/高程/离线业务。
- 正在补回归和独立后台浏览器验证，未构建新APK、未修改版本号、未将修正合入用户当前服务。验证完成后只同步隔离分支，后续用户调完再整合。
- 用户追加大小辅助线与拖左边却移动右边：根因是手势丢弃左/上位移，所有缩放都被会话层按保存锚边重新放置。新增resize共享模块，把指针拖框与数值缩放分开：指针八边角固定对边，数值保留锚边；手势到会话传递显示坐标，父级缩放只补偿一次。大小模式支持移动边缘对齐辅助线/吸附，比例与尺寸上限优先，未到达的参考线不显示。alignment参照加入同组单控件。手机与桌面共用接口。
- 第一轮剖面/裁切485测试、TypeScript、架构通过；随后加入缩放修正，最新实际浏览器390/360、左右原生贴边下共32次八边角检查及大小辅助线、桌面左边框拖动通过，页面异常为空，静止渲染无循环。最终全量和额外多选/只调外框复测进行中。
- **最终验证完成**：490/490逻辑、TypeScript、架构、diff与网页构建通过。实际RouteElevationProfile组件+原CSS在独立后台浏览器验证整框选择、移出组后的可见/点选、保存重开、原生列表滚动、390/360下左右贴边32次八边角、只调外框、多选共同对边、大小辅助线，以及桌面左侧边框跟手，全部通过；无页面异常，静止500ms样式变更0次。截图artifacts/screenshots/layout-container-fix含7张实测图，均为隔离组件场景，不是用户草稿或真机截图。日志.openai/*layout*final.log。
- 按用户指示**没有生成新APK或Release，没有提升安装版本**。修正只提交推送codex/layout-selection-clipping，现用9241页面及主工作树业务代码保持0.2.33基线；用户调好后再整合并按届时要求出包。地图、路线/海拔计算、离线与存档数据未修改。撤销本分支即可回滚，用户JSON格式不变。

# 历史状态 — 2026-09-14 / 0.2.33 贴边适配与组内独立选择

- **0.2.33已发布测试Release**：[v0.2.33-test-standalone](https://github.com/Siger1989/map/releases/tag/v0.2.33-test-standalone)，id388261380，draft=false/prerelease=true。四个资产的GitHub大小/SHA256全部匹配本地。功能源码`1b9e7b8cc15b83a85eb52cc05e971bf3892c989e`已推送并与origin/codex/huawei-webview-touch逐字核对；本地分支codex/sync-20260910，未合入main。此次后续交接提交只更新状态文档，不改变APK对应源码。
- 最终源码重新构建的0.2.33-test/code40包含贴边适配和组内拾取；不是此前同版本的中间包。APK/Shantu-0.2.33-test-standalone.apk为57727494字节，SHA256 `29f02ae65cd52af338b545e35413507d60283e558bdab4ce3d8d92e173dce6c3`。图示ZIP为2979031字节，SHA256 `bcba8398ec5b2f63482adfd8ddc0c6f795970df0dd28d25b40aeb2317f2945e0`。
- 最终483/483逻辑测试、TypeScript、架构、diff、网页与APK构建PASS。原4a94证书v2/v3、zipalign、544项ZIP CRC、473地形、布局新增代码进入APK与桌面控制器排除PASS；详细日志.openai/*0233-final.log。
- 实际后台浏览器通过手机整组/子组件、整体内容缩放、字号、辅助线、层级、模式隔离、保存重开及390/360/430/266贴边；独立新浏览器导入JSON通过。桌面最终复测200%细线/小点、多选/撤销、子组件和360贴边通过，页面异常为空。首次桌面复跑等待组件清单超时，服务模块HTTP均200，重新完整运行通过。11张本轮实际截图在artifacts/screenshots/ui-0233，随Release图示ZIP交付；未控制或刷新用户工作窗口。
- 用户布局是后续视觉优化的基准：电脑“保存到项目”，手机“参数→更多→导出布局”生成shantu-layout-draft.json。没有改写config/ui-layout-draft.json或用户浏览器存储，也未把测试布局写入安装包。真机安装/手指/系统文件窗口尚未验；HarmonyOS6.1原生HAP/APP仍未交付。

## 本轮过程记录（以上最终结果覆盖过程中的待办状态）

- 0.2.32已公开发布：Release id388238260，draft=false，四资产大小与SHA256全部匹配。功能源码81bc6b7a24410f156f566a63ef9275d00cf0c80b已推送origin/codex/huawei-webview-touch并与远端核对。
- 用户在发布过程中追加选择范围：既要整体，也要组内单独组件。本轮在uiLayout/selection增加最近独立组件拾取，手机/桌面增加整组与组内组件选项，保留单控件/任意元素、外层切换和多选；切换范围不清掉当前选择。只改布局模块/控制器、版本和测试，不修改地图或业务状态。重新构建0.2.33-test/code40，不用0.2.32冒充新增入口。
- 正在补组内选择和单独缩放的实际图示/验证；待0.2.33构建与发布。继续保留用户草稿、不操作工作窗口。
- 0.2.33手机和桌面后台GUI已通过：整组/组内切换，内部按钮宽30.24→24.192px（80%），父组宽33.12px与高度均不变，外层返回正常。此前内容整体缩放/对齐、层级、模式隔离、辅助线和保存重开在最新代码再验证通过；9张新图示artifacts/screenshots/ui-0233，浏览器无异常。安装包与完整性核对进行中。
- 用户又追加跨手机尺寸贴边：当前dx/dy相对原布局不能保证缩放后边距，需完成后才发布0.2.33。计划新增anchors/anchorRenderer共享模块，JSON version1增加可选锚边/边距/参照父组字段；原生布局CSS仍保留，渲染层按实际父组或视口重算translate，不强制fixed/改DOM。拖动保存最近边/中心，缩放固定该锚边；父组内控件相对父组。手机session与桌面共享，需验证390↔360↔430、保存刷新/JSON、父组缩放、四边/中心、旧草稿兼容。当前已生成的早期0.2.33 APK不含此项，不得发布，最终必须重建。
- 贴边实现已接入：anchors/anchorRenderer依现有CSS补偿位置，安全区/父组参照、窗口/内容/新面板变化重算；模型version1可选anchor，旧草稿不自动覆盖。移动重记边距，缩放保留锚边，多选共用框锚边；整组编辑把既有独立子锚点转换为父组参照。输入字段在自动重算时保持用户正在输入的值。
- 后台贴边实测PASS：四个UI缩至80%后原四侧距离保持；390/360/430/266切换、换尺寸重开、独立新浏览器导入JSON通过，右侧工具右8px、底部导航右/底8px。原全流程手机/桌面复测通过，新增截图07-responsive-390/430.png。需要最后全量检查、最终0.2.33 APK重建和发布；当前早期0.2.33包仍不得使用。用户询问后期优化基准已答复：电脑保存到项目可读取，手机导出JSON，配截图可继续统一视觉，不覆盖草稿。

# 历史状态 — 2026-09-14 / 0.2.32 布局交互修正

- 用户连续追加：整体尺寸变化需带动文字/图案；显示实际字号；辅助对齐线；移动/大小分开；进入布局不退回当前功能层级，并能升降遮挡层级。本轮范围为modules/uiLayout共享编辑模型/几何/手势/手机工具条、tools/layout-editor桌面控制器，以及现有面板外部点击关闭的公共事件保护；地图/路线/离线/数据存储业务不变。
- 已保留用户草稿，开始时git pull --ff-only确认最新；当前基线74222b8，本地codex/sync-20260910跟踪origin/codex/huawei-webview-touch。仅独立后台headless验证，不控制工作桌面或刷新用户浏览器。
- 正在实现与补定向测试，尚未构建或发布0.2.32；0.2.31仍为最新公开包。完成后版本提升、真实后台图示、APK完整性、源码和Release同步均待执行。
- 0.2.32实现与后台GUI已完成：保留工具页及展开工具；移动/大小分离；八边角与数值宽高整体缩放；实际首处文字字号；对齐线/吸附；同父级上一层/下一层。图标17→13.6px、文字宽18→14.4px，均80%，两轴相对中心保持，保存重开PASS。390/360/266默认40px，未选中展开133px、选中不超过178px。桌面200%细线/5px点、多选移动/缩放/撤销及字号/层级通过，无页面异常。
- 相关模块加7项回归，首轮23项布局检查/TypeScript通过；版本已提升0.2.32-test/code39。全量最终检查、APK构建签名和GitHub同步正在继续。用户草稿未改；图片artifacts/screenshots/ui-0232，均独立后台浏览器，无工作桌面操作。
- 最终476/476测试、TypeScript、架构、diff检查、网页与APK构建PASS。APK/Shantu-0.2.32-test-standalone.apk为57723399字节，SHA256 067a799fdd6159455f160230414dc6361c709988ae5bd76260715b94670e17fe；Android独立包code39、原4a94证书v2/v3、zipalign、544项CRC、473地形、0.2.32布局功能代码与桌面控制器排除PASS。
- 7张新图示及index.html打包APK/Shantu-0.2.32-feature-guide.zip，安装说明docs/release-0.2.32.md；真机安装/手指和原生文件窗口尚未验，HarmonyOS6.1原生仍未交付。正在提交推送当前功能分支并发布新测试Release，不能将上一0.2.31当本轮交付。

# 历史状态 — 2026-09-14 / 0.2.31 布局控制器

- **0.2.31已正式发布测试Release**：https://github.com/Siger1989/map/releases/tag/v0.2.31-test-standalone ，id388214327，draft=false/prerelease=true。四资产大小与GitHub SHA256全部匹配本地；APK哈希cb2c2e…8d583。功能源码c3672d9c05e621d7560193800602514b21d146d4已推送并与origin/codex/huawei-webview-touch逐字核对，Release指向该提交；后续文档交接提交不改变APK源码。
- 上传曾经超时，仅任务子进程直连并改用HTTP/1.1后完成，未修改系统网络或公开凭证。5张本次真实浏览器图示与index.html已随Release打包，不含用户草稿。当前用户可下载新APK，在手机保存→参数→备份/恢复→导出JSON。后台模拟与包完整性均通过，真机手指/安装/原生文件窗口仍未验；HarmonyOS原生HAP/APP未交付。

- 最终0.2.31验证：手机默认工具条40px，展开多选148px，单项/边角/批量/保存重开PASS；桌面200%预览实测线宽0.5CSSpx经放大为1px、点5px、无填充，批量移动/缩放/一次撤销PASS，无页面异常。最终TypeScript、架构、网页构建PASS。
- 最终APK已用紧凑版重建：APK/Shantu-0.2.31-test-standalone.apk，versionCode38，57723399字节，SHA256 cb2c2e721959decbe66e6e68869f69d9fda50aa57e4c473e0f8d0c040f28d583。原4a94签名v2/v3、zipalign、544项ZIP CRC、473地形、手机编辑器代码/CSS及桌面服务器排除核对PASS。初版未发布，最终包不能与先前同大小中间产物混淆，以上哈希为准。
- 用户询问交接优化：手机保存→参数→备份/恢复→导出布局，文件shantu-layout-draft.json记录位置/尺寸/比例/字号/视口，可提交给后续优化；与桌面导入格式兼容。工具条最左⠿可拖动且限制在屏幕内。当前手机系统文件窗口/真机安装尚未验证。准备同步源码并发布0.2.31；后台服务API15244/3108、Vite29832/9241，未控制或刷新用户工作窗口。

- 0.2.31实施完成：新增modules/uiLayout，手机更多→布局，默认252×40px单行可拖动工具条；参数按需展开，多选不显示空层级栏，360/266宽度实测展开148px。共享模型/几何/选择/手势从tools迁入模块，旧导入路径兼容导出。外层选择、自动发现面板、Shift/手机多选、一次撤销、父子去重、本地保存/导出导入、独立恢复入口已接入；业务轨迹/离线/地图几何未变。
- 469项逻辑、TypeScript、架构与网页构建PASS。后台独立headless浏览器（无桌面鼠标/工作窗口操作）实测手机单项拖动/边角尺寸、多选一起移动、保存刷新恢复、390/360/266截图PASS；紧凑改版7项定向DOM测试再PASS。桌面200%视觉细线复测发现CSS自定义属性必须setProperty，已修正在复验。截图artifacts/screenshots/ui-0231；用户项目config草稿未改。
- APK已构建过初版0.2.31但用户随后要求极致紧凑，初版不得发布；正在用最终40px工具条重新构建。版本0.2.31-test/code38。最终签名/资源/发布/远端SHA待后续完成记录。

- 最新追加：整块外框可选、绘制工具不可遗漏；预览放大超过100%、细选框小点；Shift多选批量移动/缩放；用户现在要求把边用边调放进安装包，手机去掉组件列表等常驻面板。桌面选择/几何修改进行中，尚未验收；新增手机布局模块将复用纯选择/几何/草稿接口，紧凑浮动工具条、手机本地持久化与导出备份，应用入口与更多工具按钮最小接入。此前已发布0.2.30不包含手机编辑器，必须构建新包。
- 仅后台代码/CLI/HTTP检查，禁止桌面控制。保留当前用户草稿，不刷新用户右侧窗口。上一提交cfd4755已推送上游，最新修改未提交。

- 用户最新顺序：UI仍遮挡，优先做好自定义布局，让用户自己调整；路线必须在线条本身变色。用户明确“不要控制电脑，我还要工作”：后续禁止鼠标/键盘/切窗/刷新等桌面操作，仅后台代码和检查。右侧控制器已通过open_in_codex请求，用户环境确认地址http://127.0.0.1:9241/__layout。
- 用户反馈右侧无法加载。已证实旧3108/9241服务退出；独立后台Node启动恢复9241。原vinext API启动卡住，已核对并停止本任务10352，改用desktop-web现有四个API的轻量适配，不编译整套网站、不打开浏览器。当前API PID22300、布局Vite PID20512；恢复命令npm run start:layout；日志.openai/layout-server-state.log。HTTP页面/模块/草稿均200；地形9/395/203.png相对重定向至修补图，PNG读取200/69367字节，不跨端口。
- 新增tools/layout-editor/geometry.mjs、gestures.mjs、api.ts和scripts/start-layout-editor.mjs；仅desktop-web/server.ts增加库模式入口保护。搜索组件/被挡住的单控件，稳定选择器，八边角缩放、父级缩放补偿、保留反向锚边、图层层级和对齐/移回画面。纯字号/层级修改不再隐式改变fixed子控件定位；预览样式优先级高于应用密度规则；拖动时按动画帧节流，不每次重建侧栏。
- 布局9项模型/缩放/对齐/HTTP保存和共用本地服务器2项检查PASS，编辑器脚本打包与控件ID关联检查PASS；实际鼠标拖动/多尺寸GUI仍未验收。Computer Use两次因不能可靠确认浏览器URL而停止；不得用旧图充当新验收。用户现明确禁止电脑控制，应以其手动反馈继续。
- config/ui-layout-draft.json仍为空；没有写入测试偏好。功能基准0.2.30 APK已先打包，布局控制器仅开发模式不进入APK。源代码aa9516068d1c9abd6aa6d65e13f25a9615dbbf47已推送origin/codex/huawei-webview-touch。
- 0.2.30 Release id388182354已完成发布，PATCH返回draft=false/prerelease=true且四资产大小/SHA256再核对通过：https://github.com/Siger1989/map/releases/tag/v0.2.30-test-standalone 。功能APK对应aa9516068d1c9abd6aa6d65e13f25a9615dbbf47；后续布局控制器源码独立提交，不在APK中。0.2.29仍保留draft。布局TypeScript/diff检查通过，待本节下一条记录最终同步SHA。

# 0.2.30功能修正与APK验证

- 用户继续反馈：坡度已有数值，地图颜色仍不变。本轮仅修改routeAnalysis/routeDisplay/TrackLayer、RouteViews与页面回调，不改原始轨迹存储、测量/勘探几何、3D精调和地图手势。
- 已解除编辑状态对路线色线的屏蔽，候选加入当前绘制草稿；新增terrainProfileTrack保留缺高程边内的DEM采样，新增elevationLineParts让稀疏两点线也沿高差渐变。坡度仍按10%/20%分档，同档同色；不伪造坡度变化。详情新增地图着色直达按钮。
- TrackOverlay.analysisParts只传显示派生几何，选点/选线/吸附仍使用原始saved/draft。拖动预览期间忽略旧派生线。新增点没有时间戳，速度计算使用原数据。useDockClearance提为独立占位hook以控制RouteViews规模，删除原内嵌重复职责。
- 457/457测试PASS（453应用逻辑+4布局模型/HTTP保存）。包括真实TrackLayer源在编辑中收到三档坡色、DEM中间山峰、缺测/断段、原点拾取、拖动预览和6000边预算。TypeScript、架构、diff检查及完整网页构建PASS。
- 0.2.30-test/code37最终APK已构建：APK/Shantu-0.2.30-test-standalone.apk，57710867字节，SHA256 4b265942e1fe32bac3f0b6883478a964f72fb302eb8dc4183226c652b84ccccc。原4a94证书、v2/v3、zipalign、541项ZIP CRC、473项地形、新颜色修正JS与开发工具排除检查PASS。0.2.29源码483b110f98e13363129c7f6572872eeac25a5566已推送核对；Release id388157475仍draft=true，四资产已校验但不是公开交付。0.2.28仍是上一公开版本。
- 本轮Computer Use因无法可靠确认Windows浏览器当前URL被工具停止，已停止UI操作。最新着色截图、多尺寸新增按钮和布局最终拖动/尺寸/保存后重开GUI验收未完成。上一轮真实截图保留，不能当作本轮新颜色验收。
- 后续：提交推送核对→发布0.2.30测试包。详情docs/release-0.2.30.md；功能图示沿用18项既有实际截图并明确本轮未补新颜色截图。布局工具源码可用且仅开发模式，GUI验收待工具恢复；config/ui-layout-draft.json保持空草稿。

# 历史状态 — 2026-09-14 / 0.2.29

## 0.2.29修正完成、APK已构建，准备同步发布
- 用户原顺序：先完成本地功能→打包→布局窗口。0.2.28已经发布；随后用户指出左右UI重叠、定位/海拔灰色及坡度缺高程，优先完成本次修正。
- 修正position/routeDisplay/routeAnalysis/controls：绿色可用/激活状态；编辑时允许只定位、不带动镜头；显示设置解除误禁用；定位提示移顶、坐标限宽，编辑底部按钮上移；左进度条按顶部路线卡实高避让，右海拔/方向盘/展开工具分区。
- 新useTrackElevation共用DEM；RouteAnalysisSummary此前只分析原文件，现缺高程时补读地形且提示来源/失败原因。仅显示派生副本，不改变原轨迹坐标、时间、存档。删除useRouteDisplay重复请求流程，保留elevation兼容入口。
- 449/449应用逻辑、4/4布局模型/保存接口检查、tsc与结构检查PASS，APK及网页资源构建PASS；390/360/266编辑UI截图已保存。无高程GPX通过离线缓存DEM读取约496米、坡度0.3%；浏览器定位超时，不代表真机GPS验收。
- APK/Shantu-0.2.29-test-standalone.apk：0.2.29-test/code36；57710867字节；SHA256 230f68d558587230335932e22e38ace9d3f52c2a1db2346330bb33abe2825d6b。原4a94证书，v2/v3/zipalign/541 CRC/473地形/新增修正JS与许可PASS。开发编辑器未混入APK。
- 新布局工具tools/layout-editor；npm run dev:layout，http://127.0.0.1:9241/__layout；相对位置/尺寸/比例/字号/隐藏、撤销、JSON保存/交换。config/ui-layout-draft.json保持空草稿，未把测试布局当用户偏好。
- 布局真实iframe/选择框/属性面板已显示；第一次拖动暴露子选择器“>”被拒，已修正并加入回归。此后Codex浏览器连接连续超时，最终拖动/尺寸/保存后重开端到端未验收，不能称已完整验收。open_in_codex请求亦未返回，不声称窗口已成功交付。保存API实际本机HTTP往返/中文/拒绝异源与坏文件保护通过。
- 图示18项及index.html打包APK/Shantu-0.2.29-feature-guide.zip；截图目录artifacts/screenshots/ui-0228。18～23为本次修正，24为已标注的0.2.27采样设置图，其余0.2.28流程图；固色照片/构造轨迹明确为验证数据。
- 详情docs/release-0.2.29.md、tools/layout-editor/README.md。队伍/SOS/PTT无服务暂缓；步行离线路网和地图分别下载；奥维需明确坐标系；真机、后台/锁屏、原生HarmonyOS仍未交付验收。
- 当前分支codex/sync-20260910→origin/codex/huawei-webview-touch，不是main。0.2.29提交/发布待下一条核对。预览服务本任务PID1600/7020，端口9241/3108仍在运行，清理前查命令行。

# 当前状态 — 2026-09-14 / 0.2.28

## 0.2.28历史交付与反馈
- 用户最新顺序：本地功能完成→先APK打包→布局窗口。队伍/SOS/PTT按无服务器明确暂缓。
- 功能与模块/限制见docs/release-0.2.28.md；448/448逻辑、TypeScript、结构检查PASS；网页和APK构建PASS。390/360/266 UI检查，实际图示artifacts/screenshots/ui-0228/。
- APK/Shantu-0.2.28-test-standalone.apk：57710867字节，0.2.28-test/code35；SHA256 63706b0c1ccd97801809afd209a05bf4563c1541bd3e754c45d19f9aa3315a7d。原4a94证书，v2/v3/zipalign/541项CRC/473地形/新功能JS与许可核对通过。
- 浏览器公开路网1026节点通过导入/校验/1.1km步行算路；地图包311/311、41.4MB通过续传和仅缓存冷启动；照片2/2匹配、重点与混排长图生成；Ovi构造样例通过。用户原生Ovi/真机/鸿蒙原生未验。
- 修复冷启动默认卫星覆盖仅缓存模式、区域外道路搜索结果、缓存无window兼容、并发容量预留、坐标/记录按钮重叠及极窄屏工具避让。
- 本地分支codex/sync-20260910，上游origin/codex/huawei-webview-touch；新源码提交/发布待本节下次记录。不要把0.2.27 Release当作新包。
- 0.2.28源码bd3b4a4c9a6b2730f2bf7ffd71eb3032a8fbbc7c已推送并核对；Release v0.2.28-test-standalone公开测试版已发布，3项资产SHA256和大小匹配。
- 布局工具已开始，tools/layout-editor独立Vite开发插件，尚未验收/交付；用户最新反馈左右UI重叠、底部按钮灰、坡度无高程，先修正并重新打包。
- 已定位：route-card移到顶部但旧轨迹进度条仍占原位置；定位状态条盖住新底部定位；海拔框未完整避让方向盘；按钮禁用条件过宽、激活颜色被全局样式覆盖；RouteAnalysisSummary只分析原始高程而未接DEM。
- 修正模块position/routeDisplay/routeAnalysis/controls。共用useTrackElevation只派生显示，不改轨迹存储；编辑时可定位不移动镜头；海拔设置保持可用；新增地形缺测原因。无海拔GPX浏览器已读取实际496米DEM（仅缓存模式），坡度分析和多尺寸复验进行中。
- 预览服务1600/7020为本任务后台进程，9241/3108；清理前复核命令行。

## 0.2.28早期过程记录（已被上述完成记录替代）
- 用户追加：定位跟随移到下方、优先地图路线海拔颜色/图例，信息自行选择显示，整体缩小UI，其他本地功能继续；每个功能分别提供实际图示。
- 已ff核对分支，起点adbd0ef；新增routeDisplay显示设置/地形补高程/统一海拔色阶，底部PositionDock及共享compactDensity正在接入。
- 仅派生显示数据，不写回估算高程到原始轨迹。保留缺测、暂停分段和接驳虚线语义。类型/逻辑/浏览器验证与新版APK尚待完成。
- 队伍/SOS/PTT缺通信服务；已询问部署条件，同时继续本地功能。真机、鸿蒙原生交付边界沿用下文。
- 用户已确认没有通信服务器，先完成本地功能；特别强调离线导航引擎和离线地图缓存。新增offlineRouting区域道路图/A*、缓存直读与离线模式正在实现。
- 用户要求后续Codex可视布局编辑窗口，支持拖动位置、尺寸、比例、保存后再统一优化；最新顺序：先补齐本地功能、验证并打包，再做布局窗口。目前没有开始布局编辑器代码。

### 0.2.28 当前实现与验证（进行中）
- 新增 offlineRouting：区域OSM步行路网下载/导入/导出/完整性校验、边上吸附、A*、途经点、仅离线/优先离线模式与道路名搜索。真实成都公开测试区1026节点已在浏览器导入并校验，实际算出文庙前街→锦兴路1.1km/17分钟。发现并修正道路跨区域时搜索选点落在包范围外的问题。
- tileCache共用缓存直读；地图仅缓存模式、持久存储申请；修复并发下载容量预留和进度写入过密。8项早期定向检查通过；首次全量发现2项无window环境兼容回归，已修正等待复验。
- returnHome：按连续段原点序反向返航，车位/营地/撤退点复用annotations存储，可靠GPS距离/方位与仅离线路网返程。面包屑循环/断段保护检查通过；真机定位未验。
- routeShare：可选最多8照片、横竖混排、重点照片整行放大；原照片旋转/标绘复用已有导出器。版式逻辑检查通过，实际照片图示待验。
- dataTransfer：奥维OVKML/OVKMZ批量入口，显式CGCS2000/GCJ02转换；普通GPX/KML按标准。不能从扩展名自动判断奥维坐标系，未知拒绝猜测；尚缺用户原生奥维样本。mapSources新增天地图官方申请说明入口。
- UI：底部定位44px触控，路线海拔色阶/统计/剖面/陡坡标记可选。已有实际图示01-follow-elevation-390.png、02-offline-routing-390.png。其余逐项图示和390/360/266检查继续。
- 新增文件和接口需整理README，最终格式/结构检查、全量测试、APK版本提升构建及GitHub同步尚未完成。布局窗口未开始，遵从先功能打包再做窗口。

## 本轮目标与成果
- 用户要求检查迭代变慢、整理冗余，并按附图分模块添加户外功能。已完成首批结构整理与记录/分析/批量导入实现；完整逐项状态见 docs/upgrade-plan-20260914.md，未把整张图宣传为完成。
- 本地 codex/sync-20260910；上游 origin/codex/huawei-webview-touch；起点7e974ad。工作区原先干净、已ff核对。未合main，旧stash与其他工作树保留。
- 新增 dataTransfer / routeAnalysis / workbench；文件交换610→7非空行兼容入口，OutdoorPanel独立四标签，主页面2947→2831非空行；导航启动/定位生命周期和轨迹拼装迁到明确接口。
- 记录增加外置控制、省电/标准/高频/自定义、按距离、静止降频/移动恢复及导航自动开始（默认关闭）；速度/坡度着色及50米坡度分析；GPX/KML/KMZ/JSON整批校验与合并。
- 减少无效GPS复制、状态变更重建几何、后台快照轮询、原生重复序列化。新增结构检查；历史进度完整归档并与基线逐字核对，见 docs/history/progress-through-0.2.26.md。
- 文件/接口/回滚说明见 docs/architecture.md、各新模块README、docs/release-0.2.27.md。稳定测量/勘探几何、模型精调、地图手势、天气地形数据和存档键未变。

## 验证
- 437/437逻辑PASS，TypeScript PASS，结构检查PASS，网页构建PASS，Java采样策略10检查PASS。
- 390×844、360×780独立本地浏览器：批量预览→确认→收藏2项→详情；坏批次失败仍2项；省电/按距离完整重载保留；外置入口44px触控。普通行程300×200 / 286×200；窄屏详情340×756，无页面横溢；当前控制台error为空。
- 截图 artifacts/screenshots/ui-0227；详细过程 design-qa.md。此前地图请求短暂502后恢复，未据此改数据源。
- 最终默认 npm run build:apk -- -StandaloneTest PASS。修复本机旧PowerShell的Get-FileHash缺失，使用.NET流式哈希共用实现。
- 最终APK APK/Shantu-0.2.27-test-standalone.apk：0.2.27-test/code34、57690301字节；SHA256 ae82db8083ac60a056e2917a287ecb0935b2a4dc2d5a253841af3c28c90fa4ca。
- v2/v3、原独立4a94签名、zipalign、540项ZIP CRC、473地形和新增JS/DEX标识PASS。SHA256及安装说明已准备；日志均在.openai且不进Git。

## 发布与下一步
- 源码提交5c21a4134a8d47dbc0035a0630f8252e30e6e4cd已推送origin/codex/huawei-webview-touch；远端分支与本地一致，Release标签指向同一提交。本次后续交接提交仅更新本状态文档。
- v0.2.27-test-standalone已发布为公开测试Release（id388117228，draft=false/prerelease=true）；无认证API复核成功：https://github.com/Siger1989/map/releases/tag/v0.2.27-test-standalone 。APK、SHA256文件、安装说明3项资产均uploaded，大小与GitHub SHA256 digest逐项匹配本地。
- APK digest为上文ae82db…；校验文件digest 0ca11e43faba55c562aa3fee01f008570bff4863a536d556b8175e2b4250189a；安装说明digest e23dbeb15f2b2fa1aeb314e859662728d0975cbab72f01488852fc8fddb3a3be。首次网络TLS握手超时，发布子进程直连后成功，未修改系统网络设置或保存凭证。
- 本轮临时验证页面已关闭，视口覆盖已恢复，自建9241/3108验证服务已停止；截图和日志留本地供追溯。
- Android真机安装、GPS、锁屏耗电、手指触控未验。HarmonyOS6.1原生HAP/APP未交付；本轮未更新Windows/Mac ZIP。
- 原生离线路由/专门返航、奥维坐标适配、队伍/SOS/PTT、照片混排等仍待后续；需要道路图、奥维样本及队伍服务部署/分享范围。主页面和TerrainMap仍有历史结构债务。
