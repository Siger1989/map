# 2026-09-10 启动恢复验收 PASS，最终业务冻结
- 追加map/lastView单测PASS，最终类型PASS；浏览器重新打开无hash精确恢复[38.0073,10.0433]/zoom8.94/bearing18.4/pitch46，显式#7/12/40/20/30优先PASS，无pageerror。日志ui-0222-view.log。
- 共42个实际界面截图已完成（含通用入口、收藏、照片、测量、节点、键盘搜索、启动恢复），照片全屏/编辑/画线/分享补录PASS。初次点击照片超时，增加合理时限后通过，未更改业务或用户数据。
- 新业务源将提交后重建网页/APK；之前中间APK不发布。下一步PDF渲染验收、最终签名/资源/CRC/版本核对、上传GitHub0.2.22及同步交付文档。

# 2026-09-10 追加启动视角恢复，重新最终构建
- 用户新增：启动继续上次层级和定位。新增map/lastView本地相机快照，移动结束/后台/pagehide保存，普通启动恢复中心、zoom、bearing、pitch；显式地图hash优先，损坏存储回退默认。
- 前一0cd7376源码已推送、APK已构建校验，但尚未发布；本追加后必须重新构建，不能交付旧中间包。
- 收藏412/393/360/266最终复验PASS：等Canvas尺寸同步后，地图目标中心误差<1px，最小180px地图，无横溢。之前脚本访问非公开transform字段报错，已改公开Canvas/getPixelRatio检查。截图36/37通过。
- 下一步：视角恢复单测/浏览器重启与链接优先检查、最终类型与网页/APK重建、图册及Release。

# 2026-09-10 0.2.22构建前检查 PASS
- 类型最终PASS（tsc-0222-final3），既有384项逻辑及新增搜索视口1项PASS；网页构建PASS（build-web-0222-final）。
- 浏览器01–35实际截图PASS/无pageerror；搜索结果框在412×480键盘视口内且选择可回填。节点编辑412/393/360/266宽六操作同排、142px高；三个吸附开关实测互斥/独立关系PASS。
- 收藏多尺寸复验首轮读取发生在ResizeObserver前，412通过，393读到上一帧地图宽；脚本改为等地图尺寸同步后判定，未据此猜改源码，待复验。
- 主要文件和功能见本轮前节；开始以当前最终源构建原系列0.2.22/code29 APK。图册和Release上传待完成，真机仍未验。

# 2026-09-10 0.2.22最终反馈与截图检查
- 目标：完整处理手机密度、键盘/突出搜索、收藏布局、测量记录隔离、照片标记，以及新增画线河流/节点吸附和紧凑节点编辑。
- 已改：上一节模块全部接通；新增input/floatingGeometry共用可视区域/IME边界；TrackTools三个独立入口，节点编辑六操作同排，图层36px紧凑行。
- PASS：384项逻辑测试与类型（最新边界逻辑新增1项单测PASS）；真实浏览器截图01–23刷新完成，无pageerror；测量保存→重开新草稿且存档不变、照片不透明带徽标、位置无XY分支、路线输入视口缩小但面板高度不二次收缩。
- artifacts/screenshots/ui-0222保存实际截图；正在追加搜索/其他菜单及节点多尺寸检查。测试存储隔离，未更改用户地图数据。
- 源码0.2.22/code29，尚未最终构建/推送/发布，不声称真机验收。下一步完成截图图册、类型/构建、原签名APK及Release。

# 2026-09-10 0.2.22反馈修复进行中
- 目标：投影默认独立完整图框；位置统一经纬度页；照片不透明且边缘带原标记小图标；收藏恢复目录占主、下方目标自动完整居中；键盘输入不按28dvh二次缩框；以收藏字号行距统一密度；收藏操作菜单不能越屏。
- 已改：measurement/ProjectionChart及布局、AnnotationWorkspace统一坐标、PhotoLayer/association/storage瞬时图标信息与照片不透明；收藏恢复72%分栏并保留最少180px地图。正在接目标自适应及菜单定位、键盘规则。
- 首轮类型FAIL：脚本替换位置条件留下旧分支，已定位删除，待重新检查。尚未构建或发布0.2.22，不宣称当前修改已完成验收。
- 下一步：完成上述定点修复，类型/针对逻辑/多尺寸实际浏览器检查，版本29与最终APK/推送/Release。

# 2026-09-09 0.2.21最终交付 PASS
- 当前目标完成：收藏列表/地图统一自适应边界，底部工具缩小贴安全边缘4px，扩展换行；比例尺移到地图左上4px，393及266窄屏确认与扩展88px工具栏不相交。此前360×780几何检查通过；当前预览恢复393×852。
- 最终业务源码d1f2ca81f7bdfbb0363da5dac65e0ce2a52892fa已推送并核远端一致，未合入main。此前382逻辑/类型/网页PASS；最后仅比例尺CSS改动，重新Android网页及APK构建、检查包内该CSS和540项CRC均PASS。
- 最终APK 57,649,341字节，SHA256 3f9614387184b68889b29f267b4700a914578cf5e734e4b85207ed767b1a1692，原系列com.guanyun.weather.preview/0.2.21-test/code28/a3aa签名。v2/v3/zipalign/473地形通过。
- GitHub v0.2.21-test已公开，Release id385644317，draft=false/prerelease=true，APK/SHA256/安装说明三资产uploaded且服务端digest与字节数一致。发布目标为d1f2ca8。下载https://github.com/Siger1989/map/releases/download/v0.2.21-test/Shantu-0.2.21-test.apk。
- 本轮草稿更新target时GitHub返回临时untagged名称，已按创建返回的精确Release ID取回，连同tag_name及target_commitish明确发布并核对正确URL；没有修改其他版本资产。
- 变更/验证记录：docs/release-0.2.21.md、docs/ui-density-standard.md、modules/collections/workbenchLayout.css、controls/compact.css/MapActions及measurement；日志.openai/apk-0221-edge-final.log、upload-0221-final.log、publish-0221-final-resolved.log、release-apk-0221-verified.log。
- 阻碍：无。下一步用户手机试用反馈；截图接口失败已记录，DOM验证不等于真机触控。真实相机耗时/系统分享待真机，HarmonyOS6.1原生包未交付。源码状态/发行文档最后同步，不再修改本轮业务。

# 2026-09-09 追加边界修复：收藏比例尺避让工具栏
- 检查发现底栏展开88px时可能压住原bottom56px比例尺；改收藏状态比例尺位于地图左上4px，避开上下两种底栏高度。将重新构建最终包；已上传0.2.21仅为草稿，未公开，不交付旧资产。下一步DOM边界复验、构建并替换本轮草稿资产。

# 2026-09-09 0.2.21最终构建与同步 PASS，上传发行资产中
- 目标：完成紧凑UI、多手机收藏布局与此前多点测量/照片修复，并交付最终APK。
- 源码5372ccf4eeaab42ca76bb8b90ad7b6de9bc98306已推送codex/huawei-webview-touch，ls-remote一致。类型、382/382逻辑、网页及Android网页/Java/DEX构建PASS。
- 最终APK/Shantu-0.2.21-test.apk：57,649,341字节，SHA256 bb8e5610443be14c0c9080b1f377eafec7d683bf0b23d985a422aed44a8235f2；原com.guanyun.weather.preview/code28/a3aa签名、v2/v3/zipalign/540项ZIP CRC/473地形PASS，包内compact及收藏CSS已实查。
- 已检查393×852、360×780、266×575收藏列表与地图边界相接，工具栏安全边缘4px、展开换行无横溢。截图接口失败，不能声称本轮截图或真机验收通过。
- 文件：统一密度CSS/规范、收藏workbenchLayout/MapActions、测量紧凑界面；本节更新发行说明与状态。日志.openai/build-web-0221-final.log、apk-0221-final.log、manifest-0221.log。无构建阻碍。
- 下一步：上传并核对GitHub0.2.21三项资产、公开Release，再同步最终交付记录。手机相机耗时/系统分享/触控仍待真机，HarmonyOS6.1原生未交付。
# 2026-09-09 收藏多尺寸复验 PASS，进入最终构建
- 实际CSS360×780 PASS：列表高200、地图从200开始；底栏220×44、右/下各4px，无页面或工具条横溢。
- 实际266×575 PASS：列表160.999、地图同高开始；底栏220×44，展开228×88，仍距边缘4px，scrollWidth=clientWidth228；恢复用户393×852预览。
- 新增收藏状态下已存测量SVG与地图共用分栏top/height，避免地图缩小后测量覆盖层坐标偏移。原地图ResizeObserver继续响应容器变化。
- 截图接口当前连续返回Unable to capture screenshot；尺寸验收依据真实DOM边界，截图自动留存失败明确记录。已有用户截图用于复现，不声称本轮完整截图或真机验收。
- 用户新增紧凑规范及收藏修复均已完成实现，当前仍未公开中间APK。下一步保存最终提交、类型/逻辑/网页与APK构建、源代码推送和0.2.21 Release核验。

# 2026-09-09 收藏分栏与底部适配修复（进行中）
- 用户截图发现收藏上方列表已被尺寸上限压到200px，但地图仍按旧72%起始，出现巨大背景空洞。已将两者统一使用--collection-split=--map-panel-max-height；收藏内容视图保持全宽，浮窗高度预算一致，ResizeObserver复用地图resize。
- 底部工具移至安全区内右下4px，图标17px/触控44px；收藏模式默认5个常用按钮一行，额外操作展开为两行，禁止横向或纵向滚动条。入收藏时收起扩展选项；定位设置从工具栏上方展开。
- 实测393×852 PASS：列表bottom200、地图top200（空隙0），地图height652；工具right393-4、bottom852-4，scrollWidth=clientWidth228，无横溢。正在继续窄屏检查；截图接口本次返回Unable to capture screenshot，不能把缺失截图算通过。

# 2026-09-09 统一紧凑UI规范已实施，准备最终发布
- 用户再次明确UI小且紧凑，并要求统一所有地图操作浮窗上限。已新增docs/ui-density-standard.md及modules/controls/compact.css，AGENTS.md更新为高度min(28dvh,200px)、宽<=300px、间距<=4px、内部滚动、44px触控；覆盖旧38dvh/320px规则。
- 测量改成单一卡片：A/B/C+更多+关闭一行，结果合入卡片，添加/删除/撤销/保存一行；删除大圆背景、单独下方结果卡片与长期说明。坐标、投影示意、分享及已存记录在更多中按需打开；地图虚线仍显示。
- UI PASS：用户当前真实393×852，整体卡片149.85px高、操作44px、无横溢；上限200px；测量选择/添加仍在用户使用中。截图artifacts/screenshots/measurement-compact-standard-266.png（文件名沿用266，实际视口393×852）。旧266×575测量布局复现与修复记录保留；本次新统一布局还需复核小尺寸及其他弹窗。
- 类型PASS .openai/tsc-density-0221.log。前次382逻辑测试通过，本次是UI重新排布和尺寸规范；尚未重新打最终APK，不发布之前中间包。
- 下一步最终UI及类型/构建验证，新的源码提交推送，重新APK与Release0.2.21；签名和鸿蒙限制同前。

# 2026-09-09 23:10 单点删除及用户窄屏复验 PASS，重新最终构建
- 用户实际内容宽266×575复验PASS：点标签独立一行、提示23px单行、4个按钮各46.7×44px、面板217px/结果153px不重叠、无横溢。截图artifacts/screenshots/measurement-266-delete-fixed.png。已告知用户预览修复。
- 删除B后只保留A，撤销恢复两点全部原坐标PASS；未保存测试删除、未改动用户已存测量。
- 删除实现data.removeMeasurePoint/useMeasurement/Measurement：可删除首、中、尾或全部草稿点；savedId固定记录身份，少于2点可显式保存移除原地图连线；撤销栈包含记录身份。原路线删点不补线规则未改，此处仅测量按顺序相连。
- 原05ab6d3中间包已构建但未发布，必须用本节实现的新提交重建。下一步新增回归、类型与最终构建、push新SHA、公开0.2.21。

# 2026-09-09 23:05 用户继续反馈：单点删除与极窄预览修复（进行中）
- 补充删除所选测量点并支持撤销，中间点删除后相邻点连接。草稿持久化savedId，删除首点后更新原记录，避免另存重复。少于两点可通过保存移除原地图连线；原记录不静默删除。
- 实际用户351预览在宿主缩放下innerWidth=266、innerHeight=575；原helper提示与4按钮横排被挤为11px文字，已复现。改提示独立单行、按钮4列、<=340时点标签独占header一行；结果卡片按剩余宽度限制，窄屏下下移避免重叠。正在对此真实尺寸复验。
- 先前0.2.21中间APK已构建但未发布，不交付它；本轮删除/响应式修复后重建同一尚未发布的0.2.21，再推送新SHA及公开Release。

# 2026-09-09 发布构建检查点
- 业务提交12f03de已完成；补充mobile/vite.config.ts忽略.build/dist/APK/log/artifacts，防止打包输出的index.html把用户正在看的测量页面自动刷新关闭。
- 下一步用此修复后的提交重新构建0.2.21，并核APK签名/资源及发布目标SHA。类型、381项逻辑和网页构建已通过；构建还未完成。

# 2026-09-09 22:55 浏览器与逻辑验证完成，准备 0.2.21（PASS）
- PASS：381/381 tests，类型检查；新增5项测量快照/存储失败/工程剖面分页/照片地图身份/路线锚定保护测试。
- 浏览器 PASS：重启Vite清除先缺文件后创建留下的解析失败缓存；9230新预览已加载，用户已获新链接。实际从长方体选出 C，A/B/C逐段数据；保存“测量 1”后关闭、整页重载、点 C 重开一致。测量JPEG预览1200×817成功。
- 手机尺寸 PASS：CSS 390×843及360×780，无横溢，面板154px/结果197px，操作目标约44px；截图 measurement-multipoint-390/360、measurement-share-390、marker-photos-summary-360.png。截图接口缩放加边框仍存在，不当作像素精确真机验收。
- 照片 PASS：通过公开logo测试文件走拍照返回/处理/IndexedDB路径，保存成功、缩略图解码，摘要操作栏下直接展示；地图同一标记仅一张照片图标，无重复pin。旧照片原始拍摄位置保留用于原始元数据，地图使用标记最新坐标；已删除标记照片不显示。
- 变更：measurement新增saved/MeasureLines/profile/MeasurementShare及多点UI；photos并行处理/事务快照/地图身份；annotations位置保护和摘要照片；TerrainMap/app选点与展示；NativeBridge允许measurement JPEG。清单已0.2.21-test/code28，现准备最终构建/推送/Release。
- 记录：.openai/tsc-0221.log、tests-0221.log。阻碍无；真实手机拍照耗时、系统分享与触控未验，HarmonyOS6.1原生未交付。

# 2026-09-09 22:45 实施检查点：多点测量及照片整体展示（进行中）
- 已实现：多点 A/B/C、保存/重开、多段水平线与垂直投影、分页工程测量连线剖面图JPEG预览/保存/系统分享；地图模型/地点/照片/路线节点/区域节点坐标接入。
- 照片：并行元数据/哈希与解码，单次大图缩放后并行编码，重试复用副本，写入事务返回快照免二次全库读取；拍照分阶段状态。用户实测旧版十几秒后成功，新手机耗时未验。
- 新反馈修复：行程标记禁止脱离路线单独移动；关联照片地图位置随标记、无主/隐藏标记照片不显示，照片缩略图替代重复pin；标记摘要操作栏下直接显示照片。删除/关闭标记清空路线选择，避免露出被选路线的终点标签；原照片文件保留。
- 验证：第一轮 npx tsc --noEmit PASS（.openai/tsc-0221.log）；当前预览JS仍旧、CSS热更新撑开旧卡片，正在修正完整刷新和浏览器验收。逻辑/构建未完成，不宣称交付。
- 下一步：确保实时预览完整加载“添加点”，390/360和分享图检查，关联/持久化回归，再0.2.21/code28最终构建推送发布。原始截图记录用户反馈，未动用户存档。

# 2026-09-09 后续反馈：测量保存/多点/水平投影、拍照保存慢（进行中）
- 目标：测量可自由添加A/B/C等连续点；每段显示水平夹角、朝向、水平线与垂直投影；整组保存地图，退出/重启后保留并可打开。同步定位拍照返回后保存慢。
- 进度：新增saved.ts、useSavedMeasurements.ts、SavedMeasurements.tsx（尚未接线，正从两点扩展多点）；已读照片处理链，原图全量读取/EXIF/解码/两次编码/哈希串行，写入后还重读全部照片。天气查询本已后台执行，不能归因网络等待；手机具体延迟待用户补充。
- 变更范围：measurement模块、app接线、photos import/storage/useTripPhotos/useMarkerCamera；版本待提高0.2.21/code28并沿用0.2.20原系列签名打包发布，不再暂停。
- 已执行：git status/diff、git pull --ff-only（已最新）、源码读取；尚未验证新实现。日志.openai/*measure-save*，截图artifacts/screenshots/。
- 状态：进行中；下一步多点保存与图形实现、照片处理优化及分阶段反馈，逻辑/浏览器验证、最终构建与GitHub发布。
# 2026-09-09 0.2.20 APK已公开交付（PASS）
- 当前目标：用户明确要求直接出包，已继续执行；采用本机已有原系列签名构建，不再暂停等待下午独立版密钥。
- 构建 PASS：最终源码4bcbc7ce1d6b5259ef3d6bb706a252d77d793943重新构建APK/Shantu-0.2.20-test.apk，57,645,245字节，SHA256 c868936b76ff34563ba789cd572a9bf0ac7a4668cf6044481722742d82c74bc9。
- 包身份：com.guanyun.weather.preview，0.2.20-test/code27，a3aa原系列签名，安装名山兔。可覆盖原系列0.2.14；与下午4a94独立系列0.2.19并存，不能覆盖它，数据不自动迁移。
- 验证 PASS：重新Android网页/Java/DEX/APK、v2/v3签名、zipalign、473地形资源；实际APK清单.photos/.capture/.routes各自独立。此前376项逻辑/类型/网页验证继承，未重复无关测试。手机系统相机与触控仍待真机验证，HarmonyOS6.1原生仍未交付。
- 文件变化：docs/release-0.2.20.md、README.md、feedback记录及CURRENT_STATE；无业务源码再改，无密钥更换或新建，无业务删除。
- 命令/日志：powershell scripts/build-android.ps1 -SdkRoot D:/GodotAndroid/android-sdk -JdkRoot D:/GodotAndroid/jdk-17；.openai/apk-0220-original.log、manifest-0220.log、upload-0220.log。GitHub v0.2.20-test已公开，Release id385575130、draft=false/prerelease=true；APK/SHA256/安装说明三资产uploaded且服务器digest和字节数均匹配。540个ZIP条目CRC通过。下载https://github.com/Siger1989/map/releases/download/v0.2.20-test/Shantu-0.2.20-test.apk 。
- 阻碍：无。实现源码4bcbc7c已在远端并作为Release目标；发行文档12f15e4已推送codex/huawei-webview-touch，最终交付记录随后同步。下一步用户安装反馈，系统相机仍待真机验收。
# 2026-09-09 晚间反馈：源码与网页交付，APK按用户要求暂缓
- 当前目标：完成照片保存、两点测量、远景标记、道路外虚线接入、输入联想及拖图保留面板的反馈修复。
- 当前进度：业务实现和浏览器检查完成。测量采用用户选择的第三版，A/B支持拖动及已有标记，坐标/朝向/夹角/高差齐全，海拔自动获取。带照片的标记选点、任务长按误切换、道路出口提前到达提示也已修正。
- 文件变更：app/page、measurement、navigation、guidance、annotations、input及文字编辑组件、controls、scripts/build-android.ps1、测试、AndroidManifest（预留0.2.20-test/code27）、docs/feedback-2026-09-09.md。未删除业务模块，旧测量存档与照片/标记格式保留。
- 验证 PASS：376/376逻辑、类型、网页和Android网页构建；地图拖动保留路线窗口；A/B拖动和已有标记选点；约390×844/实际360×780布局与44px按钮；地点/模型远景9px圆点；文字候选回填；照片保存/查看解码；在线路线508m含47m接入。
- 命令：npx tsc --noEmit；node --experimental-strip-types --test tests/*.test.mjs；npm run build；npm run build:android:web。详细日志.openai/*20260909-feedback.log，截图artifacts/screenshots/*feedback*及measurement-existing-markers-390.png。截图接口存在缩小加边框问题，不能当作像素精确或真机验收。
- 安装包：拍照独立版构建映射错误已修复，中间unsigned构建及473地形检查通过，但不是最终可安装包。本机缺下午4a94独立版签名；用户明确暂时取不到，先交付源码和网页。未替换密钥/签名、未发布APK；HarmonyOS6.1原生仍未交付。
- 当前阻碍：源码/网页无阻碍；手机相机真机验收与APK覆盖更新等待原签名。预览http://127.0.0.1:9230/，保留两点测量界面和公开地点验证样例。
- 同步 PASS：实现1ea992a及验证文档5cbdea8已推送codex/huawei-webview-touch，已核GitHub远端与本地5cbdea85aa515b75d2b9cef0d5f3bb626e8ee684一致；未合入main。直连重置后仅本次git命令使用已有代理恢复，无系统网络设置变更。此交付记录随后同步。下一步用户预览反馈；APK按用户要求暂缓。
# 0.2.19紧急交付：新增功能已接入，按用户要求停止进一步验证（2026-09-09）
- 最终交付：GitHub v0.2.19-test-standalone已公开，Release id385427489，draft=false；APK/sha256/install.md三资产uploaded且字节数与服务端digest相同。源码73d88a155ecd9c195468ffe55260adf4738d8d5f已推送codex/huawei-webview-touch并核远端相同，未合入main。下载 https://github.com/Siger1989/map/releases/download/v0.2.19-test-standalone/Shantu-0.2.19-test-standalone.apk 。后续只剩用户要求暂缓的功能验证，不需要重复打包本版本。
- 用户追加并授权：标记一级菜单系统相机、照片关联；工具测量及单点XYZ；编辑标记点地图不跳列表；减号仅删点和相连线、取消自动拼接、框选批量删点；地图缩小时地点图标缩小。
- 在D:/shantu-compat的codex/huawei-webview-touch实现。新增measurement、camera capture/provider、marker photo关联、markerScale、deleteNodes/TrackNodeBoxSelect；修改app/page、annotations/photos/tracks/objectTransform/map/controls与Android清单，详见docs/release-0.2.19.md。原D:/天气系统草稿继续保留。
- version0.2.19-test/code26。用户明确“先不验证，赶时间，打包好上传GitHub”，停止新的界面、全量回归、旧内核和真机测试，仅执行必需编译。停止前类型/Android网页编译通过；中间362通过2失败（测试自由平移手柄期望/模型DOM地图替身），已改测试但未重跑。不得声称本轮全部验证通过。
- 本轮新功能未做390/360截图或实机相机/XYZ/触感验收。回家优先测：空白点击保留草稿、相机返回关联与权限拒绝、标记缩放/命中、测量连线和XYZ保存重开、删点不补线与框选撤销、单点存档和全删保存；然后旧Chromium99与全量回归。
- 最终APK构建完成：57641149 字节，SHA256 daec594f08e65a5f2b589a947e3927441e3dcd21103fc9fbc716a8e7eaf52915；Android网页/Java/打包及脚本内置签名/对齐/473地形检查通过。下一步源码提交推送核SHA并公开0.2.19 Release三资产；新增功能仍待完整验证。
# 0.2.18交付与后续拍照/测量（2026-09-09）
- GitHub v0.2.18-test-standalone已公开，Release id385411009、draft=false/prerelease=true；三资产uploaded且服务端digest/字节数匹配。源码64e75ef321782d5a5f779447ebb5cd4881195ea9已推送codex/huawei-webview-touch并核远端相同。下载 https://github.com/Siger1989/map/releases/download/v0.2.18-test-standalone/Shantu-0.2.18-test-standalone.apk 。
- 最新追加截图：编辑标记后点地图空白退到标记列表；0.2.19需要保持编辑对象与草稿，只有明确返回/关闭才退出。
- 0.2.18/code25已完成最终构建：363项逻辑、类型、网页/Android网页/Java/APK、v2/v3签名/zipalign/CRC/532资源/473地形/原Logo通过。57,632,957字节，SHA256 b8418c9d700acc109deab699da3f354b1053b56f3e70112dea8540bef4ca9440，stage mobile/.build/apk-20260909-180727/web。
- 真实Chromium99和当前Chrome均通过390/360布局、新增/移动/解散、多选滑选、450ms拖动、删除撤销、刷新重开、关闭全图；单指同步start，40/220ms第二指使真实地图zoom12→12.8249，无误画提交。0.2.18本机APK已给用户，正在发布GitHub；真机最终体验未验收。
- 用户追加：标记一级菜单原厂相机拍照并关联当前点；工具内画线测量，显示长度/起终点/方位角，单个测量点参照模型3D控制。继续作为0.2.19实现，目前尚未修改对应模块。原工作区草稿保留。

# 0.2.18：收藏正式整合与单指即时响应（历史实施检查点）
- 用户指出0.2.17漏了收藏改版，已确认本轮把最新上方72%收藏/下方地图、树形目录、混合移动、多选滑选/450ms长按拖动、排序、解散/删除撤销、真实导出整合正式应用。此前“待确认不整合”边界被本次明确要求替代。
- 用户已实际试装0.2.17并反馈双指正常、单指变慢；按要求删除120ms识别等待，单指同步开始，第二指立即取消未提交笔画并优先接管缩放。24项相关手势/文件夹检查通过。
- 仍在D:/shantu-compat、codex/huawei-webview-touch工作，原D:/天气系统预览存档、标记/导航/鸿蒙草稿保留。新增workbenchTree/Adapter/Store与受控UI，复用原地图并监听容器resize；保留几何/时间/来源/旧存储键，层级/treeOrder为version1可选元数据。
- 类型、6项真实收藏数据/冲突/回滚/撤销/导出检查、Android网页构建通过；390×844/360×780正式上方列表/下方地图布局与无横溢通过，当前继续触摸和实际保存重开验证。版本0.2.18-test/code25，尚未构建最终APK。
- 0.2.17仅本机交付，GitHub草稿385393856上传57MB时超时，未公开；不再发布该中间包，后续0.2.18替代。下一步旧Chromium99与当前浏览器、全量/最终APK、签名资源、代码推送与Release公开验收。

# 鸿蒙4.2网页兼容性与双指手势（历史0.2.17检查点，被0.2.18替代）
- 用户提供HarmonyOS 4.2.0.189和“需要更新系统网页组件”截图，确认APK已启动、被MainActivity的WebView包版本首段<120拦截；不再按安装失败或鸿蒙6.1处理。用户明确要求软件自行兼容、双指手势一起修复并交付新APK。
- 独立工作树D:/shantu-compat，分支codex/huawei-webview-touch，基线76b57ba。原D:/天气系统全部收藏/导航/标记/鸿蒙草稿和预览数据保留；本轮仅提取已授权的DrawingGestureBridge草稿继续修复，不包含待确认收藏改版。
- 已移除Android厂商包版本拦截；新增modules/compatibility真实能力探测/AbortSignal兼容、mobile/bootstrap/compatibility启动与布局适配；APK网页目标Chrome99，补充:has/dvh/颜色回退，独立编译地图公共worker。版本0.2.17-test/code24，沿用既有签名约束，无新签名、存储格式或定位接口变更。
- 手势120ms缓冲，完整回放单指早期采样；第二指无论早晚均取消本次未提交笔画，全部抬起才恢复画线，保留已提交线段。第一指不preventDefault，让MapLibre原生双指识别器全程接收触摸。
- 最终类型、351项逻辑、网页/Android网页/Java/APK均通过。真实Chromium99.0.4812.0和当前Chrome用最终APK stage网页验证390/360地图、收藏/路线窗口与无溢出；独立真实MapLibre触摸夹具40/220ms双指均缩放12→约12.82，无误画提交，单指恢复。旧内核选择器兼容采用独立构建规则，未引入会全局修改querySelector的css-has-pseudo库。
- 最终APK/Shantu-0.2.17-test-standalone.apk：57,620,669字节；SHA256 46f956d89cd558d10f76af5cdea0531d2adbfab8dd74b502edf86bde411ca3f2。4a94独立签名/v2/v3/zipalign/CRC/532网页资源（470PNG像素相同）/473地形/原Logo均通过；无QA或私密文件，stage mobile/.build/apk-20260909-173835/web。下一步推送codex/huawei-webview-touch并公开v0.2.17测试Release核资产digest；不合入main以免覆盖原工作区未确认草稿。ADB无设备，朋友真机仍待验；6.1原生未交付。

# 路线规划流程核查与排布建议（2026-09-09，方案已整理，业务待实施）
- 用户反馈选点后拖图关闭、缺少保存可编辑轨迹入口、规划结果缺少旧导航详细数据，要求思考排布；明确“主要是保存可编辑的轨迹”。本轮先核查并整理方案，不宣称业务已改。
- 0.2.16最终资源9220/390×844已复现：picking结束后ControlDock恢复外部pointerdown关闭；规划成功onShow又主动关窗。真实步行1.6公里/21分钟结果只有小提示；进入NavigationStart后可见海拔曲线及6统计，能力已有但入口藏得深。收藏道路计划与可编辑轨迹库仍分离。
- 建议：顶部地点设置→底部统一路线摘要（导航/保存轨迹/改地点/详情）→按需详情；保存后同一卡片进入现有轨迹编辑/标记体系。来源明确为规划轨迹，保存完整线路与地点/模式，编辑线形后旧转向失效。
- 文档docs/route-planning-layout-proposal.md；本地四步截图及artifacts/route-layout-review.md已保存并目视确认。用户9216标记编辑草稿和六个鸿蒙草稿保留；没有实际GPS导航。只新增方案/状态说明，无业务删除、版本提升或新APK；当前安装包仍0.2.16。
- 下一实施轮先修面板生命周期，再做规划转轨迹适配、统一摘要/详情，随后保存重开/旧备份/改线转向回归、两手机尺寸与最终构建发布。源码基线971040a，与origin/main一致。

# 当前交付：0.2.16独立测试版已公开（2026-09-09，PASS）
- 导航可直接选择已有标记，选点面板保持可见；普通地点箭头对准实际坐标，顶部/路线搜索结果改为不透明。实现提交61e0449a14b183330b10728fa7e9a69d49619cc0已推送main并核远端一致；本节随后以文档提交同步。
- GitHub Release v0.2.16-test-standalone，id385233071，draft=false/prerelease=true。APK、SHA256、安装说明均uploaded，服务端digest/字节数与本地一致。下载 https://github.com/Siger1989/map/releases/download/v0.2.16-test-standalone/Shantu-0.2.16-test-standalone.apk 。APK 57,607,900字节；SHA256 2df7a5ca599d11650b585eaeda1a5a377491d5e9af96c8e6069776d53d637862。
- 341项逻辑、types、网页/Android/资源签名及390×844/360×780验证通过；10行导航地址滚动、取消/Escape、地图拖动、普通标记编辑、真实搜索结果均检查。最终APK资源预览9220，index-DcVhx8LQ.js；未更改既有浏览器存档。
- 可覆盖同签名0.2.15及此前4a94独立系列；与原系列0.2.14并存、数据独立。Android真机未验，HarmonyOS6.1原生仍未交付。原始六个鸿蒙草稿保留；无其他待发布代码。下一步用户手机安装与体验反馈。

# 导航地图选点、地点箭头与搜索可读性（2026-09-09，发布前核验通过，历史检查点）
- 用户要求起终点/途经点可选已有地图标记，选点时保留界面，地点图标箭头对准实际落点；追加地址搜索下拉框不透明。已核main与origin一致8791e64，保留六个原始鸿蒙草稿。
- 修改navigation/RoutePanel/useNavigation/navigation.css、map/TerrainMap、annotations/AnnotationLayer/annotations.css、controls/ControlDock/modern.css、app/page；版本0.2.16-test/code23。保持导航面板并接收标记名称和坐标；普通pin底部箭头尖端锚定坐标；搜索结果不透明。路线服务、模型高度投影、照片、存档、签名、原Logo未改，无业务删除。
- 类型、341项逻辑、网页/Android网页/Java/APK通过；390×844/360×780、10地址滚动、标记/空白选点、拖图/取消/Escape与搜索实色通过，记录docs/navigation-map-picking.md与design-qa.md。
- 最终APK/Shantu-0.2.16-test-standalone.apk：57,607,900字节，SHA256 2df7a5ca599d11650b585eaeda1a5a377491d5e9af96c8e6069776d53d637862；原4a94独立签名、包名com.guanyun.weather.shantu.preview/code23，v2/v3/zipalign/ZIP CRC/526资源/470PNG像素/473地形/原Logo均通过。stage mobile/.build/apk-20260909-124539/web。
- 新增模块及发行文档，未删除业务；六个原始鸿蒙草稿和用户浏览器数据保留。最终stage预览9220（390×844，index-DcVhx8LQ.js）再次验证已有标记填入终点、面板唯一和无横溢。下一步源码推送与v0.2.16-test-standalone Release上传验收；Android真机未验，HarmonyOS6.1原生仍未交付。

# 当前交付：0.2.15独立测试版已公开（2026-09-09，PASS）
- 标记紧凑摘要、基本/位置/资料三页、事务编辑、逐轴回正和原Logo已完成。实现提交b6c5d3a5c047b78a1703f8780919eb0b2e1ab2c0推送main并核远端一致；本节随后以文档提交同步。
- GitHub Release v0.2.15-test-standalone，id385225040，draft=false/prerelease=true。APK、SHA256、安装说明三资产均uploaded，服务端digest/字节数与本机一致。下载 https://github.com/Siger1989/map/releases/download/v0.2.15-test-standalone/Shantu-0.2.15-test-standalone.apk 。最终APK 57,607,900字节，SHA256 8dab030817f461fecc836002cd5ad0cf220b431790d5e15238ebacfce5725751。
- 本机已有4a94独立签名，com.guanyun.weather.shantu.preview/code22；可覆盖同系列独立版，与原系列0.2.14并存、数据独立，不能覆盖它。不把本次交付称原系列升级；Android真机未验、HarmonyOS6.1原生仍未交付。
- 341项逻辑、types、网页/Android/资源签名验证通过；手机尺寸/失败重试/单轴/控制器/键盘焦点等见下方检查点与design-qa.md。交付预览http://127.0.0.1:9218/，IAB 390×844，用最终APK构建stage原始web资源；已检查canvas/Logo/无横溢。9215/9217既有用户页面与数据保留；9216验证页面也保留，不清存档。下一步手机安装反馈；无其他待发布内容。

# 标记UI与新Logo实施及最新APK（2026-09-09，发布前检查点）
- 最终代码已完成。341/341逻辑、types、网页/Android网页/Java/APK构建通过；浏览器390×844/360×780、保存失败重试/放弃切换/逐轴回正/控制器读数/删除取消/导航返回通过。360×430压缩视口修复后，备注y168..212与保存共同可见；并非原生键盘/真机验收。
- 原系列a3aa密钥在本机不可用：默认mobile/.build/guanyun-test.jks实际为4a94独立系列，原系列构建被证书保护拦下。最终以已有独立签名构建0.2.15-test/code22，com.guanyun.weather.shantu.preview、安装名山兔测试版；与原系列0.2.14并行安装/数据独立，不覆盖、不自动迁移。源码原系列包名和签名约束保留。
- 最终APK/Shantu-0.2.15-test-standalone.apk：57,607,900字节；SHA256 8dab030817f461fecc836002cd5ad0cf220b431790d5e15238ebacfce5725751。v2/v3、zipalign、ZIP CRC、526资源逐项、470重压缩PNG像素/473地形、原Logo像素通过，无QA页/私密构建文件；final stage apk-20260909-122159/web。之前同版本中间包不发布。
- 新增annotations窗口/字段/事务数学/CSS/9项测试、Logo与模块/发行说明；调整useAnnotations、app/page/layout、TerrainMap、ObjectGizmo和Android图标/版本。路线/照片/GPS/旧存档与备份未改，无业务模块删除。临时mobile/qa-marker-0215入口已删；六个原始鸿蒙草稿保留。design-qa.md及4张比较板完成，原图与实际截图对比通过，资料页因高度约束内部滚动。
- 下一步：提交推送main核远端SHA，公开v0.2.15-test-standalone Release并核三资产digest。GitHub CLI未登录，已验证既有git凭据具备目标仓库推送权限；凭据只在内存用于同仓库API，不写日志。Android真机未验；HarmonyOS6.1原生HAP/APP仍未交付。
- 接续：新任务已核对未提交实现与origin/main一致的基线4943e9f；保留所有原始草稿和Logo。补齐X/Y地点控制器、拖动进入事务草稿、跨标签冲突检查、轴标题两行共用和确认框键盘焦点。新增8项编辑事务/旋转/逐轴回正/跨180经线回归全部通过；类型首轮通过，全量与浏览器QA进行中。
- 全量340/340通过；保存失败/重试、切换对象放弃、单轴回正浏览器通过。正式预览9217复现面板重复，定位AnnotationWorkspace与ObjectGizmo兄弟节点key相同，改为独立前缀后正式构建复查card=1/gizmo=1。9217后来出现非本代理新增的地点与地图拖动，视为用户页面/数据保留，不刷新或清除。
- 当前独立预览9215（本轮出现标记，按用户数据保留）；隔离QA9216含显式验证样例，临时mobile/qa-marker-0215.html与tsx在最终构建前删除。API3108本轮启动。下一步两手机尺寸/压缩键盘视口/保存失败恢复、确认图对比、最终APK签名资源校验、提交推送与Release。版本已为0.2.15-test/code22，尚未发布。
- 用户明确要求“你把UI改了，然后打包最新的”，已授权实施一级摘要卡v2和二级紧凑三页v3；新增应用Logo以用户提供兔子/山路原图为准，原图已复制public/brand/shantu-logo.png。
- 范围：annotations分层窗口/编辑草稿/逐轴回正，objectTransform控制器读数与草稿联动，首页接线及品牌/Android图标，版本与发行说明。模型特有尺寸/地表内外参数保留，路线/照片/旧存储/签名不改。预定0.2.15-test/code22，最终以实际签名构建与发布校验为准。
- 当前已读取现有结构和四张确认参考；使用图片转代码流程。下一步模块化实现、必要逻辑回归、390×844/360×780及键盘/保存失败实测、最终构建/发布。右侧用户9174页面与数据、六个原始鸿蒙草稿保留；鸿蒙6.1原生仍无可交付包，不把APK当原生。

# 华为安装兼容性调查（2026-09-09，包级核查完成，设备根因待报错）
- 用户反馈 P70 Pro 安装不了，另有 Pura X Max；确认两台系统分别为鸿蒙4.2（安卓兼容）与6.1。先按系统分别处理，已询问4.2完整报错、包文件名和安装/启动失败阶段，尚未收到，不能宣称已定位或修复。
- 实际下载GitHub公开v0.2.14 APK并核服务器digest：55,219,775字节，SHA256 a5a13e86c26671a819082950669748cc40da53ed8d03217f029e0358eda917ff。aapt2 min26/target35/code21/原包名；apksigner API26—35 v2/v3通过、证书a3aa与原配置一致，zipalign通过，532 ZIP项/单DEX/无lib CPU专用库；Android壳无GMS依赖。尚无证据归因最低系统、芯片库或发布包损坏。
- 官方核查：4.2按来源限制/签名/完整性及具体错误分流，target35不等于最低Android15；6.1原生交付仍缺完整工程及签名/分发验证，APK只能按卓易通实际支持试装。不可把下载或签名通过当作手机验收；不先卸载旧版丢数据。
- 新增docs/huawei-install-compatibility-2026-09-09.md；更新docs/harmonyos-6.1-install.md至0.2.14下载并澄清六个uvue/UTS草稿非完整工程。仅文档与状态，无业务/版本/签名/数据/UI变更，无新APK/HAP；日志.openai/huawei-*20260909.log。右侧用户页面与六个草稿保留。下一步根据4.2失败原文定位，6.1按原生容器适配/合法签名/邀请测试推进。

# 标记层级讨论中（2026-09-09，未实施UI改动）
- 最新候选为**v3统一密集布局**：用户要求所有页继续压缩空隙，位置每个数值单独回正、顶部也缩小。三页合并顶部为“返回 / 基本 / 位置 / 资料 / 保存”一行；位置保留两行三列且6个数值各有回正图标，基本改为名称一行+图标颜色一行，资料压紧五行属性和备注。当前图片docs/visuals/marker-{position-matrix,basic-compact,data-dense}-v3.png；说明与提示词marker-editor-previews-v3.md。已目视核对，等待用户确认；无业务实现/数据变更/APK。v2为讨论历史。
- 最新反馈与预览：用户先要求讨论每项功能，再明确位置主要由既有3D控制器操作，面板做同色轴数值微调；资料页可更大、属性密集展示。用户随后否定平移/旋转切换和大空隙，已重做为**X红/Y绿/Z蓝三列，位移m/旋转°两行同时显示**，去掉模式切换、步长、多余操作栏和说明。最终docs/visuals/marker-position-matrix-v2.png；基本marker-basic-compact-v2.png、资料marker-data-dense-v2.png同目录，说明与完整提示词marker-editor-previews-v2.md。三页待确认，未实施业务。
- 前文“地图移动只留取消/确认、不用三维控制”的建议已被本次用户指示替代。源码普通pin当前只启用X/Y拖动，完整XYZ及旋转模型可用；预览是候选布局，按对象类型处理数值和Z高度仍需后续定义，不宣称普通点Z功能已实现。右侧390×844原页面与数据保留。
- 最新状态：用户已确认一级摘要卡v2（含标题栏小号删除、首层无需滚动），要求继续下一层。依照**每次先出当前层级效果图、确认后再推进**的顺序，已用image_gen生成docs/visuals/marker-level-two-edit-v1.png：二级编辑框架及默认基本页，顶部返回/保存，基本/位置/资料分组，只展开名称/图标/颜色；说明与提示词见同名.md。当前等待二级框架及基本页确认；“保存后生效”为提案，业务仍未实现。位置/资料展开、导航、详情未继续设计。
- 用户要求右侧打开应用并持续保持手机比例，随后明确先像昨天那样核对标记的层级、顺序和逻辑。IAB tab1为http://127.0.0.1:9174/，视口390×844已核对并按要求保留；用户同期操作，勿清理数据、强刷或擅自恢复视角。
- 本次观察信息/属性/外观/位置/更多/地图操作态，截图artifacts/screenshots/marker-audit-*-20260909.png。已确认重复工具头与位置入口、资料和操作混放、普通地点出现三维参数；源码确认参数即时保存，尚无编辑草稿保存/放弃语义。
- 新增docs/marker-ui-hierarchy-2026-09-09.md，含现状与建议层级图、6个观察步骤、返回/保存/新建规则。**用户已确认一级摘要卡→导航/编辑/详情，并要求一级无需滚动**：只留名称、简短位置、海拔与三项操作；长文本截断，完整坐标/地址/属性/备注放详情。二级编辑、移动、详情及模型分流仍待逐层讨论，不直接实施。
- 本轮仅讨论文档与状态记录，无业务修改/删除或新APK；390×844截图及DOM检查，不代表360窄屏、键盘、读屏或真机验收。六个原始鸿蒙草稿保留。

# 更新说明长图已完成（2026-09-09）
- 用户要求清爽、详细、图文并茂地展示当前迭代。已核对0.2.11—0.2.14发行记录，并实查GitHub 0.2.14 Release为公开测试版、三项资产uploaded；当前源码基线6318221。
- 使用内置image_gen制作并完成白底清晰度调整；最终图片docs/visuals/shantu-iteration-status-2026-09-09.png（1024×1536），含四版时间线、六块功能示意、验证与待办、安装说明。已目视核对版本顺序、关键数字、底部状态和文字可读性；说明、来源与完整提示词见同名.md。
- 仅新增说明图片/文档，不改业务或生成重复APK；六个鸿蒙原始未跟踪草稿和用户数据保留。图中为功能示意，非真实界面截图；332项测试引用既有交付记录，本轮未重跑。

# 公司继续工作交接（2026-09-09）
- 用户最新指示：先上传GitHub，到公司再弄；地点标记UI优化暂缓。本轮仅查看源码及当前页面，没有修改业务代码或用户标记数据，不生成重复APK。最新可安装版本仍为0.2.14-test/code21，下载见下方。
- 下一项待办：地点标记操作层级与紧凑布局。初步源码发现信息页集中图标/名称/7级地址/自定义属性；“调整坐标”“地图重选位置”“地图调整”入口含义接近；更多页混合备注/复制/删除。尚未完成截图审查、方案确认或实现。
- 曾询问一级卡采用“先查看名称/位置/海拔＋导航/编辑/详情”还是“直接编辑名称/图标/颜色”，用户选择暂缓而非确认任何方案。到公司后需先复盘并确认这点，不得视为设计已定。
- 公司接续：在该电脑实际仓库目录先git status和git diff --stat、读取本文件；工作区干净再git pull --ff-only。不覆盖公司电脑未提交内容。存档为各浏览器/手机本机数据，Git源码同步不等于同步个人路线与照片。
# 当前交付：0.2.14 已公开测试 Release（2026-09-09，PASS）
- 已完成确认的路线四窗口、事务编辑/跨线组合、导航方案同步；追加起终点缩略图、上移紧凑进度条、精确分叉画线、详情确认删除和左侧天气小卡。原包名/签名/存储键保持兼容。
- 实现提交59013ff，最终构建源码c4ddf06fa4a8cf97d98cb3e2a00dd9c0d11ba05b已推送main并核远端一致。Release v0.2.14-test，id385127995，draft=false/prerelease=true；APK、SHA256及安装说明3项均uploaded，服务端digest和字节数核对通过。
- 下载：https://github.com/Siger1989/map/releases/download/v0.2.14-test/Shantu-0.2.14-test.apk 。版本code21、com.guanyun.weather.preview；55,219,775字节，SHA256 a5a13e86c26671a819082950669748cc40da53ed8d03217f029e0358eda917ff。签名a3aa453c…cd29c，可覆盖原系列，不能覆盖0.2.11独立版。
- 332/332逻辑、tsc、网页、APK及v2/v3/zipalign/CRC/525资源/496PNG/473FABDEM通过；390×844和360×780界面、返回、手势/闭环/撤销、组合、保存失败、取消删除、进度卡拖动检查通过。最新源码仅Manifest末尾空行规范化后重构建，发行说明已更新最终hash；中间f4a8构建不交付。
- 真实截图artifacts/screenshots/weather-preview-0214-360/390.png、route-delete-0214-360.png、route-details-delete-0214-390.png、route-branch-precision/closed-0214-360.png；三张对比板和design-qa.md完成。正文已展示紧凑天气卡和分叉编辑；没有把空海拔或失败预报当作真实数值。
- CUA中断已恢复。右侧9192手机比例预览保留为交付标签，用户9191原标签/数据/草稿未清除或强刷。9192中后来出现新增组合和标记，保留全部数据，不再把来源视作可随意删除的测试数据。后台启动策略拒绝后已改前台exec服务；没有改系统设置。
- 当前阻碍：无。下一步手机安装体验。Android真机触控/GPS实走/性能未验收；HarmonyOS6.1原生HAP/APP仍未交付（缺工程/工具链/签名与分发验证）。本节发行回执随随后文档提交同步。
# 当前任务：按确认图实施路线四级窗口并发布 0.2.14（2026-09-09，进行中）
- 用户已明确 IMPLEMENT：一级路线卡四按钮（导航/添加标记/编辑/详情）、紧凑导航准备及海拔统计、地图底部编辑及常驻样式、只读详情顶部分享；所有窗口固定返回。绿点为选中位置，不是GPS。
- 编辑选中直接拖点，点分叉固定起点并显示其他可见线的候选节点；跨线保存新组合，隐藏但保留来源；所有编辑/样式暂存，保存成功才退出，未保存返回可保存/放弃/继续。原路备选与导航/曲线一致。
- 本轮要交付0.2.14-test/code21，原系列签名。已读AGENTS/README/LOG/状态，git status/diff干净，pull最新；前端使用已确认图片，不生成虚假业务图片/示例数据。用户9191 tab3当前 editing=false，存档与标签保留；在隔离预览回归，不清理用户数据。
- 参考图：generated_images/01a080eb-2592-7761-a05c-293d73fca4b1/exec-f5644e8d-0018-4fb4-bf47-d5c050b4bf20.png（导航/编辑）、exec-f76af2d7-c837-4cd4-8dd0-1f322ffc7898.png（一级/详情）、exec-3a624207-783f-47d5-b583-2231363cfe61.png（移点/分叉）。位于C:/Users/sigeryang/.codex/，已在对话看图确认。
- 当前阶段：事务编辑/来源关联/隐藏状态及四窗口已接线，类型检查PASS，编辑7项PASS；首轮全量320/322，发现旧端点容差主线截断与同点错误提示，已定点修复，正在回归。独立9192新来源，不动用户9191存档。下一步两尺寸实际UI截图与APK。任何布局更新输出真实运行截图，正文嵌入；不能仅依赖工具图块，用户此前看不到。

# 当前任务：路线 UI 层级审查与脑图（2026-09-08，文档完成 PASS）
- 用户要求先梳理路线点开后的混乱层级、给脑图、整理之前 bug；本轮只审查，不实施改版，不改变业务源码或版本，不生成重复 APK。最新业务 APK 仍为 0.2.13。
- 启动 git status/diff 干净，pull --ff-only 最新；读取 AGENTS/README/状态/LOG 与相关路线、节点、导航模块。使用产品流程审查，用户上下文 preflight 无已存内容；首个脚本路径不正确已定位并纠正，未写持久用户偏好。
- 新增 docs/route-ui-audit-2026-09-08.md：现状与建议脑图、四状态路线卡、何时能导航、10 个待处理问题、历史反馈版本归档、实施顺序和验收场景。
- 重要发现：三套地图操作栏与管理面板混排；备选浏览未传入导航选择；里程口径不一致；分叉按链数误显示未连接；complete 忽略保存失败后仍退出编辑。前两类有当前 UI/代码证据，保存失败为代码审查未制造故障。
- 当前 9191 只进行详情/导航准备/关闭等可逆查看，未启动定位、写路线、清理存档或刷新页面；用户可能同时操作，不将返回目标变化判为稳定复现。捕获 4 个重叠进度组件（DOM 确认，源码仅一个调用），先列待生产复现，不能直接归因 APK；导航准备焦点仍在背景也列待验证。
- 截图 artifacts/screenshots/audit-route-01-linepoint.png、02-details.png、03-navigation.png、04-selection.png（均带 audit-route- 前缀）；已逐张检查为正确内容。IAB 截图缩放在左上，文字另核 DOM，不据此声称像素/对比度或真机触控合格。用户图片不上传仓库。
- 验证：证据与代码对应 PASS；git diff --check PASS（仅换行提示）。文件仅本文与审查文档；不重跑无关业务构建。阻碍无；下一步同步文档并交付脑图，UI 实施留待后续明确任务。

# 当前任务补充：0.2.13分叉闭环、节点直操、紧凑备选进度条（2026-09-08，已公开交付PASS）
- 三项用户追加均已实现。315逻辑PASS、types PASS；左侧多条进度轨道合用44px宽的触控区，每条视觉10px，顶端44px按钮循环切换，拖动按下时锁定所选轨道。节点工具条268px宽、6个44px按钮。
- 注意：用户已开始在原独立QA9191页面画真实路线并打开分享，故该来源现在视为用户数据，不能清理其localStorage/关闭或强制刷新丢失草稿。原9178也保留。qa-branch.html还在mobile中，是临时入口，不打入APK、不提交；最终应在保留9191来源数据的前提下转为普通入口，若仍在编辑则不强制刷新。
- 新增alternatives.ts与tests/track-alternatives.test.mjs；修改TrackLayer、TrackJourneyRail、TrackNodeTools、draft/useManualTracks/snapping/linePoint、CSS和app接线。Android版本0.2.13-test/code20，沿用本机原系列签名。下一步最终UI回归、网页与APK构建/签名资源校验/发布，阻碍无。
- 最终PASS：网页与APK构建、签名v2/v3/zipalign、525资源/496PNG/473地形CRC比对；APK55,117,375字节，SHA256 4e835c1eb58bf075532a09569009db551cbc328c46c87ffd92a49129ca912b4a。日志logs/*0213*。独立9192真实组件增删、草稿分叉/接回/保存同ID通过；完整地图原578m→备1023m、End100%、颜色/淡化和节点工具条通过。截图detour-rail-0213-360.png、node-toolbar-0213-360.png、node-detour-0213-390.png；两尺寸无横溢，轨道44px/工具条268×50px。9192临时页与脚本已删除、服务/标签关闭；9191页面已被用户用来画真实线，继续保留服务/页面/存档，qa-branch.html仅本机排除，不打包、不提交；没有清理用户数据。下一步提交发布并核服务器hash。
- 发布PASS：北京时间2026-09-08 23:35:05，v0.2.13-test（Release id384858896）已公开；源码1b2bb03d3ca9aa9773ae7d2295a5bb06643fcf04已推main并核远端一致，三项资产uploaded/大小/服务器SHA256全部一致。下载https://github.com/Siger1989/map/releases/tag/v0.2.13-test 。此行仅发布记录，不改包内源码。用户正在使用的9191预览是本轮最新代码，9178保留0.2.12静态预览以免丢失草稿，不主动刷新或清理二者；315逻辑、双尺寸UI及构建校验PASS，无真机验收/HarmonyOS原生产物。当前授权工作完成，下一步用户反馈。

# 当前任务：分叉接回旧节点闭环（2026-09-08，进行中）
- 用户截图复现：拉分叉时旧路线中间节点消失，无法精确接回闭环。git状态干净、pull最新，已读AGENTS/状态和轨迹绘制/吸附模块。
- 根因：TrackLayer在drawing草稿显式禁用选中路线的中间handle；useManualTracks候选仅端点和explicit nodes，漏掉旧freehand/road几何节点。
- 修改：TrackLayer保留选中草稿中间handle；snapping新增去重精确draftSnapNodes并接入useManualTracks。不更改旧线几何、照片、签名或存档格式。下一步回归节点显示/吸附/闭环保存与撤销、双手机UI；出0.2.13 APK并更新右侧预览。验证进行中，阻碍无。

# 当前预览：右侧PC手机比例测试（2026-09-08）
- 用户要求右侧可操作的手机比例PC预览。已打开IAB tab2，保留390×844视口，网址http://127.0.0.1:9178，使用0.2.12 APK构建的mobile/.build/apk-20260908-225414/web原始网页资源；API代理原localhost:3000，用户原服务未改动。
- 原3000页面停在SSR加载、无canvas；改用Vite preview独立9178后地图canvas生成并显示卫星。启动命令：SHANTU_DEV_API_URL=http://localhost:3000，vite preview --config mobile/vite.config.ts --outDir <上述web目录> --host 127.0.0.1 --port 9178 --strictPort；服务会话94497，日志logs/preview_apk_0212_9178.log。
- 验证PASS：DOM视口390×844、canvas同尺寸、无横向溢出；截图artifacts/screenshots/preview-0212-phone-390.png。浏览器截图有缩放呈现，以DOM尺寸辅助核对。已标记交付保留标签；这是PC网页预览，不是Android系统模拟器。无业务源码改动，本轮仅打开现有0.2.12产物，不另发相同APK。下一步用户直接操作测试；当前阻碍无。
# 当前任务：每轮改动自动更新APK，0.2.12补齐交付（2026-09-08，已公开交付PASS）
- 目标：用户要求每次改动更新APK；已写入AGENTS长期项目约定。本轮将e1d7658节点网络/彩色文件夹/卫星与方向功能打包为0.2.12-test、versionCode19。
- 启动：git status/diff干净；pull --ff-only确认最新；读AGENTS/README/LOG/状态/Android构建与平台说明。上一轮305逻辑、types、网页/Android网页及真实UI已PASS，本轮没有业务代码改动。
- 文件：AGENTS、AndroidManifest版本、README/mobile说明、发行说明与状态。验证：构建中；当前阻碍：暂无。命令/日志存logs/*0212*，下一步完整APK签名/资源校验、提交推送、测试Release及服务端哈希核对。
- HarmonyOS6.1：当前仍缺原生工程、工具链/账号签名和安装验证，发行说明继续明确未交付，不以APK冒充原生包。
- 签名修正：独立版构建正确拒绝本机a3aa原系列密钥，4a94独立密钥不在此机器。用户已明确选择“先发布本机签名的0.2.12”，改用com.guanyun.weather.preview原系列，可覆盖0.2.7，与0.2.11独立版并存。正在完整重新构建；未生成或替换签名密钥。
- 本轮最终验证PASS：新stage/web构建仅525资源和单个index；APK 55,113,279字节、SHA256 fc1868bd01057d6b03e12177cdb4b674449f59216eaee770b29fb78f03afcb92；496 PNG内容一致、473地形瓦片、CRC/v2/v3/zipalign和完整资源比对通过。types与305/305全量逻辑再次PASS。ADB无设备，不宣称真机验收。发行说明与下载入口已更新，下一步提交、推送、上传新Release并核服务器hash。
- 公开交付PASS：北京时间2026-09-08 22:57:35，Release v0.2.12-test（id384829666）已公开，draft=false/prerelease=true；构建源码提交d22eb59a2507fb9cda5a6bf2d7d9b4633d1dcefb已推送main并核远端一致。APK、SHA文件、安装说明三个资产的大小/服务端SHA256均与本地一致；下载https://github.com/Siger1989/map/releases/tag/v0.2.12-test 。本段仅补记发布验证，不改变包内源码；当前阻碍无，下一步用户手机安装体验。

# 当前任务：卫星默认、节点路线网络、导航方向与收藏文件夹（2026-09-08，验证完成）
- 目标：默认卫星影像；选中路线增删中间节点、节点连接两线及分叉；最近接入并仅在相连路线/分叉切换；导航前调整起终点方向；恢复明显文件夹分类、固定关闭和按分类颜色铺底。
- 进度：main干净，git pull --ff-only确认19b4e5a最新；已读项目说明和轨迹/导航/收藏模块。用户明确自动切换仅限相连路线和分叉。
- 文件：计划tracks节点/网络工具、guidance路径匹配与NavigationStart、collections入口/CSS、map默认值及app接线；保留录制GPS原始样本，沿用存档格式。
- 命令：git status、git diff --stat、git pull --ff-only；源码定向检查。
- 验证：节点/连接/分叉匹配/方向及旧导航15项PASS；首轮回归发现最短路让已走分叉折返，加入可靠行进方向及禁止立即折返的路径搜索后通过。首轮类型检查仅缺拉取新增依赖qrcode。
- 环境：npm ci/install被旧3000预览进程锁住原生模块；已确认仅本项目6056与其esbuild/workerd，停止后补装，完成恢复同端口。logs/dependencies*保存输出，原浏览器数据不清理。
- 下一步：依赖补齐后类型/全量逻辑/构建和390/360真实界面检查，再同步GitHub。不自动生成APK或部署Sites。
- 验证更新：依赖恢复，锁文件恢复原字节避免平台元数据变动；types PASS、302/302逻辑PASS、网页build PASS。3000预览恢复；独立移动QA使用9177代理3000（vinext限制同目录单实例），合成测试与用户来源隔离。下一步界面回归与清理临时mobile/qa-network.html。
- 最终完成：新增tracks/nodeOperations、TrackNodeTools及guidance/network、networkSession、direction；修改useManualTracks、TrackPointTools、NavigationStart/useGuidance/GuidanceCard/session、收藏入口/CSS、地图首页和图源启动选择、导航类型/格式校验。无业务文件删除；无新依赖/存储键/版本号，GPS样本、照片、签名不变。详见docs/track-network-and-folders.md。
- 最终验证PASS：oxfmt、tsc --noEmit、305/305全量逻辑、npm run build、npm run build:android:web、git diff --check。日志logs/*network*20260908*已本地排除，不提交。增加旧端点容差、闭环双向、错误network拒绝的回归；默认卫星仅首页，导出底图保持原样。
- UI PASS：独立9177真实加/减节点、连接生成第三条并保留原两条；节点拉出分叉、完成后重读主线4点和分叉2点。合成定位中段导航剩余191m，实际走向分叉后603m、终点保持；分叉端点可选，预览里程383→424m。收藏粉/绿底色与分类持久，文件夹/省市两处关闭均有效。
- 截图：artifacts/screenshots/folders-network-390.png（分类底色PASS）、node-tools-360.png（44px按钮/222×154浮栏避摇杆PASS）、navigation-direction-360.png（328×483对话框PASS）、navigation-branch-switch-360.png（分叉导航PASS）、branch-endpoint-selection.png（分叉可选PASS）、satellite-branched-route-final.png（卫星与分叉可见PASS）。390/360无横溢；IAB窄屏截图缩放，结合DOM及交互验证，最终自然视口截图正常。
- 清理/交付：两个临时QA HTML已删除，9177与测试tab关闭、视口恢复；用户原3000服务恢复并HTTP200，用户来源数据未清理。源码/说明按项目约定随本轮main提交同步，SHA见Git历史。当前阻碍：无；下一步手机体验或用户另行要求出包。现有0.2.11 APK不含此轮改动，无真机实走/触控验收，无HarmonyOS原生包和Sites部署。

# 当前交付：0.2.11最终追加已上传GitHub并公开测试Release（2026-09-08）
- 最新要求已完成：标记“信息”第一页在名称下新增WGS84坐标、地面海拔、国家/省/市/区县/乡镇/社区/道路，内部滚动，调整坐标跳转位置页。Photon附近地址缺项显示—，人工省市保留，自动名称使用当地文字。AnnotationLocation为独立模块。
- 新增密集收藏/省市与当前全选/滑选边缘滚动/确认批量删除、地图框选完整对象、2000地点+80模型、标记深底白字、Excel共享字符串/A1/地名坐标在前/空属性列、沿线绿点和行程标记、12免Key图源、透明度、浅色区域输入、小圆角、唯一定位与框内标签、准星先选择标记种类。完整文件/接口/回滚范围见docs/collections-selection-and-map-library.md。
- 最终类型检查、292/292全量逻辑、网页和Android编译打包通过。APK/Shantu-0.2.11-test-standalone.apk：**55,109,183字节**；SHA256 **1281249c2b33041ae86e1899fca848746387542b498e33a5c5acfe846c01b65b**。code18/0.2.11-test、com.guanyun.weather.shantu.preview、证书4a941b9d…；525网页/473地形/470PNG解码/CRC/签名/zipalign通过。下方66b20等均为未公开旧构建，不能交付。
- 独立QA9176：120合成地点真实导入；城市全选80/省全选120、滑选五个同时scrollTop53、单个确认删除、框选一项→收藏一项通过。实际XLSX独立openpyxl读取120行中文/数值坐标/00000/空类目/A1/左上对齐通过。
- 360×780和新tab10实际390×844均无横向溢出、44px条目/右侧标签无越界，标记第一页查得四川/成都/玉林街道；轨迹透明度5%、区域浅底深字、12图源抽样HTTP200/图像/CORS和切换记忆通过。沿线绿点223米及关联提示、此前路线照片ZIP/QR/模拟键盘/河流验证保留。截图artifacts/screenshots/*0211*，视口已恢复。
- 7页PDF output/pdf/山兔-2026-09-08-版本更新.pdf已生成，逐页渲染目视通过，文本4590字符；脚本scripts/build-version-summary.py和两张合成数据截图可复现。按今日0.2.6—0.2.11记录，明确0.2.8/0.2.10内部草稿并入0.2.11。
- 功能提交**6b9cabaab179c8b6e0f44c6bf6060815bcdec004**已推送main并核对远端一致。0.2.11 Release id384582744于2026-09-08 18:31（北京时间）公开，draft=false、prerelease=true、target为6b9c；四个资产均uploaded，逐个大小和服务端SHA256与本地一致，旧66b20包已替换。发行：https://github.com/Siger1989/map/releases/tag/v0.2.11-test-standalone 。本条交接文档随随后main提交同步。
- APK SHA256为1281249c…01b65b；7页PDF 254573字节、SHA256 63417e48ab715801cc7ee9e2bdc4414ccf6904bfb0eb91c9df732ceeecd6793e，Release资产名Shantu-2026-09-08-release-summary.pdf，中文label保留。源码内PDF与逐页检查文件字节完全一致；.gitattributes把PDF声明为binary避免换行转换。
- 当前授权工作已完成；下次开始读本节并核git状态，继续用户新反馈或真机验收。0.2.8/0.2.10继续保留历史内部草稿，不单独宣称已公开。测试输入与工具已归档到忽略的.openai/*.log，PDF逐页截图保存在artifacts/screenshots/pdf-reviewed-0211-*.png。
- 原用户9174/9175数据和服务未修改；六个Harmony未跟踪原稿保留不提交。没有连接OPPO X8 Ultra，真机相机/触控/闪烁/定位/导航/分享未验收；HarmonyOS6.1原生无HAP/APP/邀请链接，缺工具链/账号签名与安装验证。

## 以下为过程历史（以上方最新状态为准）
# 最新追加开发中：密集收藏/地图框选/导出表格/中文名称（2026-09-08）
- 正在实现：标记标签不再因地形遮挡降至20%，2000地点+80模型独立数量限制，收藏紧凑44px行、省/市/当前全选、滑动连选+边缘滚动、确认后原子批量删除、右侧框选完整对象；待类型/逻辑/390/360界面验收。
- 新反馈表格只有坐标，已改sharedStrings文本兼容、A1起排与左上对齐、地名/经纬度/海拔/属性列优先、空值留列；待独立Excel解析。查询指定Photon lang=default，在成都实请求返回中文，自动地区旧缓存会重新查询，人工名称不覆盖。
- 上批287全量逻辑通过；12免费图源样本HTTP200/图像签名/CORS通过。沿线绿点223米+关联标记+进度提示、360选OSM已实测；最后透明度/区域对比/圆角与今日PDF仍待最终验收。
- 0.2.11 Release仍私有，旧66b20 APK不可公开；继续所有追加后重构建、验证、同步和替换资产。六个Harmony原稿保留。

# 最新追加开发中：沿线标记、免费图源、透明度与手机UI（2026-09-08）
- 0.2.11上传已完成但仍私有草稿，不能公开旧66b20构建；用户继续追加，最终需要重构建/替换全部资产/核digest后发行。
- 已写入待验：轨迹线段临时绿点、不改原线；创建关联标记与里程提示/列表，JSON导入冲突ID重映射，GPX/KML/路线ZIP与Excel含行程标记。新增tracks/linePoint、TrackPointTools、TrackJourneyRail，annotations可选trackAnchor。
- 首轮285逻辑仅1个旧XLSX尾列假设失败，已改新增关联列仅有行程标记时输出，待重跑。轨迹透明度0-90%、区域浅底深字输入和chrome圆角10px已实现，待390/360实测。
- 新需求免费图源库正核官方API/CORS/使用条件；CARTO现需Key不能当免Key源，OSM在线禁止区域预取。沿线标记/图源/UI与今天逐版本PDF同批完成后重新APK与GitHub发行。
- 仅保留最初六个Harmony未跟踪草稿；9174/9175用户数据不修改，QA9176。PDF按技能生成与逐页渲染检查，尚未创建。
# 当前交付：0.2.11最终检查通过，待GitHub发行（2026-09-08）
- 新APK/Shantu-0.2.11-test-standalone.apk：55,096,895字节；SHA256 **66b20e57cc1a1fa7df357a9bc7286bfa3bc9e9830be253c6453fc89833876e0c**。版本18、独立包com.guanyun.weather.shantu.preview、原4a94证书。此前ab760…为未发行中间构建，不能作为最终包。
- 最终类型/281全量逻辑/网页构建/Android网页与全部Java/native APK通过；ZIP CRC/525资源/473地形/470PNG解码一致、V2/V3签名和zipalign通过。ADB无设备，无OPPO真机验收。日志.openai/*0211*.log。
- 路线详情2照片→真实ZIP→解压CRC/4个原时间海拔GPX点/Excel/1200×2670地图/QR还原4点通过；收藏2条ZIP仅含选中模型+路线及2照片。照片副本质量明确，JSON保留模型完整参数，ZIP不是直接导入格式。
- 390/360、键盘剩余390×450/360×430、44px字段无横向溢出；编辑不叠ObjectGizmo。准星22px居中、加点按钮44×48，直接进信息页。河流默认关/更多吸附折叠、真实锦江3操作点沿河保存429m、山区50m色阶无渲染错误通过。截图artifacts/screenshots/*0211*。
- 涉及files/collections/photos/routeShare/tracks/annotations/map/terrain及Android输出；无业务删除。原定位记录/照片存储键/地形采样/签名兼容；使用和文件接口详见docs/route-photo-archives-and-river-snapping.md。README/mobile/发行说明已更新。
- 实现提交90c7525d839fb474c150726407f0c1ed79972005已推送main并核对远端一致。0.2.11草稿已创建，正在上传APK/sha256/发行说明；待核服务端digest后公开。0.2.10保持内部草稿，不作为新增交付。
- 用户9174/9175数据与服务保留。独立QA9176新增测试轨迹/照片/标记，未修改用户数据；视口已恢复。六个原始Harmony草稿保留不提交；HarmonyOS6.1原生无安装包/邀请链接，缺工具链和账号签名。

## 本轮过程记录
# 最新追加：0.2.11开发中（2026-09-08，0.2.10仍为未公开草稿）
- 首轮验证通过：281全量逻辑、类型、网页构建；Java ArchiveTransfer 9MB/UTF-8/乱序/未完成/越界/取消检查通过。真实UI导入含时间轨迹，结束后添加2张带明确时区EXIF照片，详情显示2缩略图；实际下载ZIP 588372字节，解压CRC/2照片/4原始时间海拔GPX点/XLSX/1200×2670路线图通过，图片二维码可还原4个点。
- 390/360与模拟键盘剩余430/450高检查通过：输入完整可见，无横向溢出，编辑时不显示ObjectGizmo；输入触控高度改44。单模型导出入口、收藏2条多选ZIP已接入，待其实际ZIP、河流实景和分层着色截图，然后最终APK构建/哈希/同步发行。新截图 artifacts/screenshots/*0211*，模拟不等于真机验收。
- 用户再加河流吸附：画线设置“更多吸附”折叠项，默认关，与道路互斥。只读已渲染waterway中心线，复用弯曲路径和分段连接；水系缺失/断开不自动跨直线。正在实现与验证。
- 暂停公开0.2.10，c9d0333已推送，正在补用户最后追加：收藏多选ZIP；中心准星直接加点；键盘输入时标记编辑避让；所有单独标记/模型/轨迹分享导出；等高线逐级色阶；路线信息显示关联照片，ZIP含二维码路线图、照片、GPX/KML。
- 新范围涉及files/Android输出、collections、photos/tracks/routeShare、annotations/map交互、terrain着色；保持录制坐标/时间、存储键、地形采样和签名兼容。照片输出为现存清晰副本（最长边2560px），旧预览明确标注；不假称手机原片。
- 尚待实现、逻辑与390/360/键盘布局检查、新版本18/0.2.11构建、同步与测试Release。9174/9175用户数据和六个原始Harmony草稿保留；9176为独立验证页。鸿蒙原生仍缺工具链/账号签名，不是可交付包。

# 当前交接：0.2.10最终构建阶段（2026-09-08）
- 最终追加构建完成：APK/Shantu-0.2.10-test-standalone.apk仍55,088,703字节，最新SHA256 **fb2eb196cd42d7ea5b2f992f8138a6f416abdabd36a67372a48caa72efb92043**。包内已核对新增摇杆避让CSS变量和缩短提示，525资源/473地形/470PNG/CRC与签名通过。下方9d6342…是未发行旧构建，不能交付；现在需要替换草稿的APK/sha256/发行说明并更新target到新提交后公开。
- 追加两项最终验证PASS：独立9176/tab6，区域浮栏390为252×100、360为222×100；轨迹编辑360为222×110，标题单行省略/提示缩短，按钮44px，与110px摇杆水平间隔12px，无横向溢出。规划面板360高296.39px、底352.39px，摇杆顶584px，互不重叠。截图area-gizmo-clear/route-panel-gizmo-clear/track-edit-gizmo-clear-0210-*.png。
- 地下50米长方体实际DEM显示完整半透明被遮挡部分和亮黄接触面PASS：underground-transparent-contact-0210-360.png。新增数据仅9176，本机用户9174/9175数据保留。视口已恢复；类型、275回归、网页重新构建PASS，正在重新生成native APK。
- 用户最新明确地下被遮挡部分也要半透明可见，仅接触面高亮：AnnotationLayer已恢复地下模型/边线depthTest=false，不因局部裁切开关改变；保留DEM接触面和侧壁。下方“开启裁切时使用深度遮挡”为已撤销的中间方案，不是最终行为。
- 用户最新反馈“规划区UI遮挡右下摇杆”：已暂停公开Release。源码ffa4438已推送；0.2.10 Release id384532138目前draft=true，三个旧构建资产已上传，旧APK SHA9d6342…，必须替换再公开。
- 修复仅布局：workspace.css统一110px摇杆占位和12px间隔；areas绘制浮栏靠左收窄；tracks选中浮栏/modern绘制工具限宽，按钮44px；路线规划面板降至38dvh/320px。待390/360界面实测、必要检查、重新网页/APK构建及更新哈希/资产/代码目标。
- 注意9175现在也被用户打开使用，不能清空/删除其数据。后续布局测试用新9176独立页面，保留9174/9175服务。
- 最终构建已PASS：类型、275全部逻辑（concurrency4）、网页、移动网页与全部Java/native APK，签名/zipalign/CRC/525网页资源/473地形/470PNG解码一致。APK/Shantu-0.2.10-test-standalone.apk：55,088,703字节，SHA256 9d63420d66266865323cd11b607fd26a6d5251c7e9605be7211a77ab9cc87b4f，code17；无QAHTML/环境/密钥。ADB无设备。
- 最后小UI修正已验：区域按钮白字44px/360无溢出；临时profile测试页已删除，视口恢复。README/mobile/LOG/两个新模块与发行文档已更新。下一步仅交付同步：提交推送main核SHA，创建0.2.10测试Release并核三个资产digest；旧0.2.9不覆盖。
- 最新扫码要求已实现：全部QR导入轨迹并打开SharedTrackDetails，可查看全程/真实DEM海拔/统计/起终点名称坐标；手动点击导航才弹出驾车/骑行/步行选择。真实QR图片经导入界面→详情→模式选择已通过，未启动真实GPS导航。
- Marker名称偏移已确认是className覆盖MapLibre定位类，修复后390/360截图与绝对定位检查通过。标记信息页logo优先，18SVG图标、自定义属性模板/多行值、真实XLSX导出；openpyxl独立读取中文、00123、=1+1文本和数值坐标通过。
- 全收藏五类对象导入/省市列表/批量选中导出UI通过；新增区域道路吸附三点实际形成6节点边界、闭合面积86397m²，再拉伸80m轮廓模型成功。轨迹点点击选中圈再直接拖动和撤销入口实景通过。
- 剖面JPEG真实地图导出1600×3152通过目视：上方剖面，下方俯视地图、A-D/P/保存测点及每点精确坐标表；多于100行分页逐页用户保存避免Android多选择器丢失。临时mobile/qa-profile-0210.html待删除，不入包。
- 模型地形接触使用真实DEM每模型48×48网格，亮黄交界/浅黄开挖侧壁；地下默认开启可关闭。实际WebGL裁切/关闭对比通过，修正地下透视mesh穿过开挖口前方地表的问题（开启裁切时使用深度遮挡）；无DEM不补零。为高度场近似运算，非CAD精确实体布尔。
- 地质图例关闭图层窗口后仍在，世界/地质云可选；未配置授权Token正确显示待连接而非假装已加载。360各新增编辑面板236px高、无横向溢出；截图见artifacts/screenshots/*0210*，不等于OPPO真机验收。
- 275项全部逻辑PASS（--test-concurrency=4，8.54s），类型PASS；包括剖面冲突ID归属与含areas/regions/notes的失败批量写回滚。最后小改：区域按钮白字、清除残留选中节点圈、起终点默认文字去重复、区域复用属性模板，待构建前最终检查。
- 预览服务曾自行停止，已恢复：web API3108(exec35184)，用户Vite9174(exec5762)，QA9175(exec75395)。移动Vite增加/api代理localhost:3108（或SHANTU_DEV_API_URL），解决HTML当DEM图片的解码错误；Android仍用原LocalGateway。用户9174数据全程未清除。当前QA新tab4，旧错误页因Browser URL policy无法控制，最终可另开正常9174页面恢复访问。
- manifest已升versionCode17/0.2.10-test；尚未构建新APK、提交推送或发布，不能以0.2.9代替。下一步：删除QAHTML→最终类型/回归/网页/native APK→CRC/签名/资源/哈希→文档/commit/push核SHA→0.2.10测试Release上传并核digest公开。
- 六个mobile/harmony原始草稿保留不提交；HarmonyOS6.1原生仍未交付（工具链/账号签名/安装验证缺失）。没有OPPO X8 Ultra真机，不声明实际相机/闪烁/定位/性能验收。

## 以下为本轮开发过程记录（以上方最新状态为准）
# 最新验证进度（2026-09-08，0.2.10未出包）
- 用户最新：扫码默认载入轨迹，先看信息/海拔，手动选择导航。qrImport改为全部写tracks，新增sharedRoute可选元数据保留起终点/途经点/模式/概括尺度；app不再navigation.restore，打开轨迹详情。route-qr/selection-editing回归PASS，类型PASS。
- 标签远离坐标：AnnotationLayer.rebuild替换className会删除MapLibre绝对定位类，改classList增减业务状态，增加选择后定位类保留回归，待UI复查。
- 轮廓模型prism/ExtrudeGeometry和modelTerrain独立DEM网格裁切/亮黄交界代码已写，尚未完成几何测试/真实WebGL验证，不能宣称验收。修正浮点数组类型与裁切纹理像素状态保存/释放。
- 重要：用户已开始使用9174 tab7，含真实标记，不能再当可清除的测试页。3108原页也保留。新独立QA9175服务exec6583/tab8用于最终验证；mobile/qa-profile-0210.html仍为临时测试页必须最终删除。
- 尚待：轮廓/地形逻辑与UI，390/360全部新入口，剖面真实JPEG，全部回归/网页/APK、版本17/0.2.10、文档、commit/push和新Release。六个原始Harmony草稿仍保留不提交。
# 最新追加需求（继续0.2.10，2026-09-08）
- 用户明确把轨迹节点改为点击选中圈后直接拖动：已加activeTrackNode、TrackLayer选中圈、FeatureDragBridge.direct，仅选中可编辑轨迹立即开始；实走/有时间原始数据仍走副本编辑入口，避免篡改溯源。direct拖动/双指取消测试已加，待全量再次检查。
- 用户新增自定义轮廓拉伸模型：尚未实现。计划新prism模型类型/标准化footprint、Three ExtrudeGeometry、复用现有ObjectGizmo参数与剖面求交；从areas闭合轮廓拉伸导入annotations，不改变普通模型控制方式。
- 用户新增地下模型默认局部裁掉地表、可关闭，亮色表示山体交界，地表外模型同理布尔效果：正在分析。现TerrainClip旧适配器可参考但当前SectionSurfaceLayer不裁切；需要独立模型/地形交界模块，真实DEM缺失不补零。尚不能宣称完成。
- 首批9新逻辑测试PASS；实际生成XLSX经bundledPython openpyxl3.1.5读取PASS（中文、数值经纬度、00123、=1+1保留文本）。全量之前只有selection-editing旧DOMmock无createElementNS失败，已补mock/增加direct测试后正在重跑。
- 独立QA Vite9174服务exec57667，IAB tab7仅验证数据，已从.openai/qa-fixture-0210.json经真实导入UI载入5个对象；收藏四川→成都5项显示，390截图catalog-0210-390.png；从收藏点标记直接进信息(logo/name/fields)PASS。临时mobile/qa-profile-0210.html用于实际profileImages生成预览，尚未点生成，务必最终删除不入包。用户tab6/3108完全保留。
- Browser CUA bindings: b210 browser1,t210 tab7,vp210 viewport390x844,fs210 nodefs; tab7刚从收藏打开验证采样点。所有页面交互须CUA工具。testfixture attributes编号00123/岩性多行/原始文字=1+1，area/section/track在103.96,30.70附近；不是真实现场数据。
- 未完成/待修：收藏ControlDock标题还叫收藏路线与轨迹应改全部收藏；UI窄屏360/多选导出/区域新建长按/轨迹圈直接拖/地质关闭面板仍显示验证、剖面实际JPEG生成与坐标读图；区域造型/地形布尔需求；全部类型/回归/网页/native APK最终检查；版本17/0.2.10、新doc/CURRENT、commit push核SHA、release资产hash公开验证。
# 0.2.10实现阶段追加（尚未验收或出包）
- 当前全部需求：剖面图下加平面地图/所有保存点与四角坐标；标记logo/名称/属性模板/Excel；收藏所有地理对象省市分类批量分享；地质图例入口修复；标记新增道路吸附闭合区域并长按调点。
- 新增areas data/useAreas/AreaLayer/AreaTools，复用TrackDrawing/DrawingSession与RoadSnapper，FeatureDragBridge新增area目标；区域独立存储，不写入路线存档。闭合与拖动校验自交/退化，支持撤销。app已接入，待UI/触控逻辑测试。
- annotations新增18个SVG图标、属性行/记忆模板；files新增原生XLSX与二进制输出；collections新增统一catalog/regions/export，旧路线自定义组在RouteCollectionsPanel保留。outdoor/exchange新可选areas/regions/sectionNotes通过原导入事务，冲突ID对应区域/剖面测点保持。待验证回归。
- 已定位并修复地质入口：app map-legends hidden遗漏layers.geology；LayerPanel地质行也新增世界/地质云选择。
- 尚需：新增纯逻辑/数据兼容测试、openpyxl实际读取、剖面实际底图导出预览、390/360 UI、修正发现的问题，全部类型/回归/网页/原生APK检查；版本需17/0.2.10-test、文档/提交推送/新Release。绝不能交付0.2.9冒充新增。
- 本机用户3108 tab6持续使用，保持服务2770；后续测试用单独预览端口/浏览器页，不改用户数据。六个mobile/harmony未跟踪草稿不提交。
# 当前追加范围（0.2.10开发中）
- 剖面导出：新增profileMapData/profileMap，profileExport生成图下方俯视地图、四角A-D/当前P/保存测点坐标；加载失败明确报错，取消关闭释放地图。尚待测试/实际图片验证。
- 用户现明确授权标记logo优先编辑、自定义属性名/值增删、记忆属性模板、Excel识别导出；开始改annotations独立图标/属性/表格模块，通过data可选字段兼容旧标记。
- 用户新要求收藏纳入标记/模型/剖面，紧凑省市分类、批量分享；新增统一条目适配、地区缓存/手动归类与导出模块；旧路线自定义分组保留入口。将经props接入app，Android文件输出扩展白名单，定位/天气/地形采样不改。
- 以上尚未完成检查/构建/同步，不以0.2.9旧包冒充；下一步实现、390/360 UI与逻辑回归、新0.2.10 APK和GitHub同步发行。
# 当前追加：剖面导出下方平面地图与坐标（0.2.10待实现，2026-09-08）
- 0.2.9已公开发布：https://github.com/Siger1989/map/releases/tag/v0.2.9-test-standalone；release id384462730，draft=false，代码7693ff912f33b1988b5981e395411ef8b0cfad72已与远端main核对；3资产digest与本机一致，APK最终SHA1371ee9920f6b23daca8884631eaae1aafe7b96b1030083ada8485224bd2d374。下方“待发行”为先前历史阶段。
- 用户新要求：剖面保存图片下方加俯视地图，显示剖面边框位置及每个点具体坐标。正在核查section/profileExport、profileNotes、routeShare/mapImage以复用独立地图输出，待新版本实现/验证/重打包，不能覆盖已发布0.2.9资产。
- 用户另询问截图中自定义标记字段/复用模板与其他软件乱码如何解决：先做现有annotations/交换格式核查，区分现有能力、字段模板方案与编码/字段映射；不把截图聊天内容直接当实现指令或承诺任意软件都兼容。
- 本机预览3108运行中（exec2770），用户正在交互；保留可见tab6及服务，不关闭用户当前使用的页面。6个原有Harmony草稿继续保留。

# 当前交付：0.2.9紧凑气温、多剖面与导航分享（2026-09-08，最终验证通过、待发行）
- 气温色标默认220×60px（360视口实测），时间/色带常驻、来源按需展开；不透明度0.62→0.90并提高饱和度。气温层放在道路和国内两种地名层下方，保留可读性。最新截图temperature-compact-029-360.png；先前约120px版本截图为中间态。
- 新增sectionObjects/useSavedSection集合、SectionList、SectionCollectionLayer；每个对象独立保存ID/名称/位置/海拔/角度/尺寸/颜色/显隐，最多20条，地图同时显示并可选取，单独删除/撤销。SectionSurfaceLayer复用采样，其他对象隐藏精细刻度；SectionProfile展示当前名称。
- 单剖面旧键保持，新键shantu.section-objects.v1不存在时读取旧对象；空数组不复活旧对象。新可选objectId隔离同位置不同对象测点，旧键/历史测点保留，历史恢复回所属对象。outdoor/exchange可选sections字段提供兼容备份/冲突ID和超限事务保护。
- app通过props连接；Android返回新增路线对话框/剖面列表处理。原标记/实走/照片数据、地形采样与裁切算法、签名配置未改变，无业务功能删除。新增模块说明docs/multiple-sections.md。
- 浏览器390/360两条3828米剖面、-35°/+35°独立角度、多面同时显示、重命名、隐藏、删除/撤销及刷新恢复PASS；剖面2正确展示名称及真实交线/807.11米采样。气温220×60紧凑框、加深色块PASS；视口已恢复，3108本机预览保留（进程2770，用户可继续交互）。没有目标OPPO真机，性能/触控/相机和闪烁不能称真机验收。
- 最终PASS：类型、260全量逻辑测试、网页构建、Android网页/全部Java编译/APK构建；ZIP CRC/525网页资源/473地形/470PNG重压缩解码一致/无模拟页或密钥；签名4a94、包com.guanyun.weather.shantu.preview、版本16/0.2.9-test和两只读Provider正确。
- 最终APK：APK/Shantu-0.2.9-test-standalone.apk，55,060,031字节，SHA256 1371ee9920f6b23daca8884631eaae1aafe7b96b1030083ada8485224bd2d374。仅此最终哈希包含所有追加，中间同版本构建不发行。本机只有独立系列密钥，可覆盖0.2.5独立系列，与0.2.6/0.2.7原系列并存不自动迁移。
- 0.2.8提交6b3b372已在main，其草稿不作为最终下载；本轮待源码提交推送、远端SHA核对及0.2.9 Release资产digest/公开状态验证。6个既有mobile/harmony草稿保留不提交；HarmonyOS6.1原生包仍未交付，缺完整工具链与合法账号签名。

# 当前追加：气温图层、起点接入导航与路线分享（2026-09-08，验证完成、待同步发行）
- 用户追加：气温颜色图层；手绘/收藏/规划导航先选驾车/骑行/步行，不在起点须以同模式接入；图片包含完整路线、地名、路线统计和海拔图；通用 GPX/KML 与外部导航应用分享都要。
- 新反馈确认：手机填了起终点后规划按钮灰色。代码条件为未选择地点坐标直接禁用；现改为可点击校验并定位缺失地点，保留明确搜索结果/地图选点，未自动猜地点。
- 上轮0.2.8源码6b3b372已推送main并核对远端；APK为未公开草稿，网络恢复后3个资产digest已核对。此次新包包含0.2.8成果；保留开始时6个鸿蒙草稿，不纳入提交。
- 完成weather温度网格/图例、map/LayerPanel入口；navigation可点击校验；guidance模式对话框/同模式接入/原起点必经/重合段检查点限制；routeShare独立模块提供完整图、真实海拔图、GPX/KML与高德分段链接、离线二维码生成和预览载入。app/面板只通过props和公开类型接入；Android新增RouteOutput/RouteShareProvider窄接口，照片/记录/签名配置不变。
- 用户确认离线二维码可简化，后续要求允许大幅概括曲线；实现逐级RDP/差分压缩，保留起终点、途经点、主要范围，闭环不塌缩为同一点；明确概括阈值，原图/文件几何不变。二维码可以由图源扫码入口、工具入口或相册图片识别；损坏/超限内容拒绝，预览后点击才合并收藏。
- 起终点新增Canvas红绿标记、名称、地图顶部名称和坐标；顶部预留165px防止遮住端点，重叠名称分开。温度图例避开沿途进度带/导航卡；导航分享按钮44px。
- 最终PASS：类型、255项全量回归、网页/安卓网页与APK构建；真实成都东站→春熙路10.1km/24min规划成功。390×844/360×780预览、模式、分享/文件/链接/温度无横溢；模拟GPS+道路服务确认bicycle接入原起点，前方111米提示正确，结束导航释放定位。日志.openai/*029*.log、截图artifacts/screenshots/*029*。
- 实际底图+地形生成分享图，绿色全路线、起终点、海拔图可见；实际JPEG图片390px预览截图可由jsQR还原3个点、骑行模式和起终点名称，非仅编码器单测。浏览器视口已恢复，测试页和两个自建预览服务已关闭；临时模拟页未入包。
- APK/Shantu-0.2.9-test-standalone.apk：55,060,031字节；SHA256 f589b768803c2df7e0f227bce6055571fb6c9f0b5eaf925ac03145530ecd97d9。版本16/0.2.9-test；525网页资源、473地形、470重压缩PNG内容一致，ZIP CRC/签名/包名/两个Provider权限通过。本机4a94独立签名，可覆盖0.2.5/0.2.8独立系列，与0.2.7原系列并存不自动迁移。
- 限制：无OPPO X8 Ultra真机，实际镜头/道路闪烁/室内网络精度/导航/系统分享待安装验收；手机实测不能被桌面109秒稳定场景替代。HarmonyOS6.1原生无包/无安装链接，仍缺完整工具链及账号签名。本轮无业务功能删除，原实走时间/照片/地形资源/存储键/图源协议未改变。
- 待：提交推送main并核对远端，上传0.2.9测试Release，核对服务端资产digest并公开发行；0.2.8草稿不作为最终下载交付。
# 当前任务：手机道路闪烁、室内网络定位与扫码视野，0.2.8 APK（2026-09-08，验证完成、待同步发行）
- 用户确认道路闪烁发生于手机 APK，手机 OPPO X8 Ultra；扫码画面特别窄、像长焦、只能看到局部。先前道路排查未确认解决。
- 启动 HEAD/origin main=2b961c7；保留已有未跟踪 mobile/harmony 六个草稿文件，不纳入本次 Android 修改。未执行旧关机请求。
- 已修改地图路线/手绘/导航/定位覆盖层，通过 modules/map/overlayData 去重相同 GeoJSON 并稳定相对层序，避免每次更新导致道路地形贴图缓存失效；首轮2项回归PASS。尚不能宣称 OPPO 真机闪烁解决。
- 新增 Android ForegroundLocation/LocationFixPolicy，桥接前台自动GPS+网络/室内仅网络定位，独立于实走记录；网页 position 模块接入来源、误差、过期结果和模式入口。地图快捷菜单新增室内/自动切换；粗位置按误差缩放，不改变记录精度门槛。
- 扫码原150px/object-fit:cover确认裁切竖屏画面；改完整显示、可选镜头、重试、后置优先和设备允许时复位缩放/连续对焦。修正权限返回尚未onResume的拒绝问题和授权弹窗导致扫码退出问题。
- 最终PASS：类型、247项全量回归、9项Java定位策略、全部原生源码编译、网页与APK构建；日志.openai/*028*.log。测试新增地图接口后补齐原mock；最终相机取消回归发现重复释放，已统一出口释放并再次全量/构建通过。
- 390×844/360×780模拟定位/相机PASS：900米来源提示、范围缩放、镜头选择、完整画面、重试/关闭44px可见，无横向溢出。扫码原小面板裁切溢出已单独加高，截图artifacts/screenshots/{camera,indoor}-028-{390,360}.png。补充模拟相机内二维码→内容识别→图源预览PASS，未确认添加测试图源，无用户数据操作。
- 最终电脑山区三维对照elapsed4365→113604ms（109.239秒）：render35/sourceData114/sourceLoading80/道路事件9/错误0不变；道路加载可见。源事件与截图仅本机。无ADB设备，OPPO X8 Ultra安装、实际镜头/定位效果/道路闪烁仍未验收，不能宣称彻底解决。
- APK/Shantu-0.2.8-test-standalone.apk，55,031,359字节，SHA256 797d5eb324805f1945db73455cd1bfb17e8d396a2fe6f6836b6c401e542d19cf；525网页资源、473地形瓦片、470PNG重压缩内容一致、ZIP CRC/签名/包名版本PASS。版本15/0.2.8-test；本机只有4a94公司独立版密钥，使用-StandaloneTest，可覆盖0.2.5独立系列；与0.2.7原系列并存不自动迁移，已明确告知。无密钥改动，模拟页未入包。
- 新增docs/indoor-position-and-camera.md、docs/release-0.2.8-standalone.md；更新README/mobile/LOG/闪烁说明。无生产模块或功能删除；天气/图源/轨迹照片存档格式/记录精度/签名配置不变。tsconfig排除本机outputs工具下载与构建目录，避免HBuilderX样例干扰检查。
- 待完成：源码提交推送main并核对远端、GitHub测试Release上传与digest核对。gh CLI未单独登录，使用已配置GitHub仓库凭据在子进程内调用，不显示/保存Token。鸿蒙原生包未生成，已有适配草稿不等于可安装包；仍待完整工具链、账号签名与安装验证。保留开始时6个鸿蒙未提交文件。

# 当前任务：HarmonyOS 6.1 原生安装包（2026-09-08，路线核查完成，构建待工具与账号）
- 用户要求朋友的 HarmonyOS 6.1 可用安装包，并明确追问原生包；本轮按原生开发推进，卓易通仅为备选兼容试装。具体机型未知，无 USB 设备；用户回复没有或不确定是否有实名认证华为开发者账号。
- 起点 main=9abf224，工作区原干净、pull最新。已核实仓库只有 Android Java/WebView；PATH 和常见目录未找到 DevEco/HarmonyOS SDK/ohpm/hvigor/hdc。官方工具下载跳转华为账号登录页，用户回复暂时无法登录；未下载工具链。
- 用户提出可能用 Vue 直接转换。已核查 DCloud 官方：uni-app x 的 uvue/UTS 支持编译鸿蒙原生应用；HBuilderX 可生成工程，但仍依赖 DevEco、没有鸿蒙云打包，自动申请签名仍需华为账号授权。现有入口为 React，不能把现成 APK 或 React 源码视作 uni-app 工程。可优先验证独立 web-view 容器复用地图，业务页仍由网页内核渲染；方案尚未实现。
- 完成文件：新增 docs/harmonyos-6.1-install.md，更新 AGENTS.md、mobile/README.md、本状态。说明包含本地资源/网关、GuanyunNative 记录与文件桥接、Windows 中文路径处理、签名和邀请测试路线；卓易通仅列备选。本轮仅文档修改，无代码、依赖、资源或安装包增删，Android 签名/存档和地图业务未变。
- 验证：当前源码/移动入口和官方文档已核对，git diff --check 通过，fetch 后本地与 origin/main 均为 9abf224。没有原生工程/HAP/APP、没有开发者应用或测试邀请；本轮仅文档改动，未跑类型/逻辑测试/构建，也未做真机验证，不能报告鸿蒙已可用或道路闪烁已解决。
- 下一步：用户可登录后取得官方工具链，先完成独立容器与地图资源验证，再接入平台能力、签名和设备验证。当前缺少工具链及账号，原生安装交付未完成。文档将按长期授权提交推送 main，并核对远端 SHA。

# 当前任务：开始实走记录前选择样式（2026-09-08，完成）
- 目标：在记录窗口直接选择颜色/自定义色与线宽，实时预览，持久记住并随轨迹保存。启动status/diff干净，pull最新f1e25ee；读取README/LOG/状态与记录模块。
- 修改：新增outdoor/useRecordingStyle，用独立本机设置避免原生轮询覆盖样式；useRecording稳定合并样式，recording类型与savedRecording保留样式，app/page实时覆盖层使用实走样式；OutdoorPanel复用TrackStyleControls，modern.css局部紧凑布局。新增存档样式与GPS样本不变回归。
- 不变：原生GPS命令、定位精度、地图图源、历史轨迹、手绘偏好。尚未构建APK；此前道路闪烁根因仍待复现。
- 验证PASS：oxfmt、npx tsc --noEmit、node --experimental-strip-types --test tests/*.test.mjs（239/239）、npm run build，日志.openai/*recording-style*.log。新增回归确认保存重读样式一致、GPS样本不变。
- UI：Chrome蓝色3px选择/刷新恢复PASS；应用内浏览器自定义紫色预览PASS。390/360 DOM无横溢，顶部蓝色开始按钮44px高可见。截图初版发现开始按钮被挤到下面，已移到里程行，并修正通用按钮样式覆盖。最终artifacts/screenshots/recording-style-panel-final.png可见开始/线宽/色彩PASS；窗口可内部滚动查看预览和精度。
- 限制：Chrome截屏两次5秒超时，应用内窄屏截图画布缩放异常，窄屏采用DOM+交互验证；不声称真机验收。两测试页关闭、临时视口恢复。新增docs/recording-style.md与README说明；实现a467cd1已推送main，远端SHA核对一致。下一步手机体验反馈，无当前阻碍。

# 当前任务：道路闪烁定向排查（2026-09-08，诊断完成，根因待复现）
- 目标：定位静止时道路闪烁。启动status/diff干净，pull确认32b41a2最新；读取README/状态/LOG/AGENTS及旧调查。道路样式无动画，未发现重复重载道路源的应用代码；没有证据支持调整渲染参数。
- 修改：modules/map/renderDiagnostics.ts新增只读道路源加载/错误事件计数、地形和道路层显示条件；tests/render-diagnostics.test.mjs新增2项回归；docs/map-flicker-investigation.md、LOG和本状态记录结果。无地图UI、路线数据、图源、渲染参数改动。
- 验证PASS：oxfmt、npx tsc --noEmit、node --experimental-strip-types --test tests/*.test.mjs（238/238）、npm run build；日志.openai/*road-diagnostics.log。git diff --check通过。
- 浏览器：同山区zoom13.14的三维28.823秒窗口render=111/道路加载事件30/错误0不变，二维49.891秒窗口render=166/道路加载事件30/错误0不变。仅此窗口未复现，不能宣称已修复；两个独立测试页已关闭，用户存档未改。
- 截图artifacts/screenshots/roads-static-3d.png与roads-static-2d.png，道路存在/可见PASS；单张截图不能验证持续不闪。计数记录.openai/roads-*.log。
- 当前阻碍：待确认闪动形态、手机APK或电脑网页，以及关闭三维地形是否仍闪；下一步按用户实际设备和症状复现后最小修复。未新增APK，0.2.7不含本次诊断。代码和说明81d31d8已推送main，远端SHA核对一致。
# 当前任务：手绘与收藏导航、0.2.7交付（2026-09-08）
- 已完成：画线列表和所选轨迹直接导航，收藏规划/轨迹直接导航；适配器保留线形，收藏保留模式/途经点/步骤。显式目标避免旧状态串线；切换导航保留定位所有权，结束时可停止本次导航开启的定位。
- 修改：app/page、guidance/useGuidance与新增savedRoute、navigation/useNavigation、TrackPanel/tracks.css、CollectionsPanel/collections.css；新增3项saved-navigation回归与使用说明，README/mobile说明、manifest14/0.2.7、发行说明。存储格式、原始存档、GPS精度和图源未变。
- 验证PASS：tsc、236/236回归、网页构建、APK构建；apksigner/包名版本/473地形瓦片、ZIP CRC与707项网页资源核对通过，470重压缩PNG解码一致。日志.openai/*saved-navigation*、build-apk-027.log、verify-apk-027.log。
- 浏览器PASS：Chrome安装包网页，手绘/选中导航、收藏导航、结束、导航中1.0km切换1.8km符合所选目标。390/360文档无横溢；手绘行新增导航及收藏导航均约44×44px，修复原20px宽点击范围。独立来源测试数据已通过UI清理，测试页关闭，无用户来源存档改动。
- 截图：artifacts/screenshots/saved-navigation-manual.png（IAB启动），saved-navigation-favorite.png（Chrome收藏导航），saved-navigation-track-final.png（面板顶部，未滚动到新增按钮，仅留作界面记录）。前两图导航卡片PASS，列表按钮采用DOM与交互验收。390截屏曾超时、视口重置捕获滞后，窄屏采用DOM尺寸检查，不能等同真机触控验收。
- 诊断：IAB定位后按钮/键盘操作不送达window点击监听，Chrome同产物可正常退出；临时日志已移除。新增hook热更新曾触发开发环境hook队列错误，完整刷新恢复。无证据支持修改导航停止逻辑；资料https://react.dev/reference/react-dom/client/createRoot。
- APK：APK/Shantu-0.2.7-test.apk，78,135,358字节，SHA256 5998b13a9ad9af427fe25e975d39179f4a3bdc0685cfb48d92182dd9065a5a70；原包名/原签名，可覆盖0.2.6，与公司0.2.5独立版并存，数据不自动迁移。
- 限制/BLOCKED：ADB无设备，真实道路导航未验收；原生鸿蒙缺少工程/签名与目标系统确认，未交付；闪烁未彻底复现/解决。手绘断开的多段需要先连接，不能虚构可通行连接或转向。
- 源码已提交a190b9b并推送main，远端SHA核对一致；v0.2.7-test公开测试发行已发布，APK/SHA/发行说明三个服务端digest与本机一致，日志.openai/publish-027.log、verify-release-027.log。后续待手机实测与鸿蒙系统确认。提交身份按历史Codex/codex@openai.com仅本次命令设置，未更改全局配置。完成后不执行旧关机请求。
# 当前任务：手绘轨迹与收藏路线导航（2026-09-08，实施中）
- 用户反馈手绘/收藏均不能导航。启动工作区干净，pull确认88d0d50最新，读取说明/状态/模块。根因手绘无导航适配器、收藏列表仅打开路线；当前useGuidance只取当前规划，切换收藏并立即开始还需避免旧React状态。
- 新增guidance/savedRoute保留原几何适配步行导航，按4km/h估算时间，不调用重新规划；仅合并明确相连段，不跨越未保存的空隙。手绘顶部所选导航和列表导航、收藏每行导航接入同一启动流程，原收藏保留出行模式/途经点/步骤；useGuidance.start允许明确目标，避免同一事件取旧路线。
- 修改TrackPanel、CollectionsPanel/css、useNavigation、useGuidance、app/page；新增saved-navigation.test.mjs。无存储格式/GPS精度/签名改动。待类型、回归、双构建和360/390浏览器入口验证，再提交GitHub。此次尚无新APK；鸿蒙/闪烁此前待事项保持。

# 当前交付：APK与鸿蒙安装包（2026-09-08，Android已交付、鸿蒙待条件）
- 用户要求两种安装包发给他并上传GitHub。启动status/diff干净，远端main与本地c78197e一致；再次验证v0.2.6-test已公开，APK、SHA和发行说明三项服务端digest与本机一致，无需重复上传同一安装包。
- 仓库未找到hvigor/oh-package/build-profile工程文件或HAP产物；PATH未发现hvigor/ohpm/hdc，检查常见Huawei/DevEco目录也未找到工具链。尚无已配置的鸿蒙原生构建与签名流程，不能交付可安装原生包。已通过异步问题请求具体机型/系统版本，用户此前为稍后确认，目前仍待答复。
- 官方签名参考：https://developer.huawei.com/consumer/cn/doc/HarmonyOS-Guides/ide-signing-auto 。原生调试签名还涉及目标设备；不能把Android签名用于HAP。若设备支持Android安装，可先验证当前APK；不能宣称所有鸿蒙版本可装。
- 本轮无代码改动、无新构建。下一步收到系统版本后确定Android兼容安装或独立鸿蒙适配/签名/设备验证。最新请求未完成前不再次触发关机。
- 上轮关机后台命令返回1271，Windows拒绝非强制关机；没有确认断电完成，没有使用强制关闭选项。本机仍可用。

# 交接：同步后关机（2026-09-08）
- 用户最新明确要求弄好上传GitHub后关机，覆盖此前先别关机的要求。关机前工作区干净，main本地与远端52f6f65一致；再次验证v0.2.6-test公开测试发行的APK/SHA/说明三项digest一致，日志.openai/verify-before-shutdown.log。
- 续画和原生重复刷新优化已完成交付。地图闪烁仍待具体环境与症状复现，不宣称已彻底解决；无新代码改动或重复打包。下一次启动先读取上述待复现记录。
- 本交接记录同步并核对远端后执行Windows关机，不强制丢弃应用未保存内容；本条为执行前记录，不等于断电完成证明。

# 当前追加：地图仍闪烁（2026-09-08，确定刷新问题已优化、现场闪烁待复现）
- 交付：源码2ff45502371a12f3a526cf128eb65ecfdf534d4a已push并核对origin/main一致。GitHub v0.2.6-test已发布（非draft、prerelease），APK/SHA/详细说明3个资产服务端digest与本机一致；规范下载URL实际HTTP206、APK MIME与ZIP头PASS。日志.openai/{sync-apk-026,publish-apk-026,verify-release-026}.log。下载：https://github.com/Siger1989/map/releases/download/v0.2.6-test/Shantu-0.2.6-test.apk 。
- 发布前最终网页构建PASS。原现场地图同一实例82.249秒→188.054秒期间render=36、sourcedata=160、sourcedataloading=84均未增加，无上下文丢失/恢复，视角仍为原用户地点/52.3°方向/26°俯仰。日志.openai/flicker-idle-comparison.log；此窗口不能证明所有环境无闪。
- 用户要求先别关机并反馈地图仍闪。未执行或安排任何关机；已告知暂缓发布APK，先继续调查。续画修复与0.2.6打包记录见下，已本地提交1094b0b，尚未推送/发布。
- 已询问电脑网页或手机APK、全图白黑或局部闪；正在等待。读取当前用户tab6，只读截图，保留6条用户轨迹与3个标记，不改变用户数据/图层。
- 初次24帧截图仅覆盖0.57秒，不能据此断言稳定。现有调查文档明确上次未解决静止闪烁；正在检查渲染/自定义图层/数据刷新，而非继续用开发热更新解释APK问题。
- 连续600张用户当前页截图覆盖14.359秒，哈希全部相同；云雨/卫星/等高线/海拔着色/地质关闭，地形道路开启，无WebGL错误日志。不能排除采样外闪烁或宿主合成问题。用户具体场景问题仍未回复。
- 新增renderDiagnostics为只读地图工具提供有界事件计数，不读取像素、不占UI、不上传日志。诊断源码热更新导致一次地图重建复位，已恢复原hash视角；后续构建也会热重载，现场计数因此不能跨实例比较。无用户存档修改。
- 确认Android useRecording每1.5秒JSON解析相同原生快照仍替换record/segments，引发重复覆盖层提交。新增nativeRecordingSnapshot成功快照缓存，重复失败同样不更新状态；新定位/命令/精度提示和恢复仍更新。不是已确认的全部闪烁根因。
- 修改modules/outdoor/{nativeRecordingSnapshot,useRecording}、modules/map/{renderDiagnostics,TerrainMap}、tests/native-recording-snapshot.test.mjs及发行/排查说明。格式/类型、233项全量PASS，3项新回归覆盖重复轮询、真实更新、错误恢复；完整APK重建PASS，日志.openai/*native-refresh*.log、build-apk-026-refresh.log。
- 最终APK替换同一未发布0.2.6：75,901,898字节，SHA256 a6e9ee491b10ff3d514a3b0dc92b11b212c716585213107f4e6bc0b0eb917020；ZIP/签名/693资源核对PASS，470PNG像素一致、473地形瓦片。下方旧包hash仅为本轮初构建历史，不发布。
- 下一步待用户补充电脑或APK及闪烁形态后继续定位；不能把已发布测试包称作闪烁全面修复。无真机可连，鸿蒙原生包未生成。未关机、未配置关机或系统电源选项。

# 当前任务：选中线路直接续画并交付APK（2026-09-08，验证PASS、待发布）
- 用户要求选中轨迹后继续无需二次选择，并打包APK。启动status/diff干净、pull最新51f5b7e，读取项目状态/说明/构建脚本。
- TrackPanel顶部继续优先selectedId（含当前草稿），无有效选择才打开选择器；保持新建优先、自动存档。安卓版本升0.2.6-test/code13。修改文件TrackPanel、AndroidManifest、README、mobile/README、docs/drawing-archive、docs/release-0.2.6、LOG、本状态。
- 构建签名发现本机只保有0.2.4原系列a3aa签名，StandaloneTest被签名约束正确拒绝（.openai/build-apk-026.log）；检查项目/旧工作目录后确认公司0.2.5独立版4a94私钥不在本机。已告知用户改用原包名com.guanyun.weather.preview，可覆盖旧观云、与0.2.5独立山兔并存且数据不自动迁移。未替换签名配置或私钥。
- PASS：oxfmt、npx tsc --noEmit、node --experimental-strip-types --test tests/*.test.mjs（230/230）、npm run build。完整APK执行scripts/build-android.ps1，SDK D:/GodotAndroid/android-sdk、JDK D:/GodotAndroid/jdk-17，包含安卓网页构建、签名及清单检查。日志.openai/*selected-continue.log、build-apk-026-original.log。
- APK/Shantu-0.2.6-test.apk：75,192,962字节；SHA256 deef0966ee92b9986d901682bad02b6e1f3b1f4b544611348f1fb422467c42e6。独立ZIP CRC、689个网页资源核对PASS，470张重压缩PNG解码像素一致，内置473张地形瓦片。日志.openai/verify-apk-026.log；adb devices为空，真机安装/触控/后台定位未验收。
- 浏览器独立[::1]:3000 PASS：新建两条，选择第一条后顶部继续直接进入绘制并定位末端，无选择器；完成后第一条长度更新，第二条4.5公里与总数2不变。未选择时继续仍打开列表。截图artifacts/screenshots/selected-continue-direct.png，视觉PASS。道路续段存在此前已记录的绕行迹象，非本轮选中对象修复范围。
- 390×844/360×780 DOM布局PASS：无横向溢出，新建/继续/关闭约44px高且可达；截图artifacts/screenshots/selected-continue-{390,360}.png，工具移动截图存在既有缩放捕获限制，不作为真机验收。两条测试记录已删除确认0，测试tab21/22关闭、视口恢复，用户localhost数据未动。
- 下一步提交/push main核对远端，然后发布v0.2.6-test与APK、SHA、发行说明并核对服务端digest。此前鸿蒙机型/版本仍待确认，本仓库无原生鸿蒙工程，原生包未交付；Android当前无阻塞。

# 当前任务：新建优先、选择续画、自动时间位置存档（2026-09-08，完成验证）
- 用户要求新建作为主操作、续画可选具体线路、自动记录绘制时间和大概位置。启动status/diff干净，pull最新9fc7611，读取项目状态及相关模块。
- 根因finish仅停止交互不存档，start沿用draft。修改TrackPanel双入口与续画选择；useManualTracks完成/新建/切换前保存有效草稿，失败保留草稿；时间取开始绘制，续画保留原创建时间并记录更新时间。archive新增命名/位置生成，旧记录派生位置，新增可选元数据读取兼容。
- 文件modules/tracks/{archive,drawing,useManualTracks,TrackPanel,tracks.css}、modules/controls/modern.css、app/page、tests/track-archive.test.mjs、docs/{drawing-archive,road-segment-snapping}、README、mobile/README、LOG、本状态。使用现有usePlaceName解析起点附近地名，失败用粗略坐标，不增加服务商。
- 初轮验证PASS：新增4项存档回归（新建身份/时间/位置、指定续画、旧记录/离线兼容、单点/容量/存储异常），230/230全量、类型、网页与安卓网页构建PASS，.openai/*track-archive.log。
- 浏览器独立来源[::1]:3000（127.0.0.1连接拒绝，检查服务器仅监听::1后改用IPv6，用户localhost数据未操作）：新建两条不同起点轨迹，完成自动存档1→2，选择第一条续画，定位末端并更新长度，第二条不变、记录数仍2；重载恢复2条，主操作仍是新建。测试两条已通过删除按钮清理，已保存恢复0。
- 用户追加续画按钮不明显：modern.css给入口浅色底/蓝边框/圆角/图标与展开状态，继续所选轨迹使用蓝色主按钮；下拉选项删除重复日期地点，选中项下另显示元数据。追加样式后类型/双构建PASS；清理时发现删除所选轨迹后按钮仍可点击，增加有效选项判断、恢复占位和禁用状态。
- UI PASS：390×844/360×780无横向溢出，新建和续画同高44px并对齐，继续按钮44px、位于可见区域；桌面视觉检查确认边框/底色/图标、选中蓝色按钮。截图artifacts/screenshots/track-archive-{360,390,desktop}.png；手机截图仍有工具缩放捕获问题，DOM验证不替代真机触控。
- 未完成的单点不当作完整轨迹保存，提示补点或撤销并保留草稿。完成才自动存档；暂停/调整节点仍保留内存草稿，避免自动存档打断节点编辑。
- 下一步按授权提交推送main并核对远端SHA，记录.openai/sync-track-archive.log；无阻塞。本轮无新APK/鸿蒙包。
- 清理：空列表继续按钮禁用PASS；测试tab20关闭，视口恢复。最初连接拒绝的隐藏tab19因错误页data URL被浏览器工具策略拦截，未能自动关闭，未继续尝试访问该错误页。

# 当前任务：突出画线入口（2026-09-08，完成验证）
- 用户要求功能明显一些；已询问是画线入口还是吸附开关，暂无回复，按当前主界面缺少画线入口推进并告知假设。
- 启动status/diff干净、pull最新d68591d，读取项目状态/README/LOG/AGENTS。ControlDock底部增加独立画线，选中/关闭焦点回到画线；保留工具与路线页的原入口。modern.css手机五项使用图标上、文字下44px按钮控制宽度。
- 文件ControlDock.tsx、modern.css、README、docs/road-segment-snapping、LOG、本状态；无存储/GPS/吸附逻辑改动。TypeScript、网页与安卓网页构建PASS，日志.openai/*draw-entry.log；单纯入口/UI修改未重复全套业务回归。
- 浏览器PASS：底部一次点击画线打开面板，仅画线高亮；Escape关闭后焦点回画线；路线入口与标题切换保留。360×780/390×844无横向溢出，五个按钮均44×44 CSS像素，天气与导航无重叠。截图artifacts/screenshots/draw-entry-{360,390,desktop}.png；桌面视觉PASS，手机截图存在既有缩放捕获异常，DOM检查PASS，真机触控未验收。
- 独立tab18已关闭、视口已恢复，无保存数据修改，无新APK。下一步按授权推送main核对SHA，记录.openai/sync-draw-entry.log；无阻塞。

# 当前任务：2公里比例尺道路吸附（2026-09-08，完成验证）
- 用户在zoom11.49道路可见但无法吸附；定位roadSnap.ts硬编码zoom<12直接返回。主道路图层从zoom6显示，吸附门槛与显示不一致。
- 启动status/diff干净、pull确认ca9ba7e最新，已读项目说明。先扩展适配器回归覆盖11.49/10/8级完整弯道、距离拒绝、未加载/隐藏道路；再移除缩放硬门槛。
- 文件：modules/map/roadSnap.ts移除zoom<12拒绝；modules/tracks/roadSnapping.ts删除不再产生的zoom状态，TrackPanel说明改为已显示道路可吸附；tests/roads-models.test.mjs、README、docs/road-segment-snapping、LOG、本状态。保持距离半径、图层显示策略、缓存和道路计算上限，不改变GPS/照片/保存数据。
- 验证 PASS：新增场景先在旧代码失败（zoom11.49返回zoom而非ready，.openai/test-road-zoom-before.log），修复后226/226、TypeScript、网页和安卓网页构建均PASS，日志.openai/*road-zoom.log。
- 浏览器 PASS：独立tab17打开用户同地点#11.49/24.1926/48.0579，比例尺2km、默认两项吸附开启；起点→较远终点沿弯道连上，再点更远处可继续；3次撤销清空，结束并关闭测试页，无保存轨迹。截图artifacts/screenshots/road-zoom-2km-connected.png、road-zoom-2km-continue.png。
- 限制：真实路口线条有绕行/重叠迹象，当前验证吸附不再被缩放阻断，不宣称路口选线已精确最优；后续如需处理应单独复现路口图拓扑。未显示的小路仍需放大加载，无真机验证，本轮无新安装包。
- 下一步：按授权提交推送main并核对远端，记录.openai/sync-road-zoom.log。当前缩放问题无阻塞。

# 当前任务：只保留逐点连线，吸附默认全开（2026-09-08，完成验证）
- 用户要求移除平滑画，直接使用逐点模式，道路与节点吸附默认开启。
- 启动status/diff干净，pull已最新ff41142；已读项目说明。修改useManualTracks固定points（包括续画），roads默认true；TrackPanel移除模式标签、底部模式切换、平滑专用牵引杆与另起段入口，更新提示和线条样式标题。
- 保留既有保存轨迹及底层折线处理，不迁移存储；吸附开关仍可手动关闭。文件：modules/tracks/{useManualTracks,TrackPanel}、README、mobile/README、docs/road-segment-snapping、LOG、本状态。
- 验证 PASS：oxfmt、npx tsc --noEmit、node --experimental-strip-types --test tests/*.test.mjs（226/226）、npm run build、npm run build:android:web。日志.openai/*points-only.log。无新增依赖，不改道路寻路、GPS、照片或存储格式。
- 浏览器 PASS：新开tab16，两项吸附未操作即为开启；无平滑模式入口/牵引杆设置；直接进入逐点绘制，浮条只保留吸附、节点、撤销、完成；道路开关可关闭再开启。390×844与360×780 DOM无横向溢出，开始/关闭/绘制浮条按钮可达。
- 截图：artifacts/screenshots/points-only-panel.png（正常视口布局PASS）、points-only-390.png、points-only-360.png、points-only-toolbar-360.png（DOM布局PASS；手机截图仍有既有缩放捕获异常，精确视觉与真机触控待验证）。未创建保存轨迹，测试页关闭，视口恢复。
- 下一步：按授权提交推送main，核对远端SHA；同步日志.openai/sync-points-only.log。无阻塞；本轮无新APK/鸿蒙包。

# 当前交接：后续出包增加鸿蒙（2026-09-08，要求已记录）
- 用户要求以后生成APK时同时提供鸿蒙可用安装交付。已写AGENTS.md长期出包目标、mobile/README.md平台状态；不代表本轮要求立刻打包。
- 启动：status/diff干净，pull确认bdce7e6最新，已读项目状态/说明。当前只有Android Java/WebView原生工程，未找到build-profile.json5/oh-package.json5/hvigorfile.ts等鸿蒙工程文件。
- 已询问具体HarmonyOS版本/机型，回复待定；旧版兼容Android与原生NEXT交付路线不同。已查华为官方开发/发布资料。
- 文件：AGENTS.md、mobile/README.md、LOG.md、本状态。验证：文档范围与git diff --check PASS；仅文档无需运行构建。本次无新APK/鸿蒙包。
- 下一步：收到设备版本后确定目标；后续出包先完成相应适配、签名、安装验证并分别列明产物。原生鸿蒙开发待开展，非本轮已完成功能。
- 同步：按授权提交推送main，核验记录.openai/sync-harmony-target.log。

# 当前任务：二级UI统一与断路跨越（2026-09-08，完成验证）
- 目标：二级页面/独立浮窗统一浅色磨砂紧凑样式；用户追加道路吸附开启时允许跨越未连通路段。
- 启动：status/diff干净，pull最新c587755，读取AGENTS/README/状态/LOG。UI原因：modern.css枚举主容器遗漏独立glass浮窗，子页硬编码颜色/圆角不一致。
- 文件：modules/controls/modern.css共享glass主题、二级按钮/字体/状态、触屏绘制按钮44px；modules/tracks/{DrawingSession,TrackDrawing,TrackPanel}新增断口直线跨越与虚线预览、提示，tests/road-path.test.mjs更新行为回归；README/LOG/docs/{secondary-ui,road-segment-snapping}/本状态。
- 逻辑：有连通路径正常沿路；目标点吸附到道路但无路径时允许直线跨越，下一次仍开启吸附；取消不提交，整段撤销。目标处无可吸附道路仍需移动准星或加载道路。
- 命令验证 PASS：oxfmt、npx tsc --noEmit、226/226测试、npm run build、npm run build:android:web。日志.openai/*secondary-crossing*.log；前一轮纯样式双构建也PASS。
- UI PASS：正常视口画线浮条、行程/照片子页使用浅色磨砂；收藏新建表单12px蓝底白字主操作、返回可用，未保存测试分组；390/360 DOM无横向溢出，收藏编辑与绘制按钮在屏内。截图secondary-*.png，窄屏截图仍有既有半尺寸缩放捕获异常，精确手机视觉/真机触控待验收；无已有照片，照片全屏仅样式接入未实测。
- 跨越验证 PASS：浏览器道路吸附保持开启，将未连通道路点直线接到目标路，出现「已直线跨越断路」且可继续绘制；清理4次测试选点。跨越后恢复完整道路section、取消、撤销由逻辑回归验证。截图road-crossing-after.png / road-crossing-resume.png。
- 临时tab15已关闭，视口已恢复；无用户已有轨迹/分组/照片数据修改。图源/GPS/存储/签名保持，无新APK。
- 交付：按授权提交推送main并核验远端，记录.openai/sync-secondary-crossing.log；无阻塞，下一步用户体验与真机验收。

# 当前任务：整段沿路与按距离吸附（2026-09-08，完成验证）
- 目标：两点间整段沿道路弯曲连接；按用户追加要求主要按距离吸附，不因桥隧/道路层级断开。
- 启动：status/diff干净，pull已最新6516a1a，已读项目说明。原DrawingSession只输出端点、预览/保存直连；初版过严区分layer，真实区域MVT证实桥头因此断连，最终改为距离连接。
- 改动：roadPath本地道路图最短路径、3米端点接缝；roadSnap缓存已渲染道路；DrawingSession/TrackDrawing整段预览提交；draft/useManualTracks整段存储与一次撤销；TrackLayer绘制时只显示选择端点。TrackPanel说明更新。
- 文件：app/page.tsx、modules/map/{TerrainMap,roadSnap}、modules/tracks/{DrawingSession,TrackDrawing,TrackLayer,TrackPanel,draft,roadSnapping,roadPath,useManualTracks}；新增tests/road-path.test.mjs及公开道路fixture；docs/road-segment-snapping.md、README/LOG/本状态。
- 命令/验证 PASS：oxfmt、npx tsc --noEmit、node --experimental-strip-types --test tests/*.test.mjs（226/226）、npm run build、npm run build:android:web、git diff --check。初次撤销联合类型报错已修复。
- 真实道路13/14级跨桥跨图块回归PASS；浏览器13.9级两点之间整段弯曲连接PASS，一次撤销只留起点，再次撤销为空PASS。截图 artifacts/screenshots/road-distance-bridge.png / road-distance-undo.png。
- 390/360 DOM无横向溢出、绘制按钮在屏内PASS，截图road-tools-390.png / road-tools-360.png已存；精确手机截图仍受既有缩放问题限制，触屏手感未真机验收。
- 浏览器旧会话坐标不准、不支持position定位选项；重置CUA后按正式API及原始截图操作通过。仅独立tab14临时草稿，已清理并关闭，临时视口已恢复。
- 范围：已加载矢量道路，新绘制路段；不更改既有保存轨迹、自由绘制、路线服务、照片/GPS、存储/签名/图源。未生成APK。日志.openai/*road-path*.log；无代码阻塞。
- 交付：按长期授权提交推送main并核验远端SHA，同步记录.openai/sync-road-path.log。下一步为用户体验；真机验收待后续。

# 当前任务：顶部直接搜索地点（2026-09-07，完成验证）
- 目标：地图上方常驻紧凑搜索框，输入地点/山峰并选择结果移动地图，结果用完收起。
- 启动：status/diff干净，pull --ff-only 已最新83309f5，读取项目状态/说明。复用现有Photon搜索接口、缓存和节流。
- 已改：PlaceSearch新增自动搜索/中文输入法保护/中止过期请求/键盘选择/清空与关闭；PlaceName提取当前地点标签供搜索占位显示，page接线，modern.css合并同一44px顶栏。
- 验证 PASS：TypeScript、219/219测试、网页/安卓网页构建；真实搜索成都返回结果，方向键选中并回车后地图URL为#14/30.65987/104.06331，结果收起；清空/单字提示/Esc/点击图层收起搜索均通过。390/360 DOM无横向溢出，顶栏与图层按钮间隔约8px。
- 文件：PlaceSearch/PlaceName/page/modern.css，docs/top-place-search.md，README/LOG/本状态。截图 artifacts/screenshots/top-search-*.png；日志 .openai/*place-search*.log 和 top-search-layout.log。精确手机截图受既有缩放问题限制，实际软键盘/输入法/触屏待真机验收。
- 同步：按长期授权提交main并核验远端，记录 .openai/sync-place-search.log；未生成APK。下一步：用户体验顶部直接搜索。
# 当前任务：图层控件进一步变细与紧凑参考（2026-09-07，完成验证）
- 目标：针对用户图层截图收窄浮窗、细化开关与图标，保留磨砂和可达操作；网上寻找紧凑 UI 参考。
- 启动：status/diff 干净，pull --ff-only 已最新 12eb940；读取 README/AGENTS/CURRENT_STATE/LOG。Product Design 无已保存上下文。
- 改动：modern.css 范围限于图层窗/列表/开关，304→248px，开关36×22→28×16px，12px字/16px图标；仅鼠标设备32px行，触控保留44px。
- 验证 PASS：类型检查、网页/安卓网页构建；598×628 同视口前后对照，面板304→248px宽、行45→32px；开关开/关、图源返回、关闭通过。390×844 / 360×780 DOM无溢出、名称完整，展开海拔透明度参数无溢出。日志 .openai/*slim-layers*.log。
- 截图：artifacts/screenshots/layers-slim-before.png / layers-slim-after.png 正常视口 PASS；layers-slim-390.png / layers-slim-360.png 窄屏仍有既有截图缩放异常，精确手机视觉 BLOCKED。触屏44px规则保留；浏览器实际为鼠标主输入，真机待验收。
- 参考：Mapbox Studio 官方图层说明、CalTopo 官方菜单新旧对照、Glare 概念图。Dribbble 浏览器遇 Human Verification，未尝试验证；可提供原文链接。
- 文件：modern.css、docs/slim-layers-ui.md、README/LOG/本状态。代码与说明按授权同步main，核验记录 .openai/sync-slim-layers.log；未生成APK。下一步：用户查看当前细列表与参考方向，手机触控待验收。
# 当前任务：图源页面逐级返回（2026-09-07，完成验证）
- 目标：图层→图源、工具→图源、图源→添加/扫码/预览均可返回，标题栏固定入口，保留关闭。
- 启动：status/diff 干净，pull --ff-only 已最新 08176ab；读取项目说明。
- 已改：page 记录来源，ControlDock 标题栏返回，MapSourcesPanel 上报当前步骤返回行为，modern.css 紧凑按钮。未改地图渲染、存储格式或图源服务。
- 验证 PASS：npx tsc --noEmit；219/219 逻辑测试；npm run build 与 npm run build:android:web。浏览器实际点击图层→图源→返回图层、工具→图源→返回工具、添加→预览→返回添加→返回列表；预览返回保留名称/地址，关闭仍有效。390×844 / 360×780 无横向溢出，内容滚动153px后返回/关闭仍在标题栏，返回52×44px。
- 截图：artifacts/screenshots/sources-header-back.png 正常视口 PASS；sources-back-390.png / sources-back-360.png 有既有截图缩放异常，精确手机截图 BLOCKED，但 DOM 布局/点击 PASS；真机触控与相机硬件未验收。日志 .openai/*sources-back*.log，布局 .openai/sources-back-layout.log。未生成APK。
- 下一步：按长期授权提交并推送 main，核对远端 SHA；无代码阻塞。
# 当前任务：剖面移入工具、恢复明显的画线入口（2026-09-07，完成源码与验证）
- 启动 status/diff 干净，pull --ff-only 已最新 c618a3c。已确认画线未删除，但入口藏在路线标题“轨迹管理”，开始按钮在多段说明/设置后。
- 范围：ControlDock/MapActions/page 接线和 TrackPanel 按钮顺序；工具首行放画线/剖面，右侧移除剖面，保留原画线逻辑和剖面数据。
- 已改：工具第一行“画线/剖面”、路线标题“画线 / 轨迹”；绘制按钮提前。从剖面开始画线会退出剖面操作并保留数据，避免两种地图交互同时活动。
- 验证 PASS：TypeScript、219/219测试、网页与安卓网页构建；浏览器逐点模式真实点击生成9.5km线段后清空本轮草稿，恢复平滑模式；剖面入口恢复原对象，右侧剖面按钮数量0。390/360菜单面板约250px高、全部菜单按钮在内部，无横向溢出。
- 文件：ControlDock/MapActions/page/TrackPanel，README/LOG/docs/compact-thetrail-ui.md/本状态。日志 .openai/*tools-entry*.log；截图 artifacts/screenshots/tools-draw-section.png。代码按授权同步main，远端SHA核验写 .openai/sync-tools-entry.log。未生成APK；手机精确截图/真机触控仍待后续验收。

# 当前任务：玻璃质感、数值旋转与剖面紧凑布局（2026-09-07，实现/构建完成，手机待验收）
- 用户指出上一版缺少参考图的模糊效果、视觉不符。目标：真实背景模糊、半透明暖灰表面、减少嵌套实色块，同时保留紧凑字号和绿色相机。
- 启动：git status/diff 干净，pull --ff-only 已是最新 412c937；重新查看原 TheTrail 参考。范围限定 modern.css 与说明文件，不改业务、地图图源、定位、存储。
- 用户追加：对象左下角显示/编辑旋转角度并归正；剖面大折叠栏和尺寸框要紧凑。已实现 X/Y/Z 实时读数、失焦/回车提交、无效值恢复、归正/撤销；剖面尺寸横排、两个折叠入口同排、底部操作同排。
- 代码：modern.css 磨砂透明度/14px 模糊、圆形浮动控件、剖面/对象浅色适配；ObjectGizmo/math/CSS 接入数值姿态；SectionProfile/SectionScaleControls 压缩结构。未改图源、签名或存储格式。
- 验证：TypeScript PASS；剖面 14/14 测试 PASS，新增数值姿态/归正保留位置尺寸测试；初次测试仅 -0 严格相等断言失败，改为角度容差后通过。浏览器 X 改 45.5、单次撤销恢复 107.5；归正显示 90/0/0，撤销恢复；无效500恢复且无撤销记录 PASS。原剖面测试后已撤销恢复。
- 最终：TypeScript PASS、219/219测试 PASS、网页与安卓网页构建 PASS；390/360 DOM 无横向溢出，旋转栏与绿色相机无重叠、剖面折叠入口同排。正常598×628截图与参考同屏对照，磨砂色块/数值栏/紧凑字段可见；手机捕获缩放仍 BLOCKED，真实手机GPU模糊开销与静止闪烁待验收。
- 说明：README/LOG、docs/compact-thetrail-ui.md、新增docs/object-rotation.md、design-qa.md、本状态；日志 .openai/*glass*.log 与tests-rotation.log；截图artifacts/screenshots/glass-*.png。本轮沿用授权提交推送main并核对远端SHA，记录 .openai/sync-glass.log；无新APK。

# 当前任务：A / TheTrail 紧凑 UI（2026-09-07，实现与构建完成，手机视觉待验收）
- 目标：按用户选择的 A 参考，浅色悬浮面板、亮蓝强调色、小字号与紧凑布局；保留真实地图和绿色三维相机。
- 启动：git status / diff 干净，pull --ff-only 已是最新 cadfbec；已读项目规则及状态，实际查看 TheTrail 参考图。
- 范围：共享控件样式、路线标题栏、图层参数渐进展开；不改地图渲染、定位、存储、签名和图源。
- 已改：modern.css 统一轻浅面板与蓝色状态，两个网页入口接入；ControlDock 标题内切换路线/轨迹，page 移除重复切换行；LayerPanel 隐藏未开启图层的参数、说明展开，LayerWindow 预设折叠。保留 44px 主要触控区与 12–13px 字号。
- 验证：初次 TypeScript PASS。390/360 DOM 宽度无横向溢出，360 路线框约 286×343、绿色相机与右工具/底栏不相交；图层参数条件显示、来源说明展开、路线/轨迹切换、新增途经点 PASS。浅色标记按钮对比度问题已修正。
- 截图：正常视口外观可检查；手机视口覆盖捕获出现内容约半尺寸的工具缩放异常，手机截图视觉验收 BLOCKED，未当作应用布局缺陷或真机 PASS。
- 最终验证：TypeScript PASS、217/217 测试 PASS、网页及安卓网页资源最终构建 PASS；图源入口、照片空态、收藏、标记浏览、Escape 关闭 PASS。按钮浅色对比度与图层展开蓝色状态二轮截图通过；无新增浏览器错误。标记窗最终收窄到与普通面板一致，避开右工具。
- 文件：新增 modern.css、docs/compact-thetrail-ui.md、design-qa.md；修改两入口、page/ControlDock/LayerPanel/LayerWindow、README/LOG/本状态。无依赖或图源变化。日志 .openai/{typecheck,tests,build,build-mobile}-ui-a*.log；截图 artifacts/screenshots/ui-a-*.png。
- 交付：本轮源码与详细说明同步 origin/main，最后 Git 命令与远端 SHA 核验记录 .openai/sync-ui-a.log；未生成 APK。下一步为手机尺寸视觉/真机验收；静止闪烁根因仍未解决。

# 当前任务：静止地图闪烁排查与 UI 参考（2026-09-07，本轮调查完成；手机根因待复现）
- 目标：调查用户反馈的地图不动也闪；检查现有 UI，提供网上真实产品参考供用户选择，暂不重做 UI。
- 启动：main 干净，git pull --ff-only 确认 77b6354 最新；已读项目说明。公司新增依赖本地缺失，npm install 补齐，开发进程已退出，正在恢复本地预览。
- 已确认并最小修复：Vite 开发服务禁止从 public 导入 JSON，terrain/tiles.ts 原导入导致 HTTP 500。新增模块内 repair-coverage.json，生成脚本同步两个清单，增加清单一致性测试；像素、覆盖区、Android 资产路径及业务 UI 保持。npm 产生的无关 lockfile 变化已撤回。
- 命令：git status / diff / pull；源码检索 TerrainMap、WeatherLayer、SectionSurfaceLayer、AnnotationLayer、MapSourceLayer；npm install --no-audit --no-fund。
- 验证：依赖安装 PASS；5/5 地形测试 PASS，TypeScript PASS，重启旧开发进程后 HTTP 200、浏览器主界面恢复。网页构建 PASS；APK 静止闪烁仍未复现/未真机测试。
- 日志：.openai/dependencies-ui-audit.log、.openai/dev-ui-audit*.log。截图将存 artifacts/screenshots/。
- 本轮调查/参考完成：默认 598×628 主界面/路线/图层截图已查看；390 覆盖截图缩放异常已拒绝并恢复视口。静止山体两帧相隔约 100.5 秒像素相同，不能排除中途瞬时闪烁。未修改整体 UI。详见 docs/ui-audit-2026-09-07.md。
- 下一步：用户选择 Organic Maps / Komoot / Gaia GPS 参考后再调整 UI；在实际 APK 按跟随/天气/图层组合继续复现静止闪烁。本轮最小修复与调查记录提交同步 GitHub，未发布 APK。
# 当前交付：无损压缩 APK 与 GitHub 独立测试版（2026-09-07，完成）
- 用户要求继续打包、压缩并上传 GitHub；开始 main 干净，pull --ff-only 确认 80ec939 最新。GitHub API 凭据已验证，可读取现有 Release。
- 0.2.4 公开证书为 a3aa453c…91cd29c，本机现有测试密钥证书为 4a941b9d…623e6f9f，确实不一致。用户已明确没有原密钥，“反正发一个可以安装的就行”；据此制作独立包名的山兔测试版，允许与原版并存、数据独立，不替换原版签名配置，不要求卸载原应用。
- 范围：scripts/build-android.ps1 增加独立测试构建选项与签名前无损压缩步骤；独立签名公开配置、压缩脚本/测试、README/mobileREADME/跨设备与本轮发行说明。业务 UI、导航、剖面、照片、GPS、地形像素及原存储键保持，原始资源不删减。通过临时 Manifest 隔离包名/provider 与标签，回滚本轮构建接线即可。
- 已测 APK 约 55.2 MB，绝大部分是已压缩地形 PNG；保持所有海拔像素的压缩空间有限。已完成 PNG IDAT 无损重压缩及 ZIP 条目压缩选择；构建、校验与发行结果如下。
- 构建/验证完成：TypeScript、216/216 测试、网页与完整安卓构建通过。独立 APK 为 APK/Shantu-0.2.5-test-standalone.apk，55,019,071 字节；SHA-256 4cd978cebdc6062af14e9a8537318b5a76ae4fc1f6bde1a15d28ee4dfdf50525。v2/v3 签名、最终对齐、code12/包名/标签与独立 provider 均核验；原包名遇不匹配证书仍拒绝。
- 压缩前后（同次构建、对齐签名前）55,214,513 → 54,966,979 字节，减少 247,534 字节/0.45%，未删减资源。独立 Pillow 对比 496 PNG 像素与元数据完全一致，其余 29 资源 SHA-256 一致，共 525 项；ZIP CRC、资源表不压缩且对齐、无私密文件通过。
- 文件：修改 scripts/build-android.ps1、README.md、mobile/README.md、docs/continue-development.md、docs/recording-photos-fix.md 与本状态；新增 scripts/optimize-apk.mjs、tests/apk-compression.test.mjs、config/android-standalone-signing.json、docs/release-0.2.5-standalone.md。无新增依赖、业务改动或文件/数据删除；原 Manifest 与原签名配置未改。
- 证据：.openai/{typecheck-apk-standalone,tests-apk-standalone,build-web-apk-standalone,build-apk-standalone,verify-apk-standalone-assets,verify-apk-standalone-manifest,verify-apk-original-signing-guard}.log。首次压缩测试 fixture 的 CRC 错误已修正，最终全量通过。
- 发布完成：https://github.com/Siger1989/map/releases/tag/v0.2.5-test-standalone ，draft=false/prerelease=true。源码提交与远端标签均为 325c0bda6e66a51ccf9bd74b7b9b3978d8cde8f9；APK、SHA256 与安装说明三附件 uploaded，GitHub 大小与 SHA-256 均逐项匹配本地。最初直连大文件上传未完成，停止本任务上传进程并沿用 Git 已配置的本机代理重传后成功；未影响 Codex 或原 Release。
- 发布证据：.openai/{sync-apk-025,push-apk-025,upload-apk-025-proxy,verify-apk-025-draft,publish-apk-025,verify-apk-025-published}.log。无私有密钥/日志上传；本状态收尾单独提交，最终 main SHA 核验写 .openai/sync-apk-025-final.log。
- 本轮打包/压缩/上传完成，无待交付文件。adb 无连接设备，实际真机安装、触控、WebView、GPS/锁屏记录仍未验收；独立版与旧版数据不自动迁移。

# 当前任务：剖面比例尺、尺寸档位和交线测点（2026-09-07）
- 实现与主要验证完成：212/212 全量逻辑测试、最终 TypeScript；390×844 / 360×780 剖面浏览器通过颜色独立/图线与滑条拖动/单次保存/真实触摸与取消/键盘/选择后数据按钮与减号、编辑自定义字段、存储失败重试、比例尺单位与间隔、宽高档位、对象关闭/隐藏/删除/刷新和档案恢复，以及旧对象变换/撤销/图片导出。已查看两尺寸图与设置/编辑界面、1600×1827 JPEG，图片带 km 刻度/比例尺/颜色编号及完整数据页脚。
- 补充修正：恢复小剖面时按对象尺寸回中，避免仍停在大剖面的远距离视角；重新选择已存剖面会结束路线选点/轨迹编辑。最终两尺寸路线集成回归通过，含已有可见剖面下开始导航不隐藏、退出导航后进度条恢复、路线选点切剖面再返回，以及镜头、GPS进度、途经点/收藏全部既有流程。
- 网页 build 与安卓网页资源 build 均通过（.openai/build-section-points.log、build-mobile-section-points.log），无新依赖。未生成 APK 或 Release，现有 APK 不包含本轮修改；未真机验收。源码/说明提交同步 main，远程 SHA 核验记录在 .openai/sync-section-points.log。
- 文件与模块：app/page.tsx、map/TerrainMap.tsx；section 修改 SectionProfile/SectionSurfaceLayer/profileExport/types/section.css，新增 scale/chartFrame/SectionRuler/SectionScaleControls/ProfileChart/ContourScrubber/notePosition/useContourPointDrag/profileNotes/useProfileNotes/ProfileNoteEditor/savedSection/useSavedSection；journey 修改 RouteWeatherRail/route-rail.css/scrub。测试/脚本新增 section-notes-scale、rail-progress-checks、section-note-checks、section-point-drag-checks、section-state-checks，扩展 route-stops-scrub、verify-route-stops、verify-section-profile；docs/elevation-section、route-stops-and-scrub 与本状态同步。无新依赖、无文件或业务功能删除；地形/标记几何、照片、GPS记录、收藏和路线算法及其存档格式未改。
- 存档边界：本机当前一个剖面对象；测点档案可恢复已存几何，删除对象后档案保留。全局备份/云同步尚未接入这些新存档，图片可下载全部测点数据。日志 .openai/{typecheck-section-points,tests-section-points,tests-section-all,browser-section-points,browser-route-rail}.log。截图 artifacts/screenshots/section-{points-chart,point-data,scale-settings,gizmo}-{390,360}.png 与 section-export-{390,360}.jpg。
- 最新追加：用户要求剖面添加后一直保留，仅手动隐藏/删除才消失。新增 savedSection/useSavedSection，保存对象几何与可见状态，编辑选中状态独立。app 与 TerrainMap 通过 sectionEditing 区分编辑/可见；关闭详情、完成操控、Escape、开始导航不再隐式隐藏剖面；详情提供隐藏/删除，右侧入口恢复显示原剖面，刷新恢复对象。跨模块为解开原 enabled 同时控制显示/编辑/导航的耦合；回滚本轮持久化 hook、app/Map props 与分支即可。
- 比例尺追加：窗口内“比例尺设置”可切米/千米、自动或 100…10000 m 间隔及自定义，图内明确比例尺线段，图/面/导出同步。密集刻度按基础间隔整数倍显示并标实际数值；单位/刻度改变不改变物理尺寸或测点归属。
- 最新纠正：用户明确“＋”要直接增加不同颜色的独立拖动点，在交线和下方滑条显示，并追加“－”删除。正在按此修正：＋立即增加并保存彩色点，交线/滑条均可拖动，地图交线上同步显示；拖动预览不写盘，松手保存，取消还原。点按编辑原名称/备注/数据，－删除选中点，数据行也保留减号。新增 ContourScrubber、useContourPointDrag、notePosition，剖面层通过事件接收已保存点与临时预览。
- 用户追加比例尺与“＋”测点，已确认方形面显示米制刻度、宽高可选 100/200/500/1000/2000/5000/10000 m 两种都要；测点自动带坐标海拔，可填名称/备注/自定义字段。
- 方案与范围：section 内新增 scale、SectionRuler、SectionScaleControls、profileChart/ProfileChart、profileNotes/useProfileNotes/ProfileNoteEditor；SectionSurfaceLayer 只添加按同一面内基底绘制的标尺；SectionProfile 接入尺寸和测点，profileExport 同步刻度/编号/数据，信息超长时分图片。交线计算、地形与标记/对象操控器、路线/GPS均不改，无新依赖或功能删除，可独立回滚剖面新增模块与接线。
- 测点保存到本机 shantu.section-points.v1，记录添加时的坐标/海拔/来源和剖面几何，按几何区分；变换后的新剖面不会冒用旧点，保存列表可恢复原剖面。读取/写入失败提示且不覆盖坏存档，写入成功才确认保存。
- 以上设计均已实现，最终验证与构建结果见本节顶部；测试模拟数据只验证功能，不代表野外测量精度。

# 当前任务：路线进度带方向与公里读数（2026-09-07）
- 用户要求上下颠倒进度带起终点，并在滑块旁显示小公里数，确认行进时自动更新。开始 main 干净，pull --ff-only 确认 303e59f 最新。
- 修改范围：journey/RouteWeatherRail.tsx、route-rail.css、scrub.ts；只反转显示与输入方向，保持原路线几何和 fraction=0 起点、1 终点语义。新增紧凑公里标签，预览标“览”、真实定位绿色，无有效定位时显示空值；预览窗口为标签留出横向空间。导航算法、地图镜头、记录/照片/标记/地形数据不改，无依赖或功能删除。
- 已确认：现有持续定位会更新真实进度；手动预览期间滑块停在预览位置、绿点仍跟随定位，关闭预览或恢复跟随后回到定位进度。进入导航时原逻辑使用导航卡片，行程天气带隐藏，本轮保持该布局；公里读数为沿路线距起点的位置，不是累计实走总里程。
- 初轮 TypeScript 与 9 项相关逻辑检查通过，之后纳入本轮 212 项全量测试；390×844、360×780 浏览器通过向上触摸/方向键、天气渐变、公里标签无重叠、连续模拟 GPS 自动前进与无效定位、预览/跟随/真实定位分离及原镜头/途经点/收藏回归，无页面错误。已查看 route-rail-{reversed,live}-{390,360}.png 关键截图。与用户追加的剖面需求一同通过最终构建并同步源码，未生成 APK。

# 当前任务：路线预览中镜头拖动无响应（2026-09-07）
- 用户确认右下角绿色镜头控件拖动没反应。开始 main 干净，pull --ff-only 确认 78407cc 最新。隔离路线预览复测竖拖/外圈旋转可用，尚未复现所有方向完全失灵；代码确认绿色模型忽略横向拖动，且失焦/隐藏页面缺少拖动会话清理，按此范围修正，不声称已查明所有无响应原因。
- 范围：controls/CameraGizmo.tsx、cameraGesture.ts、workspace.css；绿色模型二维拖动和键盘左右转向、稳定 SVG 捕获与中断恢复。app/page.tsx 手动镜头操作暂停位置跟随，避免自动回中断开操作；路线预览位置/读数保持。补对应逻辑与浏览器验证、说明；路线/照片/标记/地形数据不改，无依赖或功能删除。回滚控件及这一处回调即可。
- 验证完成：TypeScript、15/15 镜头/轨迹/位置跟随/路线预览逻辑测试通过；390×844、360×780 浏览器实际鼠标横/竖/斜拖、触摸拖出模型仍响应、外圈旋转、pointercancel/失焦后恢复、方向键与预览保留通过，并完成原途经点/拖动排序/收藏恢复/定位与预览切换/键盘小屏回归，无页面错误。两尺寸截图 artifacts/screenshots/preview-camera-fixed-{390,360}.png 已查看。
- 网页 build 与安卓网页资源 build 均通过，未修改安卓 Java/签名，未生成本轮 APK 或 Release；现有 APK 不包含本轮镜头改动，尚未真机验收。日志 .openai/{typecheck-preview-camera,tests-preview-camera,browser-preview-camera,build-preview-camera,build-mobile-preview-camera}.log。
- 文件：app/page.tsx、controls/{CameraGizmo.tsx,cameraGesture.ts,workspace.css}、scripts/verify-route-stops.mjs 与本状态；新增 tests/camera-gesture.test.mjs、scripts/camera-gesture-checks.mjs、docs/preview-camera.md，无文件/功能删除。源码提交推送 main，完成后的远程 SHA 核验见 .openai/sync-preview-camera.log。

# 当前任务：修复鄂陵湖附近地形尖刺（2026-09-07）
- 用户截图位置 #13.64/34.85086/97.76257/0/80；开始 main 干净，pull --ff-only 确认 3ba8e87 最新。实测全球 Mapzen z12/3160/1624 原始 PNG 存在 2988/5585m 相邻异常点，周围约 4270m；同位置 z13 数据范围 4259–4365m，无千米级突跳，z11 也含异常。属于上游低级瓦片数据异常。
- 修复方案：只重建已检查的 z12 九瓦片区域及其 z7–11 父级局部像素，使用同源 z13 原始海拔做数值面积采样，边缘融合；不对全球山峰做阈值削平。新增独立可复现生成脚本、修复覆盖/署名及资源，网页/安卓统一路由优先修复瓦片，缓存版本避免继续读旧坏瓦片。成都 FABDEM、其他地区与路线/照片/标记/操控器保持。
- 已生成 23 张同源修复资源，两个已知异常点恢复为 4275.75/4288.75m，主瓦片 4264.60–4364m。新增 terrain/tiles.ts 与 public/terrain/repairs-v1 覆盖清单；网页 API、安卓 LocalGateway 统一优先修复资源。新版 URL 防旧跳转缓存，outdoor/offline 在修复区外保留旧离线包；构建脚本逐张确认修复资源入包。无全局高度截断，无新增依赖或文件删除。
- 验证完成：TypeScript、19/19 地形/离线/剖面相关测试、网页构建与安卓 Java/DEX 未签名构建通过。780×844 原视角复现尖刺并确认修复；390×844 / 360×780 同视角、缩放 11/12/14、网格/点选海拔、API 返回资源一致、成都与区外仍用旧来源检查通过。截图已查看，无横向溢出/页面错误。并行构建期间一次截图遇开发热重载，构建结束后增加视角/DOM 就绪断言重跑，三个尺寸均通过。
- 文件：terrain/{tiles.ts,terrain.ts}、网页 terrain API、outdoor/offline.ts、安卓 LocalGateway、build-android.ps1；新增 prepare-terrain-repair.py、verify-terrain-repair.mjs、terrain-repair.test.mjs、docs/terrain-repairs.md 与 public/terrain/repairs-v1（23 PNG、coverage/SOURCE）。无业务功能删除；图片/路线/标记/操控器未改。
- 日志 .openai/{terrain-repair-build,typecheck-terrain-repair,tests-terrain-repair,browser-terrain-repair,build-terrain-repair,build-android-terrain-repair,verify-terrain-repair-assets,verify-terrain-repair-apk}.log；截图 artifacts/screenshots/terrain-spikes-{before,after-780,after-390,after-360}.png。APK 525 项资源逐项 SHA-256 与 mobile/dist 一致，内含 23 张修复瓦片；mobile/.build/Shantu-0.2.5-test-unsigned.apk，55205847 字节，SHA-256 0f79aacd347f5cd64a16d1ccbc34f8d6c3b11de6d4d65d72d514f78eeb3ae651。原签名缺失，未发布 Release，未真机验收。
- 本轮只修复已核查的鄂陵湖附近区域，不承诺全球异常全部消除。修复区旧离线包需要联网补新版高程，新版安卓资源已内置。源码/资源提交推送 main；完成后的远程 SHA 核验见 .openai/sync-terrain-repair.log。

# 当前任务：关闭图层窗口后保留海拔图例（2026-09-07）
- 用户截图显示：海拔着色仍开启，但关闭图层窗口后左下角海拔颜色图例消失。开始工作区干净，pull --ff-only 确认 a257509 最新。
- 原因是 app/page.tsx 的 map-legends 容器仅在 panel=layers 时显示。最小修复增加海拔着色开启时保持可见的条件；色阶、透明度、地形渲染、地质面板原有显示行为及其他模块不变，不新增功能文件/依赖。
- 验证完成：TypeScript 与网页构建通过；390×844 / 360×780 浏览器检查通过，覆盖关闭按钮、Escape、点击窗口外、打开工具菜单、重开窗口、关闭着色、图例滚动与布局，无页面错误。已查看两尺寸截图，图例不遮挡底部与右侧控件；本轮仅验证图例界面，未重新验收地形画面或安卓真机。
- 证据：.openai/{typecheck-elevation-legend,build-elevation-legend,browser-elevation-legend}.log；artifacts/screenshots/elevation-legend-closed-{390,360}.png。本轮只修改 app/page.tsx 与本状态，无删除文件，无新依赖；未生成 APK 或发布 Release。提交推送 main，完成后的远程 SHA 核验记录在 .openai/sync-elevation-legend.log。

# 当前任务：交线剖面、共用球形操控器与图片导出（2026-09-07）
- 最终交付：本轮实现/检查已完成，正在提交同步 main。修改模块/文件为 objectTransform（math/projection/gizmoHandles/ObjectGizmo/CSS）、section（contours/loadedTerrain/SectionSurfaceLayer/SectionProfile/profileExport/CSS）、annotations（data/modelGeometry/AnnotationLayer/useAnnotations/AnnotationPanel）、map/TerrainMap、app/page/layout、features 开关、mobile/main 与 MainActivity 返回、README/mobileREADME/docs/elevation-section、本状态及新增逻辑/浏览器测试。新增有限面交线/详情/导出、共用对象 Gizmo 与兼容绝对中心海拔；移除产品旧裁切接线与独立模式面板，未删除历史裁切研究文件。收藏/路线/GPS记录/照片/地图图源的数据与算法未改；开始导航时正常结束剖面编辑。
- 最终校验：TypeScript 通过；198/198 测试通过；两尺寸浏览器与 JPEG、触摸单次保存/取消、点击真实剖面开窗通过；网页 build 和 Android Java/DEX 未签名完整构建通过。APK 500 项资源逐项 SHA-256 与 mobile/dist 一致，含 Gizmo CSS、交线/图片代码与新返回处理。产物 mobile/.build/Shantu-0.2.5-test-unsigned.apk，54016614 字节，SHA-256 b3f1f52534bf33e6fefbb18282963a12ba66c8ddd047ab798f63a8cb1194408e。原签名缺失，未发布新 Release，未真机验收。
- 证据日志 .openai/{typecheck-section-final,tests-section-final,browser-section-profile,browser-section-real,build-web-section-profile,build-android-section-profile,verify-section-apk}.log；截图 artifacts/screenshots/section-{gizmo,profile}-{390,360}.png、section-export-{390,360}.jpg、section-real-terrain.png，均已查看。来源/采样精度、U/V 与绝对海拔区别、剖面会话不持久化已写说明。远程开始/提交前无新增提交（0 0），完成后的 SHA 核验见 .openai/sync-section-profile.log。
- 本轮已完成实现和网页验证：按 Maxon 官方参考重做为对象中心同时可用的箭头/圆环/方块/中心黄块，随实际模型投影与姿态，局部轴移动/旋转/拉伸、屏幕移动/旋转、Shift 5°、键盘微调；旧独立球形面板及其未用数学已移除。gizmoHandles / projection / math / ObjectGizmo 分工；撤销、指针取消/失焦/第二指取消及单次保存保持。
- 198/198 全量逻辑测试、最终 TypeScript 已通过。390×844 和 360×780 浏览器检查通过：真实平面点击开窗、交线选择/滑杆/地图白点联动、完整模型无裁切、直接拖箭头/方块/环微调、取消与撤销、实际触摸预览不写盘/松手一次写盘、触摸取消；布局与右下相机控制器不重叠，无页面错误。两张 1600×1458 JPEG 已真实下载并查看，底部所有元数据可读。真实 DEM 另测读到中心约 2015m、交线点约 1557.88m，避免了未加载 0m 假线。
- 文档 docs/elevation-section.md 与 README 更新当前行为和局限；新增 mobile/main.tsx 样式导入、MainActivity 返回优先级。网页构建已通过；正在完成最后安卓未签名构建和产物校验，随后提交同步。
- 最新纠正：用户指出第一版独立球形面板不符合 ZBrush，要求上网核对。已重新查 Maxon 官方 Gizmo 3D 文档及原图：同一操控器贴在对象中心，箭头移动、环旋转、轴方块拉伸、中心黄块等比缩放、灰环屏幕转动，无须切换三种模式。当前 ObjectGizmo 初版须重做为对象上直接操作的共用 Gizmo，保留交线/图片等已写模块。
- 已新增 objectTransform/math.ts、ObjectGizmo 初版、section/contours.ts、SectionSurfaceLayer、SectionProfile、profileExport 与 loadedTerrain 适配，标记可选 centerAltitude、共享模型几何及一次保存/撤销接线，地图不再接入旧 TerrainClip。12 个纯几何/变换测试首轮 11 通过、1 个竖直移动经纬度舍入缺陷已修；TypeScript 首轮通过。真实浏览器截图发现 MapLibre 未加载 DEM 时 queryTerrainElevation 返回占位 0，已改为严格 loadedTerrainSampler，尚待复测。
- 尚未完成真实对象 Gizmo、完整浏览器交互/导出、最终测试/构建/推送。不要把当前预览说成完成或手机验收。
- 用户要求矩形面可拉伸/旋转，剖面和原标记共用类似 ZBrush Gizmo 的移动/旋转/缩放操作；点击面打开交线轮廓，横向滑杆查看具体点海拔。用户已确认保留完整模型，只显示面和交线；追加详细信息与图片下载，图片下方列坐标等信息。
- 开始 main 干净，pull --ff-only 确认 2b40bc8 最新。已查现有 section（停用的旧 GPU 裁切）、annotations/地图投影与保存接口，并核对 Maxon Gizmo 3D 和 Three.js 官方操作文档。
- 设计：新增独立 objectTransform 控件/姿态适配与拖动预览，松手原子保存/取消还原；section 新交线采样、有限矩形/模型网格求交、轮廓串接/逐点读数和图片导出。地图与窗口复用同一交线数据，断线不桥接，未知地形留空；模型几何/同源地形估计分别标来源。
- 修改范围：section、annotations 的可选绝对中心海拔/共用模型几何、TerrainMap/app 公共 props、剖面开关/入口与返回处理；不启用旧 terrainClip，不裁切或重写地形，不改变收藏/路线导航/GPS记录/照片/图源数据。旧标记数据通过可选字段保持兼容，新增模块可独立回滚。
- 尚在实现，未验证/构建/同步本轮功能。原签名限制保持，不发布错误签名 APK；后续按 390×844/360×780 验证拖动/交线/滑杆/导出/回滚，更新本状态并提交推送。

# 当前任务：途经点常驻删除按钮（2026-09-07）
- 用户反馈途经点没有明显删除入口，要求增加 X。开始 main 干净，pull --ff-only 确认 c9df117 最新；原删除操作只在输入框聚焦后的编辑选项中显示。
- 修改 navigation/RoutePanel.tsx 与 navigation.css：每个中间途经点行末常驻 44px X，移除隐藏编辑区重复删除按钮；复用 useNavigation.remove，删除清空旧规划/取消请求并保留起终点，拖动中禁用删除。收藏、轨迹/照片、定位、导航算法与原数据格式保持，无新依赖/文件删除；回滚恢复原入口即可。
- 验证完成：TypeScript、22/22 导航/途经点/偏航相关测试通过；390×844、360×780 未聚焦时 X 常驻、44px 点击区、实际触摸删除空/已选途经点、保留起终点与原三点收藏、删除后旧规划失效、排序/搜索/收藏恢复/460px 键盘视口回归通过。两尺寸截图已查看，无新增遮挡/溢出或运行错误。日志 .openai/{typecheck-waypoint-delete,tests-waypoint-delete,browser-waypoint-delete}.log。
- 网页与 Android Java/DEX 完整未签名构建通过；500 项 APK 资源逐项 SHA-256 与 mobile/dist 一致，含常驻 X 和样式。产物 mobile/.build/Shantu-0.2.5-test-unsigned.apk，54008247 字节，SHA-256 eb562cb9883eb94eecf440e85035715ae081486182413063ff77012df453a9d7。日志 .openai/{build-web-waypoint-delete,build-android-waypoint-delete,verify-waypoint-delete-apk}.log；localhost:3000 返回 200。原签名限制保持，不可安装、无新 Release，未做真机触控验收。
- 文件：RoutePanel.tsx、navigation.css、scripts/verify-route-stops.mjs、docs/route-stops-and-scrub.md 与本状态；说明更新常驻删除入口，并纠正前轮遗漏的旧 500 km 限制文案。源码/状态一并提交，origin/main 同步与最终 SHA 核验见 .openai/sync-waypoint-delete.log。

# 当前任务：取消规划路线 500 公里限制（2026-09-07）
- 用户明确要求删除公里数限制；开始 main 干净，pull --ff-only 确认 ff75533 最新。
- 修改 navigation/provider.ts，移除请求前累计直线距离超过 500 公里的拦截与提示；驾车、骑行、步行统一生效。更新 tests/navigation.test.mjs 原校验用例，成都到拉萨允许生成请求。保留非法坐标、过近地点和途经点数量校验，原服务超时/失败处理不变。
- 收藏、轨迹、照片、导航与天气算法/存档均不变，无新增依赖或文件删除。回滚只需恢复两行距离校验；不改变上游服务能力，也未新增自动分段。
- 验证完成：TypeScript、22/22 导航/途经点/偏航相关测试通过；网页与 Android Java/DEX 完整未签名构建通过，500 项 APK 资源逐项 SHA-256 与 mobile/dist 一致，已确认旧 500 公里提示不再进入代码包。localhost:3000 返回 200。日志 .openai/{typecheck-route-distance,tests-route-distance,build-web-route-distance,build-android-route-distance,verify-route-distance-apk}.log。
- 产物 mobile/.build/Shantu-0.2.5-test-unsigned.apk，54008200 字节，SHA-256 ec36dde638940f71fce0bd7249bfc1e7dddc2dd4c1a069f4b89bb641b8a294e4。原签名限制保持，不可安装、无新 Release。未新增或声称长距离服务/真机实地验收；本轮只取消客户端上限。
- 本轮仅修改 provider.ts、navigation.test.mjs 与本状态文件。源码/状态一并提交，origin/main 同步与最终 SHA 核验见 .openai/sync-route-distance.log。

# 当前任务：独立收藏菜单与彩色分组（2026-09-07）
- 用户要求收藏路线独立菜单、不同分类颜色、自建分组和拖动整理。开始 main 工作区干净，pull --ff-only 确认最新 9dedca3。
- 范围：新增 modules/collections 独立分类/排序元数据、触屏手柄拖动和编辑面板；ControlDock 增底部收藏入口，app 替换旧列表，移除道路规划内收藏标签；outdoor/exchange 通过独立接口将可选分组信息纳入 JSON 备份。
- 默认驾车/骑行/步行/实走/导入/手绘六色分类，支持新建、改名/改色、组排序、条目排序与跨组移动，删除分组转未分组。拖动只改整理元数据，路线几何/GPS/照片/标记及导航算法不改；无新依赖。回滚本轮模块和接线即可，旧存档和旧备份保持兼容。
- 实现与验证已通过：TypeScript、40/40 收藏/备份/路线/导航/安卓返回相关测试；390×844、360×780 实际 Chromium 触摸与鼠标拖动换组/双向排序/取消、分组改名改色与删除保留条目、键盘、边缘自动滚动、存储失败重试、重载、旧路线恢复通过。截图已查看，窗口≤56dvh/440px，44px 操作目标，地图控制/底部天气互不遮挡、无横向溢出或运行错误。日志 .openai/{typecheck-collections-final,tests-collections-final,browser-collections-final}.log。
- 网页与 Android Java/DEX 完整未签名构建通过；500 项 APK 资源逐项 SHA-256 与 mobile/dist 一致，含收藏菜单/独立元数据/拖动样式。产物 mobile/.build/Shantu-0.2.5-test-unsigned.apk，54008261 字节，SHA-256 bc5f001f1b6c643ac49a875f6d3c2ef209130ce7edab6300dc7bf7a625424204。日志 .openai/{build-web-collections,build-android-collections,verify-collections-apk}.log。原签名限制保持，不可安装、无新 Release，未做安卓真机触控验收。
- 多途经点道路规划/触摸排序/连续预览/收藏恢复/键盘小屏回归在两种尺寸通过，日志 .openai/browser-route-stops-collections.log；该脚本改用项目可配置 browserRuntime，去掉旧电脑固定路径。localhost:3000 返回 200，最终截图已查看；远程 origin/main 仍为 9dedca3。
- 文件清单：新增 modules/collections/{data.ts,transfer.ts,useCollections.ts,useCollectionDrag.ts,CollectionsPanel.tsx,GroupEditor.tsx,collections.css}、tests/collections.test.mjs、scripts/verify-collections-browser.mjs、docs/route-collections.md；修改 app/page.tsx、controls/ControlDock.tsx、outdoor/exchange.ts、scripts/verify-route-stops.mjs、README.md 与本状态。删除旧 navigation/FavoritesPanel.tsx 和道路规划内收藏标签；无依赖、包名签名、原路线/轨迹/照片/标记/GPS/天气/地图算法变更。
- 源码已同步：功能提交 6b4431076833afccf167187320afc4f97645116e 已推送 origin/main，git ls-remote 核验一致，工作区干净，日志 .openai/sync-collections.log。状态收尾单独提交，最终 SHA 见 .openai/sync-collections-final.log；当前网页预览可用，无新 Release。

# 当前任务：规划路线开始导航与偏航接回（2026-09-07）
- 用户要求开始导航、已走距离、偏离后计算回归原路线的导航路径。工作区干净，pull --ff-only确认d967454最新。
- 设计：新增独立modules/guidance：路线投影/连续进度与GPS距离过滤、会话与偏航状态、道路接回查询、导航卡片和临时地图叠加层；复用position的前台定位与navigation/provider道路规划。原路线/途经点保留，接回线单独显示；连续可靠定位确认偏航，限频重算，断网/无可通行道路时明确提示。
- 跨模块：RoutePanel/地图路线概况新增开始入口，TerrainMap接独立导航叠加层，app以props装配；不改原轨迹/照片/标记存档、GPS记录服务、天气/地形算法或图源。回滚撤销新增guidance与入口/props即可，无依赖或存储迁移。
- 实现已接通：导航卡片、地图与面板开始入口、原蓝线与橙色接回线；20秒/50米质量门槛，3秒不同定位确认偏航/到达，异常跳动/定位间断不虚增里程，原途经点约束保留。前台会话不自动存轨迹，导航中暂收路线天气条，结束恢复。定位所有权独立，结束不清除原记录或已开启定位。
- 初轮TypeScript与27/27相关逻辑测试通过；390×844/360×780完整规划/开始、拒权恢复、里程过滤、连续偏航/接回原线、断网失败重试、晚到响应取消、到达和改计划/结束时释放定位通过。关键进度/接回截图已查看，卡片44px目标、≤38dvh/320px、无遮挡与无溢出。真实Valhalla柏林公开样点1908.169米原步行路线、846米接回查询/11条路段通过。日志.openai/{typecheck-guidance,tests-guidance,browser-guidance,live-guidance}.log。
- 最终源码验证通过：TypeScript、32/32相关逻辑测试，两尺寸完整浏览器回归通过；地图跟随与位置点复用导航接受的位置，查询中人已离开返回路径时拒收旧结果，返回几何终点≤20米以满足接回判断。补验原先开启定位在导航结束后仍保留、用户主动停止才释放。真实calculateRejoin接口含20米端点校验通过。日志.openai/{typecheck-guidance-final,tests-guidance-final,browser-guidance-delivery,live-guidance-final}.log。
- 网页与Android Java/DEX完整未签名构建成功；500项APK资源与mobile/dist逐项SHA-256一致，含导航卡片、独立接回线与样式。mobile/.build/Shantu-0.2.5-test-unsigned.apk为54003161字节，SHA-256 bde19fb2c5538bb6500fa952ad15f98796ce78c9ba7a986115893d369638c7df。日志.openai/{build-web-guidance,build-android-guidance,verify-guidance-apk}.log；原签名限制保持，不可安装、无新Release。
- 文件清单：新增modules/guidance/{geometry.ts,session.ts,rejoin.ts,useGuidance.ts,GuidanceLayer.ts,GuidanceCard.tsx,guidance.css}、tests/guidance.test.mjs、scripts/verify-guidance-browser.mjs、docs/route-guidance.md；修改TerrainMap.tsx、RoutePanel.tsx、app/page.tsx、README.md与本状态文件。无业务文件删除/新依赖/存储迁移，轨迹/照片/标记与原规划数据不变；未新增后台/语音服务，未做手机实地验收。
- localhost:3000返回200，网页预览已更新。源码功能提交6c32dfea50028b2728459b1659b647c7a48336ca已推送origin/main，git ls-remote核验一致，日志.openai/sync-guidance.log；状态收尾单独提交，最终SHA见.openai/sync-guidance-final.log。

# 当前任务：长按地图直接添加标记（2026-09-07）
- 用户要求空白地图长按添加标记、已有标记后续长按拖动；工作区干净，pull --ff-only确认9597cb1最新。
- 范围：map新增MapLongPress，只识别空白画布550ms静止长按；annotations新增QuickAdd小卡片和统一add接口；TerrainMap/app通过onMapHold接线；Android返回键关闭卡片。已有FeatureDragBridge负责480ms长按拖动、松手保存和撤销，存储格式不变。
- 实现已接通：长按后松手出现四种标记选项，点击即存；移动超过8px、双指、相机移动、失焦、取消或Escape不添加。路线/模型/现有标记优先编辑；绘制与选点模式禁用新增入口。卡片支持外点/地图移动/关闭退出，跟随定位暂停。
- 原轨迹、照片、GPS、地图图源和高程算法保持；没有新增依赖或删除文件。回滚撤销新增手势/卡片与公共props接线即可，已保存标记兼容旧版。
- 最终TypeScript、58/58相关逻辑测试通过；390×844与360×780浏览器验证直接创建图钉/模型、精确目标坐标、真实Chromium触摸长按/双指取消、已有标记拖动预览不写入/松手保存/撤销/重载、Escape/Android返回/外点/地图移动取消、存储配额失败重试通过。卡片44px目标、≤38dvh/320px、右侧3D控制与底部导航无遮挡，无横向溢出/运行错误；关键地形背景截图已查看。测试显式等待地图移动后布局稳定，避免相机未停稳的长按被正确取消误判为失败。日志.openai/{typecheck-map-hold-final,tests-map-hold-final,browser-map-hold-final}.log。
- 构建通过：网页与Android Java/DEX完整未签名构建成功，APK内500项资源逐项SHA-256与mobile/dist一致，已检查新增卡片JS/CSS和原生返回选择器。mobile/.build/Shantu-0.2.5-test-unsigned.apk为53999032字节，SHA-256 b0051be3ca1919423931b831622c2af20fa41af84793cf4d7f91b26fed5f39a8。日志.openai/{build-web-map-hold,build-android-map-hold,verify-map-hold-apk}.log；不可安装，无新Release，原签名限制保持。
- 补验通过：在两种尺寸使用真实Chromium触摸事件长按已有图钉并拖动，确认预览不写入、松手保存、撤销与重新载入；鼠标与触摸两条完整流程均通过，日志.openai/browser-map-hold-delivery.log。仅浏览器模拟，未做安卓真机验收。
- 文件清单：新增MapLongPress.ts、QuickAdd.tsx/quickAdd.css、tests/map-long-press.test.mjs、scripts/verify-map-hold-browser.mjs、docs/map-long-press.md；修改TerrainMap.tsx、useAnnotations.ts、app/page.tsx、MainActivity.java、tests/android-back.test.mjs、README.md与本状态文件。原菜单保留，无文件删除/依赖/存储格式改变。
- 源码已同步：功能提交754f9de6c87e37d85228dcaf1d59e8446fa03885已推送origin/main，git ls-remote核验一致，日志.openai/sync-map-hold.log；localhost:3000返回200，网页预览已更新。状态收尾单独提交，最终SHA见.openai/sync-map-hold-final.log。

# 当前任务：山兔标题后显示当前地名（2026-09-07）
- 用户要求“山兔”后加入当前地方名字；按地图中心理解，拖动地图后更新，世界总览显示世界地图。工作区干净，pull --ff-only确认e186637为最新。
- 范围：navigation新增地名解析/React查询hook，provider复用现有Photon/限速/缓存加入逆地理查询；controls新增页头地名组件、workspace.css限制长地名占位；TerrainMap通过公共onCenter回调在就绪/移动结束报告中心，app接线。地图中心取两位小数查询，900ms防抖，旧位置响应不能覆盖新位置；失败/无结果显示明确状态与坐标提示。无定位权限新增，轨迹/照片/GPS/地形算法和数据格式保持，回滚撤销本轮组件与回调即可。
- 实现完成：已查Photon官方API与演示服务说明，复用1.1秒请求间隔、15分钟/24条内存缓存；12秒超时与网络恢复重试，无结果/失败有明确状态。地区地名与街边店铺名区分，3–7级显示国家/省州，8级起城市/区县，超长名称省略、悬停完整信息，页头给右侧图层入口留位。
- 验证完成：最终TypeScript、14/14相关地名/导航/路线检查通过；真实Photon请求成都附近返回“成都市 · 灌口街道”，伦敦返回“London · City of Westminster”，携带网页/HTTPS Origin核对CORS返回*。390×844、360×780检查世界总览不查询、两位小数/真实拖动中心通知、缩放地区层级、长名省略/控件无遮挡、旧响应取消、无结果/失败/恢复联网、URL重载、无溢出和运行错误通过，关键中英文截图已查看。日志.openai/{typecheck-place-name-final,tests-place-name,live-place-name,place-name-cors,browser-place-name}.log。
- 构建通过：网页与Android Java/DEX完整未签名构建成功；500项APK资源与mobile/dist逐项SHA-256一致。mobile/.build/Shantu-0.2.5-test-unsigned.apk为53997340字节，SHA-256 878c4b3c3fa6adcc4e3df918232cc1ff9d9eb50fd64664e420dd4f62e4dc6a4e。日志.openai/{build-web-place-name,build-android-place-name,verify-place-name-apk}.log。无可安装新包/Release，原签名限制与未做安卓真机验收保持。
- 文件清单：新增navigation/{placeName.ts,usePlaceName.ts}、controls/PlaceName.tsx、tests/place-name.test.mjs、docs/current-place.md；修改navigation/provider.ts、TerrainMap.tsx、app/page.tsx、controls/workspace.css、README.md、本状态文件。无文件删除或新增依赖，原轨迹/照片/GPS/地图算法与存储保持。
- 源码已同步：功能提交75ef5c89db30f7953ed1dfc6a8dd6ffd2cac37a8已推送origin/main，git ls-remote核验一致，日志.openai/sync-place-name.log。状态收尾单独提交，最终SHA见.openai/sync-place-name-final.log。

# 当前任务：模型名称贴近与3D控制杆常驻（2026-09-07）
- 用户反馈添加标记名称离模型太远、3D控制杆消失；工作区干净，pull --ff-only确认e5d1c69为最新。
- 原因：模型按保存高程/偏移/埋深渲染，名称却使用地面Marker投影；相机俯仰与真实高度放大差距。cameraOpen受工具菜单“视角盘”反向开关控制，可被隐藏。
- 范围：annotations新增独立屏幕锚点计算并由AnnotationLayer用相同渲染矩阵更新名称偏移；app和ControlDock去掉隐藏开关，原绿色模型/旋转环常驻。存档、模型尺寸/高程/拖动流程、地形/天气/照片/GPS保持；回滚撤销本轮投影与视角控件接线。
- 已实现：modelLabel按相同Three渲染矩阵投影模型轮廓，名称下缘固定距轮廓6px；模型Marker保留原坐标用于点击/拖动，仅更新屏幕偏移，近裁面异常隐藏名称。移除cameraOpen条件与“视角盘”隐藏入口，原绿色模型/旋转环常驻；无新增依赖。
- 验证通过：TypeScript与38/38相关测试（投影间距/近裁面、三种模型/地上地下、选择拖动保留DOM与几何、路线节点拖动）；390×844、360×780实际名称间距、俯仰/旋转/缩放、地上地下切换、点击编辑与长按保存、键盘/指针控制杆、图层窗口互不遮挡、无溢出/运行错误通过。截图检查额外修复了模型名称被原地面遮挡判断误压暗，最终类型/逻辑/浏览器回归均通过。日志.openai/{typecheck-model-label-final,tests-model-label-final,browser-model-label-final}.log。
- 构建交付检查完成：最终网页与Android Java/DEX完整未签名构建成功，500项APK资源与mobile/dist逐项SHA-256一致。产物mobile/.build/Shantu-0.2.5-test-unsigned.apk为53996567字节，SHA-256 65c319fecda70ef3763de15d0ccf07eb95bb3ad49334811c98b01c6b89796f8a。日志.openai/{build-web-model-label-final,build-android-model-label-final,verify-model-label-apk}.log。交付截图两尺寸已查看，另一次等待地形就绪再放置/居中核验通过，日志.openai/browser-model-label-delivery.log。
- 文件清单：新增annotations/modelLabel.ts、tests/model-label.test.mjs、scripts/verify-model-label-browser.mjs；修改AnnotationLayer.ts、app/page.tsx、controls/ControlDock.tsx、tests/selection-editing.test.mjs、scripts/verify-outdoor-browser.mjs、README.md、docs/roads-models-domestic.md与本状态文件。删除视角盘隐藏入口/条件，无业务文件删除，无依赖或数据格式改变。原签名限制保持，无可安装新APK或Release，手机触控未做真机验收。
- 源码已同步：功能提交82df2d353d1042337bcb04a25e2138940311b9af已推送origin/main，git ls-remote核验一致，日志.openai/sync-model-label.log。状态收尾单独提交，最终SHA见.openai/sync-model-label-final.log。

# 当前任务：海拔着色透明度（2026-09-07）
- 用户要求海拔着色可调透明度。工作区干净，pull --ff-only确认最新1a444d8。
- 范围：map/types新增elevationColorsOpacity（默认1），LayerPanel开关下显示0–100%不透明度滑杆，panels.css提供44px触控区；TerrainMap同步color-relief-opacity；cartography地表填充放在海拔着色下方、半透明时显示底图；useMapTools同步现有配置接口。
- 高程算法、色带、地质/海拔互斥、其他图层与轨迹/照片/GPS不变。无新增依赖；关闭着色或窗口保留本次选择，仍沿用现有页面内图层设置生命周期。回滚撤销本轮参数/面板/图层顺序修改即可。
- 界面与逻辑验证通过：390×844、360×780检查0/50/100%实际MapLibre绘制参数、底图顺序、键盘/指针调整、关闭着色/窗口再开保留值、地质互斥与天气不透明度保持；44px滑杆、窗口≤38dvh/320px，无溢出或运行错误，关键截图已查看。TypeScript及14/14地质/高程相关测试通过，日志.openai/{typecheck-elevation-opacity,browser-elevation-opacity,tests-elevation-opacity}.log。
- 构建与资产核对通过：网页、Android Java/DEX完整未签名构建成功；APK内500项资源逐项SHA-256与mobile/dist一致，并含本轮透明度代码与样式。产物mobile/.build/Shantu-0.2.5-test-unsigned.apk为53996323字节，SHA-256 4bbd31dfba76578268865a944123cd3b3ccea65bedba42e81f51b83514c31076。日志.openai/{build-web-elevation-opacity,build-android-elevation-opacity,verify-elevation-apk}.log。
- 文件清单：修改modules/map/{types.ts,TerrainMap.tsx}、modules/cartography/cartography.ts、modules/controls/{LayerPanel.tsx,panels.css,useMapTools.ts}与本状态文件；新增透明度参数/滑杆，调整底图叠放，无文件删除，无新增依赖。网页预览已更新；原签名限制保持，本轮未签名APK不可安装，无新Release、未做安卓真机验收。
- 源码已同步：功能提交a597f2160c93485ae0412dcd27db60fcdaf01ee5已推送origin/main，git ls-remote核验一致，日志.openai/sync-elevation-opacity.log。状态收尾单独提交，最终SHA见.openai/sync-elevation-opacity-final.log。

# 当前任务：图层移出工具栏（2026-09-07）
- 状态：独立窗口、验证与源码同步完成；当前网页预览已更新，APK仍待原签名打包。
- 用户要求图层放到外部窗口，不放工具栏。开始工作区干净，pull --ff-only确认最新0070eb0。
- 范围：新增controls/LayerWindow.tsx和layerWindow.css，将观察模式与LayerPanel装入独立窗口，右上角44px常驻“图层”入口；app只接公共props与互斥panel状态；ControlDock移除图层菜单并不再承载图层窗口；Android返回键优先关闭新窗口。
- 保持：图层开关/图源功能、地图渲染、轨迹/照片/GPS与数据库不变；无新增依赖。回滚撤销本轮入口和窗口接线即可。
- 验证计划：390×844、360×780入口常驻、工具菜单移除、独立窗口开关/外点/Escape/安卓返回事件、图层切换与图源链接、关闭后状态保留、面板尺寸/遮挡/无溢出；类型检查与网页/安卓构建，再提交推送main。
- 实现与界面验证完成：右上角独立“图层”按钮与浮窗已接通；原工具菜单入口删除，ControlDock不承载此窗口，图源管理仍可从窗口进入。类型检查通过、localhost:3000返回200；390×844/360×780图层实际显隐、状态保留、按钮/外点/Escape/原生返回JS、图源跳转、面板互斥和遮挡检查通过。已查看layer-window-{390,360}.png，44px入口、≤38dvh/320px窗口，无横向溢出。日志.openai/{typecheck-layer-window,browser-layer-window}.log；网页与安卓构建开始。
- 构建验证完成：网页、安卓Java/DEX/完整未签名构建通过；500项APK资产逐项与mobile/dist一致，已检查独立窗口JS/CSS与DEX内返回键选择器。未签名包mobile/.build/Shantu-0.2.5-test-unsigned.apk为53996099字节，SHA-256 e66fad3efdb0069ae0e5928a6127ebbb4694ab5e7d22a053f1fe674f77c850a5；不可安装、无新Release，手机相机/触控未做真机验收。日志.openai/{build-web-layer-window,build-android-layer-window,verify-layer-apk}.log。
- 文件清单：新增modules/controls/{LayerWindow.tsx,layerWindow.css}；修改app/page.tsx、controls/ControlDock.tsx、Android MainActivity.java、docs/map-sources.md和本状态文件。删除工具菜单中的“图层”入口，无业务文件删除；无依赖/包名/签名变化，轨迹/照片/GPS/地图数据算法保持。远程main无新增提交，准备同步本轮成果。
- 源码已同步：功能提交1cddd71efa9d34412160e02d17a54917a1bb26d5已推送origin/main，git ls-remote核验一致，日志.openai/sync-layer-window.log；状态收尾单独提交，最终SHA见.openai/sync-layer-window-final.log。

# 当前任务：在线图源、二维码与离线地图导入（2026-09-07）
- 状态：功能、验证与源码同步完成；本机预览可用，手机原生权限与触控仍待真机验收，原签名APK限制保持。
- 用户要求图源选择、常见地图格式/二维码导入，已明确在线和离线两种都用。开始时main干净，已pull到8d3b14d；官方资料确认奥维二维码/ovmap含专有格式，不能声称全部通用兼容。
- 设计：新增独立modules/mapSources，类型/配置解析/IndexedDB/地图适配器/面板/二维码/离线Worker分开；工具→地图图源，以及图层页入口；切换保留地图实例与轨迹/照片/定位/天气叠加。在线优先XYZ/TMS、WMTS、WMS3857、TileJSON/常见XML配置；离线优先栅格MBTiles与GeoTIFF影像，读取与重投影放Worker，限定文件/像素/空间用量。
- 实现边界：只读取用户选择的文件；二维码先识别/预览，确认后添加。专有/加密ovmap、未知坐标或缺地理参考明确报错，不猜测地图位置。GCJ/BD偏移坐标不能冒充WGS84对齐；不代理任意图源URL，不把私人URL/密钥写进Git。原缓存只服务既有图源，不擅自批量下载新在线服务。
- 跨模块：app/ControlDock/LayerPanel接公共props；TerrainMap接独立图源适配器，底图显示由当前图源决定；安卓扫码增加受控相机权限，文件仍用系统选择器。业务轨迹/照片数据库、包名签名、地形高程数据算法保持，回滚可撤销本轮源码并保留新独立数据库。
- 已查资料：奥维137268-2/142734-2、MapLibre raster/image sources、Mapbox MBTiles1.3、jsQR/sql.js/geotiff.js/proj4官方。新增依赖安装中。下一步先完成图源选择/链接入口，再离线/扫码，验证两手机尺寸、格式/坐标/失败回滚/重载、类型检查/构建，提交推送main；原签名限制仍在。
- 实现已接通：modules/mapSources 的类型/在线配置/本机库/hook/面板/扫码/离线Worker/MapSourceLayer；支持栅格XYZ/TMS、WMTS地址、WMS3857、TileJSON、MOBAC XML，栅格MBTiles与WGS84/3857/UTM北向8位GeoTIFF（64MB/1600万像素/2048显示副本）。工具/图层入口、内置底图切换、离线范围定位及原叠加层保留已接线；相机新增仅本机HTTPS前台页面视频授权。
- 第一轮类型检查已修复通过；8项新增逻辑测试通过（真实SQL/TMS行号、GeoTIFF地理范围/UTM转换、非法投影/矢量/超限拒绝、配置相对地址）。localhost:3000返回200，已查看390px图源列表关键截图。两尺寸真实文件/二维码、离线显示与数据库重载回归运行中，尚未完成构建和交付。
- 最终源码与浏览器验证：TypeScript、148/148逻辑测试通过；390×844、360×780实际图源请求、二维码图片识别、相机拒权回退/真实Canvas视频流解码与结束释放、MBTiles Worker断网显示、GeoTIFF投影定位、3项保存/重载、移除回退、既有叠加层保留及配额事务回滚通过。修复开发环境Worker错误file://地址、透明缺瓦片、图源协议/旧Worker清理、当前项排序及冲突影像控件；已查看列表/MBTiles/GeoTIFF关键截图，面板≤38dvh/320px，无横向溢出。日志.openai/{typecheck-map-sources-final,tests-map-sources-final,browser-map-sources-final}.log。
- 网页与安卓完整未签名构建进行中；待检查Worker/WASM与APK静态资产一致，补交付状态、提交推送main。原密钥缺失限制保持，不发布错误签名包。
- 构建与交付验证完成：网页和Android Java/DEX完整未签名构建成功；APK内500项资产与mobile/dist逐项SHA-256一致，含SQL WASM、离线Worker和473张地形。未签名产物mobile/.build/Shantu-0.2.5-test-unsigned.apk，53995625字节，SHA-256为65bca3357baf33525753c0f35bb06bd93c1f42d056c7bc685fe72aeb080d2a4f，不可安装。通过生产资源模拟本机HTTPS网关，网络完全断开时MBTiles/GeoTIFF导入、重开、切换成功（浏览器模拟，非安卓真机）；关键截图已查看。日志.openai/{build-web-map-sources,build-android-map-sources,verify-map-source-bundle}.log。
- 交付文档docs/map-sources.md与mobile/README.md包含格式矩阵、限额、模块接口和回滚；新增4个运行依赖/SQL类型、14个图源模块文件、原生相机权限适配、3个验证/样本生成脚本与测试。无业务文件删除；轨迹/照片存储、GPS精度、天气/高程算法、包名与预期证书保持。源码待本轮提交推送main；无新Release，原APK不含本轮更新，仍需原签名电脑打包。
- 提交前核对：远程origin/main无新增提交；无业务文件删除、无私钥或本机地图进入Git。加强瓦片验证（MapLibre完整SourceCache就绪、生产Worker实际返回PNG瓦片字节）后两尺寸与断网生产资源回归通过，日志.openai/{browser-map-sources-delivery,verify-map-source-bundle-final}.log。截图仅合成测试地图，不含用户数据。
- 已同步：功能提交70408a3a55308aa0dfedbfd89aeb54e32f5b0f2d已推送origin/main，git ls-remote核验一致，日志.openai/sync-map-sources.log；状态收尾另行提交，最终远端SHA见.openai/sync-map-sources-final.log。无新Release，旧0.2.4安装包不含本轮功能。

# 当前任务：山兔更名与全球地图入口（2026-09-07）
- 用户要求去掉左上角成都/川西地址，改为面向全球，软件更名“山兔”。开始时main干净，git pull --ff-only已同步bf78f13。
- 范围：config/product、网页/安卓名称与分享/导出文案，页头移除固定地区，INITIAL_VIEW改世界地图视角、最低缩放3→0、无地域无障碍标签；AGENTS/说明记录新定位。地图搜索已有全球坐标输入和近点排序，无国家范围过滤。
- 保持：旧Android包名/签名指纹、GuanyunNative桥、数据库/本机存储键/备份格式、既有轨迹照片；地形来源署名与局部覆盖如实保留，不更改地图/天气服务算法。APK新产物名Shantu，旧Release链接保持真实。
- 验证计划：手机390×844/360×780页头与世界视角、海外坐标/重置/URL位置恢复、已有备份兼容，类型检查/相关测试/网页与安卓构建，再提交推送main。本机仍缺原私钥，不发布错误签名APK。
- 实现与界面验证完成：页头只保留“山兔”与世界地图按钮，网页/安卓名称、照片和备份导出文案更新；旧存储标识与签名配置保持。TypeScript、140/140既有测试通过；390×844与360×780检查默认世界视角、最小缩放、伦敦/东京坐标、URL重载恢复及世界视角按钮通过，无横向溢出/运行错误。已查看世界地图两尺寸及伦敦关键截图；日志 .openai/{typecheck-shantu,tests-shantu,browser-shantu-global-final}.log。
- 构建与资源核对通过：网页、安卓Java/DEX/完整未签名构建成功，aapt确认application-label为“山兔”；489项内置资产逐项SHA-256与mobile/dist一致（含473张地形）。未签名产物mobile/.build/Shantu-0.2.5-test-unsigned.apk，53429228字节，不可安装。日志 .openai/{build-web-shantu,build-android-shantu,verify-shantu-apk-assets}.log。
- 交付范围：文件清单与回滚见docs/shantu-global.md，删除固定地区页头/样式，无业务文件删除，无新增依赖；原轨迹/照片、包名/签名、服务算法不变。没有发布新Release，没有宣称安卓真机已改名。
- 源码已同步：d07e7217d8211585c7593b65b435cec4aab3d470已推送origin/main并经git ls-remote核验一致，日志.openai/sync-shantu.log；状态收尾另行提交，最终远端SHA记录.openai/sync-shantu-final.log。

# 当前任务：照片放大、编辑标记、分享与拍摄环境（2026-09-07）
- 已同步 main（efe2336），工作区原本干净。现有照片仅960px预览，无缩放/编辑/分享；导入未读取EXIF海拔。
- 设计：photos 独立详情/手势/批注/导出/拍摄天气模块，保留小地图预览，主动放大进入全屏；查看副本最长边2560px，旧照片兼容。非破坏性标题备注/旋转/画线，分享生成带拍摄信息的图片副本。
- 范围：modules/photos、app/page.tsx props、安卓独立照片分享provider/bridge/manifest；记录筛选、地图算法、天气图层不改。通过可选字段兼容旧IndexedDB，原图不修改；回滚可撤销本轮源码，保留照片数据。
- 环境信息：海拔优先EXIF，再取同段对应轨迹点/插值并标来源；拍摄天气用Open-Meteo历史ERA5或最近日期模型数据，保存来源/时次/获取时间，缺失明确提示并可重试。不能称现场实测。
- 状态：功能、验证与源码同步完成；原APK签名限制仍在，不发布错误签名包。
- 实现完成：独立 details/weather/PhotoStage/PhotoLightbox/export；1–6倍缩放、双指/拖动、旋转/标题/备注、三色画线/撤销/清空、可预览的信息分享图；原生JPEG保存与只读临时分享provider。元数据补写使用原子patch，删除后不复活，重导入保留编辑；查询并发2个、15秒超时、15分钟内存缓存，失败可重试。
- 已验证：TypeScript、140/140逻辑测试；390×844 / 360×780实际文件导入、Chromium真实双指事件、旋转画线/单点标记/撤销、天气失败重试、JPEG下载、系统分享边界模拟、重导入/重载/并发写/清晰副本尺寸均通过。原照片导入回归两尺寸通过。已查看最终关键截图与导出JPEG，修正旧预览CSS覆盖详情字号，标记线宽与导出一致；真实EXIF字节方向标志读取负海拔回归通过。
- 真实接口：Open-Meteo ERA5查询2026-08-20 02:00UTC成都位置成功，返回25.3℃/0.2mm/1.65m/s；仅证明指定历史时次接口可达，非照片现场实测。日志 .openai/live-photo-weather.log。
- 最终构建：网页、安卓Java/DEX/完整未签名包通过；489项资产逐项SHA-256与mobile/dist一致，含473张地形。产物mobile/.build/Guanyun-0.2.5-test-unsigned.apk，53429254字节，不可安装。最终日志 .openai/{tests-photo-detail-final,typecheck-photo-detail-delivery,browser-photo-details-delivery,browser-photos-regression,build-web-photo-details-delivery,build-android-photo-details-delivery,verify-photo-apk-assets}.log。
- 交付范围与限制：文件清单/接口/回滚见 docs/photo-details.md；无新增依赖、无业务文件删除、无原图修改。记录/地图/天气图层算法保持。原0.2.4 APK没有变化，无新Release；原生分享选择器和手机触控仍缺真机验收。
- 源码同步：功能提交 a542c9a319a8d6761f2da8c52a40d29a67dae1eb 已推送 origin/main，git ls-remote 核对一致，日志 .openai/sync-photo-details.log；状态收尾单独提交并在 .openai/sync-photo-details-final.log 核验最终远端SHA。

# 当前任务：手动记录精度门槛（2026-09-07）
- 用户询问记录点与刷新点关系、反馈飘移并要求可调 GPS 精度。已核对：安卓 GPS/网络均请求最小4秒/5米；网页约1.5秒读取原生存档，地图跟随最后接受的记录点。旧门槛固定80米，另有20秒过期、80m/s跳变与5米/30秒采样过滤，刷新不等于新增记录。
- 本轮范围：新增 outdoor 记录精度偏好与折叠设置UI，recording/useRecording 与 Android RecordingStore/NativeBridge 配置筛选；默认20米，整数5–80米。设置只影响后续定位点，旧存档继续按历史格式读取。地形、天气、照片匹配、路线算法与原生定位请求频率保持。
- 设计边界：设置是系统估计误差的接受门槛，不能提高GPS硬件精度或保证消除漂移。不伪造定位、不插值补点；更严格时提示等待更好信号。旧APK桥不支持时显示真实旧80米门槛并禁用设置。
- 实现完成：独立 recordingPreferences/useRecordingPreferences/RecordingPrecision 与 Java RecordingPreferences；浏览器 localStorage / 安卓 SharedPreferences 分别保存，应用后对新点生效。新门槛不用于验证历史存档。过滤提示单独显示，Android拒绝点不触发整条存档重写。
- 验证：TypeScript、135/135逻辑测试通过；390×844浏览器真实回调模拟验证10米门槛拒绝30米、接受8米，以及运行中50米接受后续30米；360×780模拟原生配置桥验证校验、保存/重载。两尺寸无横向溢出，已查看关键截图；设置控件压为一行，窄屏应用按钮可达。Android Java编译通过。日志 .openai/{tests-recording-accuracy,browser-recording-accuracy-final,typecheck-recording-accuracy-final,java-recording-accuracy}.log。
- 最终界面回归：输入4米被拒绝、恢复默认20米、10米设置重载保留、运行中放宽到50米均通过。实际截图确认360窄屏输入/应用/恢复同一行可达；过滤点未进入存档，有效点正常计数。日志 .openai/browser-recording-accuracy-delivery.log。
- 构建验证：网页与完整安卓未签名构建通过，473张内置地形和必要资源校验通过；最终类型检查退出0。日志 .openai/{build-web-recording-accuracy,build-android-recording-accuracy,typecheck-recording-accuracy-final}.log。
- 源码同步：415b0a3c896cb2be19e5baf258185dfc7648cd3e 已推送main并通过 git ls-remote 核验一致；日志 .openai/sync-recording-accuracy.log，最终状态收尾另行同步并记录 .openai/sync-recording-accuracy-final.log。
- 交付限制：沿用0.2.5待签名源码版本，原私钥缺失，不能发布可覆盖新包；没有声称真机漂移/耗电得到改善。文件及回滚说明见 docs/recording-accuracy.md；本轮无删除业务文件，没有改照片/轨迹存档/地图算法。

# 当前任务：实走存档分类与照片文件夹导入（2026-09-07）
- 用户反馈：实走保存后显示为手绘，照片页不能选择；照片选择器没有文件夹入口。
- 已定位：列表标题统一写成手绘；续画保存重建对象时丢失 samples，反向/合并也可能破坏时间点对应；照片页 preferred/target 无效时未回退。正常“保存到轨迹”路径本身包含时间。
- 修改范围：tracks 分类与原始记录保护、outdoor 保存接口、photos 轨迹选择/文件夹导入、Android AppFiles 目录选择；仅通过公共类型/props 接线。地形、天气、地质和路线计算不改；旧草稿继续保留在 stash。
- 验证计划：保存后重载/照片匹配、旧格式、手绘副本不破坏原始记录、目录筛选/限额/取消；390×844 与 360×780 界面、类型检查、全套测试和构建。只保留关键截图及 .openai 日志。
- 当前限制：本机缺少 0.2.4 使用的签名文件，现有证书不同，已询问文件路径；不得声称新包可覆盖安装。ADB 无设备。
- 实现完成：新增 tracks/provenance、outdoor/savedRecording、photos/PhotoPicker/selection 和 Android PhotoDirectory；记录保存读回确认后再清理检查点并进入照片页，旧 samples 兼容，原始记录节点保护/手绘副本、失效选择回退、目录递归筛选及数量限制已接通。未删除业务文件。
- 逻辑验证：TypeScript 与 132/132 测试通过；新增保存/重载/真实时间对齐、缺时间与暂停、存储失败/静默写失败、旧轨迹及目录过滤/200张限制测试。浏览器两尺寸回归正在执行，尚未声称安卓目录实机可用。
- 签名核查：本机 mobile/.build/guanyun-test.jks 证书为 4a941b9d…，已发布 0.2.4 为 a3aa453c…；已查项目/下载/开发目录，没有同证书的本机密钥。新增 config/android-signing.json 固定预览包名及公开证书指纹；build-android.ps1 支持 SigningKey / GUANYUN_SIGNING_KEY 并拒绝缺失/不匹配证书，已实际验证阻止错误签名。UnsignedOnly 仅用于完整编译与资产验证，不是可安装交付。
- 最终功能验证：TypeScript、132/132 逻辑测试、390×844/360×780 保存→重载→照片匹配→手绘副本→原始记录一致全部 PASS；原照片 EXIF/校时/去重/重载/聚合/显隐/移除两尺寸回归 PASS。安卓目录桥 Java 编译 PASS，浏览器真实文件夹导入 PASS；原生系统选择器仍缺真机验收。
- 界面检查：查看 recording-photo-picker-360-780、recording-photos-360-780、recording-preserved-390-844 等关键截图。初查目录选择落入滚动区域，已改为并排44px入口，两尺寸最终回归通过；无横向溢出、原3D控制器可见。截图在 artifacts/screenshots，未入 Git。
- 构建：网页与完整安卓未签名构建 PASS；489 项静态资源逐项SHA-256对应（含473张地形）。产物 mobile/.build/Guanyun-0.2.5-test-unsigned.apk 不能安装，不是发布包。错误证书拒签回归PASS。日志 .openai/{typecheck-record-photos-final,tests-record-photos-final,browser-record-photos-compact-025,browser-existing-photos-025,build-web-record-photos-final,build-android-record-photos-final,verify-unsigned-apk-025,signing-guard-025}.log。
- 源码交付：功能提交 3c1cfb9d31ff1e0020bfa0d6870268a5dc05a993 已推送 origin/main，git ls-remote 核验一致；最终状态单独提交。同步日志 .openai/sync-record-photos-025.log，收尾 SHA 见 .openai/sync-record-photos-final.log。
- 交付限制：0.2.5-test/code12 仍待原签名打包，没有新 Release，也没有替换 0.2.4。原签名电脑拉取后可直接按既有命令构建；本机不能从公开证书或APK还原私钥。原始地形、天气、地质、卫星和路线计算不变，无业务文件删除，无密钥/本机数据/旧草稿上传。

# 当前任务：轨迹时间匹配相册照片（2026-09-07）
- 当前目标：选择手机照片，按拍摄时间匹配已有实走/带时间 GPX 轨迹，地图缩略图与预览，打包并同步 GitHub。
- 当前进展：photos 模块已接通 EXIF 原始时间/时区解析、同段两分钟内估算匹配、逐张时间/整体分钟校正、IndexedDB 去重存储、地图小图聚合与查看/移除。Android 文件选择器按类型与多选模式返回所选 URI，不申请整库相册权限；新增照片预览返回键处理。
- 文件：新增 modules/photos/ 的匹配/导入/存储/hook/PhotoPanel/PhotoLayer/PhotoViewer/样式、tests/photo-matching.test.mjs 与三张合成图片样本、scripts/verify-trip-photos.mjs、docs/trip-photos.md；更新 outdoor/app/map 接口、双入口样式、安卓多选与返回、版本/依赖和说明。无业务文件删除；记录及原 3D 控制器保留，剖面停用。
- 命令：git status、git diff --stat、git pull --ff-only；核对轨迹和安卓接口；查阅 exifr 与 Android FileChooserParams 官方说明，安装 exifr 7.1.3。
- 验证结果：PASS。TypeScript、128/128 测试；真实生成 JPEG EXIF 原始时间与时区，断点/缺时间/歧义/日期线、安卓返回优先级通过。首轮 390×844/360×780 浏览器实际文件导入、校时、按时间定位、去重、竖拍旋转、IndexedDB 重载、照片聚合/翻页/显隐/移除和无溢出通过。已查看 artifacts/screenshots/photos-{match-390-844,map-360-780}.png，地图预览限高且原控制器可见；导入已压缩为选择/确认两步，校时折叠、确认按钮固定，最终照片配额事务和 UI 回归通过，原位置跟随与路线/途经点/行程预览两尺寸回归全部 PASS。日志 .openai/{tests-photos-second,browser-photos,typecheck-photos-final}.log。
- 当前阻塞：无。
- 构建结果：PASS。网页及安卓编译完成，APK v2/v3 签名与旧测试版一致；559 项静态资源逐项哈希匹配（含473张地形），照片 EXIF/存储/地图代码已包含。APK/Guanyun-0.2.4-test.apk，58736849 字节，SHA-256 a3a7c582b8de33ee7844b7d33e2373cac93ac0c1ac5a4508ff957ee72d0acafb。未连接 Android 真机，系统多选/HEIC/触控待设备验收。
- 最终日志：.openai/{tests-photos-final,typecheck-photos-final,browser-photos-quota-final,browser-follow-photos-regression,browser-routes-photos-regression,build-web-photos,build-apk-photos,verify-apk-photos-024}.log。
- 发布结果：PASS。源码 ad63b4e00308841126d3066e5f0023ebb0ca043d 已推送 main 并核验远端一致；https://github.com/Siger1989/map/releases/tag/v0.2.4-test 已公开发布（draft=false、prerelease=true），指向该构建提交。APK/校验/安装说明三个附件均 uploaded，服务器大小/哈希与本地一致。日志 .openai/{sync-photos-024,upload-apk-024,publish-apk-024,release-apk-024-verified}.log。
- 下一步：本轮完成，提供网页下载链接，可覆盖 0.2.3；安卓系统选图和真机体验待用户反馈。本状态收尾单独提交，最终 main 核验写 .openai/sync-photos-024-final.log。

# 当前任务：实走记录的位置跟随（2026-09-07）
- 当前目标：修复记录轨迹时地图不跟随，自动跟随新定位、支持手动浏览/恢复，交付新版 APK 并同步 GitHub。
- 当前进展：跟随已接通；开始/继续记录自动开启，手动拖图与其他位置浏览暂停、按钮恢复。复用记录点同步相机/位置图层/行程进度，保留原缩放俯仰朝向，处理旧点/重复快照、地图未就绪、前后台和编辑互斥。
- 文件：新增 modules/position/{follow.ts,useFollowPosition.ts}、tests/position-follow.test.mjs、scripts/verify-position-follow.mjs、docs/position-follow.md；更新 TerrainMap / MapActions / RouteWeatherRail / app、路线回归脚本、文档及安卓版本。无业务文件删除；原 3D 控制器和记录存档格式保留，剖面仍停用。
- 命令：git status、git diff --stat、git pull --ff-only（已同步）；读取项目规范、说明、定位/记录与相机源码。
- 验证结果：PASS。TypeScript、124/124 测试；浏览器 390×844 模拟 GPS 与 360×780 模拟安卓记录桥均通过自动跟随、触摸拖图暂停、恢复、相机参数保留、重复快照、过旧点等待、记录暂停/继续/结束与普通位置跟随。旧路线脚本两尺寸及预览/跟随互斥回归通过。位置与高频罗盘同时跟随、缩放后继续跟随通过。最终独立浏览器回归日志 .openai/browser-follow-delivery-final.log。截图 artifacts/screenshots/follow-{web-390-844,native-360-780}.png，已查看 PASS，无溢出、原控制器可见。日志 .openai/{typecheck-follow-final,tests-follow-023,browser-follow-023-final,browser-routes-follow-regression}.log。
- 当前阻塞：无。
- 构建结果：PASS。最终网页/安卓构建、TypeScript、124/124 测试、v2/v3 签名通过，554 项静态资源逐项哈希一致（含 473 张地形瓦片）。APK/Guanyun-0.2.3-test.apk，58126139 字节，SHA-256 a66ef5786d5d212f34513fb82de1756bd9cc0efe9217e0f6a366a2d925c24bec；code10，包名 preview 与 0.1.4 起签名一致。日志 .openai/{build-web-follow-final,build-apk-follow-final,verify-apk-follow-023,typecheck-follow-final,tests-follow-final}.log。
- 验证过程：并行生产构建期间的回归遇到页面导航重载而超时；构建完成后独立重跑两尺寸全部通过。ADB 无设备，模拟记录桥不能代替真机 GPS/触控/锁屏/耗电验收。
- 发布结果：PASS。源码 7997bc0d5b886fa45eb7b19ea19e3f6fd95ac669 已推送 main 并核验远端一致；https://github.com/Siger1989/map/releases/tag/v0.2.3-test 已公开发布（draft=false、prerelease=true），指向该构建提交，APK/校验/安装说明三个附件 uploaded，服务器大小/哈希与本地一致。日志 .openai/{sync-follow-023,upload-apk-023-second,publish-apk-023,release-apk-023-verified}.log。
- 下一步：本轮完成；提供网页下载链接，可覆盖安装 0.2.2，真机 GPS/触控体验待用户反馈。本状态收尾单独提交，最终 main 核验写 .openai/sync-follow-023-final.log。

# 当前任务：同步 GitHub 与完善最新说明（2026-09-07）
- 当前目标：同步源码，补齐 0.2.2 使用说明并更新 GitHub Release 下载页。
- 当前进展：已新增最新详细说明，修正 README/安卓/跨设备文档中旧版本、旧菜单、剖面开启和无原生桥等过时描述；GitHub 0.2.2 Release 正文已更新。
- 文件：README.md、mobile/README.md、docs/continue-development.md、新增 docs/release-0.2.2.md、CURRENT_STATE.md、LOG.md；仅文档，不重新构建 APK。
- 命令：git status、git diff --stat、git fetch origin main、git pull --ff-only、git rev-list --left-right --count HEAD...origin/main；读取项目规范及相关源码。
- 验证结果：PASS。文档本地链接、版本与清单、功能接口、git diff --check 核对通过；GitHub Release 正文回读一致，标签/构建提交/名称/发布状态及全部附件 ID、大小、哈希保持原样，APK SHA-256 与本地一致。仅文档改动，未重跑业务测试或构建；122 项测试等为原 0.2.2 发布验证记录。日志 .openai/{docs-sync-022-validation,docs-release-022-verified}.log。
- 当前阻塞：无。
- 同步结果：PASS。文档提交 068c5ef 已推送 main，git ls-remote 核验与本地一致；Release 正文已更新，APK 和三个既有附件保持不变。本状态收尾另行提交，最终 SHA 记录 .openai/docs-sync-022-remote.log。
- 下一步：本轮完成。本轮不重新构建 APK；未新增/删除业务模块，地图与手机数据不受文档更新影响。

# 当前交付：地点直接输入、途经点排序与细长可拖行程条（2026-09-07，完成）
- 当前目标：按用户截图改进路线操作；起终点就地输入搜索、添加途经点、手机拖柄排序；左侧行程条更长更细，拖动联动地图预览和沿途天气。
- 当前进展：地点栏改为直接输入与原位搜索结果，支持 8 个途经点、增删、地图选点及触摸/键盘排序；多点请求、途经点地图编号和收藏恢复已接通。细长色带连续预览，独立游标同步地图中心，保留真实 GPS 进度；预览时不触发普通 moveend 的轨迹重传/卫星天气请求。原 3D 控制器仍默认显示。
- 文件：navigation 地点列表/provider/类型/收藏与 RoutePanel；journey 预览采样/RouteWeatherRail/CSS；地图预览游标接口、app 接入；版本与文档/验证。
- 命令：git status、git diff --stat、读取项目规范、git pull --ff-only（已同步）；查阅 Valhalla 官方 API，确认 locations 按顺序访问、break 支持独立路段。
- 验证结果：首轮 PASS。TypeScript、122/122 逻辑测试；真实 Valhalla 三点请求返回 3 个吸附点、10 个步骤。390×844 / 360×780 浏览器通过直接输入、地图起点选择、真实触摸拖柄排序、请求顺序、连续进度拖动、收藏恢复和 460px 键盘压缩视口。截图 artifacts/screenshots/route-{input,scrub}-{390-844,360-780}.png 与 route-keyboard-{390,360}.png；PASS。首次脚本搜索结果正则漏空格，修正定位器后通过，非产品故障。
- 当前阻塞：无。
- 下一步：本轮开发、验证、构建与交付完成，可覆盖安装 0.2.2-test/code9，真机体验待用户反馈。最终 TypeScript、122/122 测试、网页和安卓构建 PASS；548 项静态资源逐项哈希一致，v2/v3 签名保持旧测试证书。APK 57568587 字节，SHA-256 588c97933a538ae9a7896d87f1b6a008b002a4bef150340ee7ab203589c5a334。原 3D 控制器保持默认显示；剖面仍停用。
- 最终日志：.openai/{typecheck-routes-final,tests-routes-final,browser-routes-final,live-route-multistop,build-web-routes-022,build-apk-routes-022,verify-apk-routes-022}.log。Android 增加 IME inset/adjustResize；无连接真机，系统键盘和触控仍待设备实测。未新增依赖、未删除业务文件，旧收藏与户外存档保持兼容。

- 发布结果：PASS。源码 ea7506a1a775ec26c34e8e9aec2cfa1250550282 已推送 origin/main 并核验远端一致；https://github.com/Siger1989/map/releases/tag/v0.2.2-test 公开发布（prerelease=true、draft=false），指向该构建提交，APK/校验/说明三份附件状态、大小和 SHA-256 与本地一致。日志 .openai/{sync-routes-022,upload-apk-022,publish-apk-022,release-apk-022-verified}.log；最终状态随后单独提交，不涉及构建源码修改。

# 当前交付：恢复原 3D 控制器（2026-09-07，完成）
- 当前目标：按用户要求保留原有绿色模型与圆环 3D 视角控制器，默认常驻，再交付 APK。
- 当前进展：仅把 CameraGizmo 默认开关恢复为 true；保留原组件外观、手势、尺寸与位置。版本升至 0.2.1-test/code8；已有工具开关仍可临时收起，剖面保持停用。
- 文件：app/page.tsx、AndroidManifest、MainActivity 版本标识、既有浏览器验证默认值、README/mobile README、本状态和 LOG。无新增业务模块、无删除文件，其余户外功能和存档不变。
- 命令：git status、git diff --stat、读取项目说明、git pull --ff-only（已同步）。
- 验证结果：PASS。TypeScript、118/118 测试、网页/APK 构建；390×844 和 360×780 默认显示、真实拖动俯仰/旋转、工具收起重开、无溢出及避开底栏通过。截图 artifacts/screenshots/camera-restored-{390-844,360-780}.png，PASS；无须调整控制器样式。APK 544 项静态资源哈希匹配，v2/v3 签名与旧版一致。无真机触控验收。
- 当前阻塞：无。
- 下一步：本轮完成，可覆盖安装 0.2.1-test。APK 大小 57248773，SHA-256 9e8cc86bac4f3b05154fa71fd068a22c233af0e23f91ef7b91935955ca1e34e8。日志 .openai/{typecheck-camera-021,tests-camera-021,browser-camera-021,build-web-camera-021,build-apk-camera-021,verify-apk-camera-021}.log。

- 发布结果：PASS。源码 75ee9239792bbf3ab45f9f2779102948a57ebb43 已推送并核验；https://github.com/Siger1989/map/releases/tag/v0.2.1-test 已公开发布为测试版，目标为该提交，APK、校验和安装说明的远端大小/哈希均匹配。日志 .openai/{sync-camera-021,upload-apk-021,publish-apk-021,release-apk-021-verified}.log。最终仅提交本状态收尾。

# 当前交付：户外实用版与极简地图 UI（2026-09-07，完成）
- 当前目标：按用户授权优化可靠轨迹记录、离线行程、标准文件导入导出、沿途天气与地图性能；减少常驻 UI 占用，优先国内免费图源，完成新版 APK 和 GitHub Release。
- 当前进展：已接入独立 outdoor 模块（轨迹记录、GPX/KML/KMZ 导入与数据备份、可续传离线包）、Android 定位前台服务/文件选择器；UI 三入口和折叠视角盘、默认开源底图及较少动态图层。剖面继续停用。
- 实施顺序：独立 outdoor 模块负责记录、文件交换/备份和离线行程；安卓 location 前台服务和用户文件选择/导出；地图原生协议离线缓存；紧凑工具入口、默认减少云雨/等高线负担；沿途天气出发时间比较；双入口和 APK 验证。
- 国内图源：已有天地图适配需要应用 Key，已向用户询问。无需 Key 的国内公开瓦片目前未确认完整外部使用/缓存授权，不使用来源不明的私有 Key。无 Key 仍继续开发，保留可用基础来源与本地地形。
- 文件：计划新增 modules/outdoor/ 与安卓 RecordingService/RecordingStore/AppFiles/NativeBridge；按接口修改地图、页面、控件、现有存档刷新、国内图源配置、天气缓存和版本/文档。
- 命令：git status、git diff --stat、git pull --ff-only、读取 AGENTS/README/CURRENT_STATE/LOG 和相关源码；官方资料检索。
- 验证结果：PASS。最终 TypeScript、118/118 测试、双手机尺寸 UI、GPX/KML/KMZ 交换与非法文件拒绝、真实离线缓存渲染、网页和 APK 构建、v2/v3 签名及 541 项静态资源逐项哈希均通过。ADB 无设备，真机未验证。
- 当前阻塞：无。用户询问其他开源来源，已采用无 Key 的 OpenFreeMap / OSM，不声称其服务器位于国内。
- 下一步：本轮开发、构建与交付完成。可覆盖安装 0.2.0-test；用户真机短途、锁屏定位和耗电体验待反馈。
- 本轮验证：PASS。118 项逻辑测试；390×844 / 360×780 UI（地图优先、浮窗 ≤38dvh/320px、避开快捷按钮、无横向溢出）、GPX 导入/JSON 下载、视角盘开合、记录暂停继续、页面异常均通过。截图 artifacts/screenshots/outdoor-{map,panel}-{390-844,360-780}.png；PASS。地图来源收起后可点开，剖面停用。
- 离线验证：PASS。独立上下文下载 298 项 / 39,796,624 字节，切断外网和 /api/terrain 后重新加载仍有 4 张可渲染矢量瓦片和道路要素；删除一个字体缓存后完整性报告缺失 1 项。截图 artifacts/screenshots/outdoor-offline-390.png；PASS。首次离线脚本使用 MapLibre 旧私有 _tiles 字段失败，改用当前 getRenderableIds 后通过，产品离线下载本身成功。
- 构建验证：网页生产构建和第三轮 APK 编译/DEX/签名 PASS，473 张内置地形完整；最终 APK 已包含后续 GPX 元数据/界面修正。ADB 无连接设备，原生锁屏定位、安装、触控和耗电未实测。日志 .openai/{tests-outdoor-final,browser-outdoor-final,offline-outdoor-second,build-outdoor-web,build-apk-outdoor-third}.log。

- 最终 APK：APK/Guanyun-0.2.0-test.apk，56,974,093 字节，SHA-256 ba1409082d2074c1176936af3b07fd45866f7ddc221db307548e1a1800b573e8；包名 preview，versionCode 7；沿用 0.1.4/0.1.5 签名 a3aa453c7fa05d8a5d54a11c648edbcc02297b064db50e44bcfea2b0b91cd29c，可覆盖安装。APK/校验/安装说明不进入源码 Git；签名密钥未上传。
- 最终日志：.openai/{typecheck-outdoor-final,tests-outdoor-final,browser-outdoor-final,exchange-outdoor,offline-outdoor-second,build-outdoor-web-final,build-apk-outdoor-final,verify-apk-outdoor-assets}.log。无删除业务文件。标记/手绘/收藏存档保持兼容，剖面仍为 false。

- GitHub 交付：功能提交 6cd41327f96346b155c88b40f3a8239f7529771b 已推送 origin/main 并通过 ls-remote 核验。Release https://github.com/Siger1989/map/releases/tag/v0.2.0-test 已公开发布（draft=false、prerelease=true），指向该构建提交；APK/校验/安装说明三个附件均 uploaded，服务器大小与 SHA-256 匹配本地。签名密钥和本机日志未上传。最终状态收尾随后提交同步，不涉及构建源码修改。
- 发布日志：.openai/{sync-outdoor,upload-apk-020,publish-apk-020,release-apk-020-verified}.log。

# 当前任务：暂时停用剖面（2026-09-06）
- 当前目标：按用户“先不要这个功能”的要求停用全部剖面入口及运行接入。
- 当前进展：新增统一功能开关为 false；入口隐藏，剖面状态强制关闭，地图不创建 GPU 包装器和切面图层。历史实现保留，不恢复旧剖面。
- 文件：config/features.ts、app/page.tsx、TerrainMap.tsx、MapActions.tsx、README、docs/elevation-section、LOG、CURRENT_STATE。无文件删除，其他业务模块和存档不改。
- 命令：git status、git diff --stat、git pull --ff-only、读取当前说明及接入文件。
- 验证结果：PASS。TypeScript、113/113 逻辑测试、网页与安卓静态页面构建通过；390×844/360×780 浏览器确认无剖面入口/面板/手柄/图层，WebGL shaderSource 为原生函数，无横向溢出，二维/三维切换和页面错误检查通过。截图 artifacts/screenshots/section-disabled-{390-844,360-780}-20260906.png；PASS，正常地图和右侧工具可达。日志 .openai/{typecheck,tests,browser,build}-disable-section*。
- 当前阻塞：无。
- 下一步：保持剖面停用，等待后续指示；本轮不重打 APK。源码按项目规范同步 main，最终远程核验记入 .openai/sync-disable-section-20260906.log。

# 当前交付：自由矩形剖面（2026-09-06）

- 当前目标：把固定海拔削顶改成可摆放的矩形剖切面，裁去观察侧山体并显示相交轮廓。
- 当前进展：实现并验证完成。点击剖面创建当前视野的矩形；中心拖动、四角缩放，位置/海拔、方位/倾斜/面内旋转及颜色可调。矩形外与背侧地形保留，转到背面自动换侧；模型同步裁切封口。原 elevation DEM 保持不变。
- 修改文件：新增 modules/section/{PlaneSectionLayer,planeMath,planeModels,terrainClip}.ts、scripts/verify-plane-browser.mjs、tests/section-plane.test.mjs；修改 SectionPanel.tsx、section.css、types.ts、TerrainMap.tsx、AnnotationLayer.ts、MapActions.tsx、app/page.tsx、README、docs/elevation-section、LOG 与本状态。没有删除文件；旧水平算法保留用于历史回归但产品入口改用新平面。天气、导航、数据来源、模型/轨迹存档不变。
- 命令：git status、git diff --stat、git pull --ff-only；oxfmt；npx tsc --noEmit；node --experimental-strip-types --test tests/*.test.mjs；node scripts/verify-plane-browser.mjs；npm run build；npm run build:android:web；git diff --check；本地 HTTP 请求。
- 验证结果：PASS。TypeScript、113/113 逻辑测试、网页生产构建、安卓静态页面构建和本地 HTTP 200。真实 Edge WebGL 像素、中心拖动、角点缩放、倾斜/面内旋转/水平面、背面换侧、改色、退出重开全部通过；操作时原 elevation 的 setTiles 调用为 0，WebGL/page errors 为空。
- 手机截图：artifacts/screenshots/free-plane-mobile-{390-844,360-780,360-460}-20260906.png；PASS，390/360 竖屏不横向溢出，调整面板低于 38dvh/320px 且避开右侧工具；360×460 短屏参数内部滚动，退出后重新进入可操作。最初发现短屏视角盘/展开署名挡入口，已将视角盘移左并提高右侧工具层级；最终通过。
- 地形截图：artifacts/screenshots/free-plane-{front,tilted,rolled,horizontal,back,color}-20260906.png；PASS，真实川西地形被有限矩形切开、轮廓与白/红封口可见，换侧/角度正确；未加载部分不补零。
- 日志：.openai/{typecheck-free-plane-final,tests-free-plane-final,browser-free-plane-final2,build-free-plane-web,build-free-plane-mobile}-20260906.log。初次 dev 尚未就绪连接失败、两次短屏遮挡过程保留在 browser-free-plane* 日志；长日志/截图已被 Git 忽略。
- 验证限制：这是原地形 GPU 显示裁切，不是通用网格 CSG；切面轮廓受 64×32 网格与当前 DEM/LOD 精度限制，开口两侧不补实体墙。适配器针对 MapLibre 6.7，升级须重跑 shader 与浏览器检查。没有手机触控/帧率实测；没有重打 APK，手机上已安装的 0.1.5 不会自动获得此次改动。
- 当前阻塞：无。
- GitHub 同步：功能提交 55dff54b4a761cb10a5f42ad3be724b97e12fc33 已推送 origin/main，git ls-remote 核验远程与本地 SHA 一致。本状态收尾随后提交同步，最终 main 以 git log 为准。
- 下一步：本轮功能实现、验证和源码同步完成，本地预览 localhost:3000 可用；如需手机安装新功能，后续另行构建新版 APK。真机性能与手感待设备验证。

# 天气观察软件 · 当前状态

## 当前任务：手机标记面板减少遮挡（2026-09-06）
- 当前目标：按用户手机竖屏截图优化标记与模型面板，分开列表/编辑与参数分组，地图调整时收起；将手机遮挡检查写入项目规范。
- 当前进展：列表与编辑分开，参数分尺寸/外观/位置/更多；编辑入口固定、内容内部滚动，面板左上限高 38dvh / 320px，避开右侧地图工具。地图调整收起参数，只保留紧凑工具条。AGENTS 已记录后续手机 UI 规范。
- 修改文件：AGENTS.md、AnnotationPanel.tsx、annotations.css、app/page.tsx（标记选中提示）；AndroidManifest / MainActivity 升 0.1.5-test/code6；mobile/README、continue-development、本状态。未改地图/路线/模型算法及存档格式。
- 命令：git status、git diff --stat、git pull --ff-only；日志 .openai/pull-mobile-ui-20260906.log。原 localhost 服务未运行，正在启动独立本地预览。
- 验证结果：浏览器 PASS，390×844 编辑框 328×272px、列表 290px 高；360×780 编辑框 298×272px，25 项列表不超过 296.4px。360×460 短屏可滚动编辑，582×1280 检查通过，无横向溢出且所有场景避开右侧工具。尺寸/颜色/名称/地下/角度/备注保存、地图放置、收起与返回编辑、显隐、复制/删除、长名选择、25 项对比/导出通过。初轮自动化错误使用 select 精确标签匹配而超时，改用实际标签定位后通过，产品未因此改动。
- 截图：artifacts/screenshots/annotation-mobile-{editor-390,editor-360,list-390,adjust-390,long-list-360}-20260906.png；PASS，地图中心与右侧工具可见、面板内滚动、长名称截断、调整工具条 99px 高。截图为独立浏览器测试数据；没有修改用户存档。下一步修复：无。
- 日志：.openai/browser-mobile-ui-20260906.log、format/typecheck-mobile-ui-20260906.log；当前阻塞：无，未做真机验收。
- 构建验证：TypeScript、107/107 逻辑测试、网页生产构建、Android 静态入口及 APK 编译、git diff --check PASS。APK v2/v3 签名、包名 preview/versionCode6、启动 Activity 和 473 张地形瓦片 PASS；521 个 APK 静态资源逐项 SHA-256 与 mobile/dist 一致。ADB 无设备，未做真机安装/触控验收。
- 本地产物：APK/Guanyun-0.1.5-test.apk，55,219,375 字节，SHA-256 `ACB560A59BA40F5FC24927124B3686392FF95E08D33BFE54A3B5F9BA96F7ED33`；沿用 0.1.4 证书 SHA-256 `a3aa453c7fa05d8a5d54a11c648edbcc02297b064db50e44bcfea2b0b91cd29c`。无需卸载，可覆盖 0.1.4 并保留数据。
- 构建日志：.openai/{typecheck-mobile-ui,tests-mobile-ui,build-mobile-ui-web,build-apk-015,verify-apk-assets-015}-20260906.log。
- GitHub 同步：源码提交 `b94e2bf15bc1dc604d804d13afa0f18089cb92e2` 已推送 main，官方 refs API 核验一致。Release https://github.com/Siger1989/map/releases/tag/v0.1.5-test 已公开发布（prerelease=true、draft=false），目标为该源码提交；APK、SHA256、安装说明均 uploaded，服务器大小和 SHA-256 与本地一致。签名密钥和日志未上传。
- 发布日志：.openai/{push-mobile-ui,sync-mobile-ui,upload-apk-015,publish-apk-015}-20260906.log 与 release-apk-015-verified.log。
- 下一步：本轮修改、验证、构建与交付完成；本地预览 localhost:3000 保持运行。手机安装 0.1.5 覆盖 0.1.4 查看新界面，后续 UI 继续遵循 AGENTS 手机尺寸与低遮挡要求。真机手感待设备验证。

## 当前任务：打包最新 APK（2026-09-06）
- 当前目标：将当前所有功能及剖面修复打成可安装 APK，校验后提供下载。
- 当前进展：已检查干净工作区、读取构建说明。原脚本默认路径在本机不存在，已找到实际 SDK D:/GodotAndroid/android-sdk、JDK D:/GodotAndroid/jdk-17；可通过既有参数指定。最新远端 Release 为 0.1.3-test/code4。
- 签名状态：本项目与指定备份/工作区中未找到 guanyun-test.jks。已询问安装偏好并等待期间准备网页构建；暂无回复，按已说明的推荐方式先生成可并存的独立测试包，不覆盖旧版。应用名“观云测试版”、包名 com.guanyun.weather.preview，使用新本地测试签名，旧数据不自动迁移。
- 修改文件：AndroidManifest 升至 0.1.4-test/code5 并使用独立包名、显式启动类；MainActivity 用户代理升至 0.1.4；本状态和安装说明。业务代码保持本轮已验收版本。
- 命令：git status、git diff --stat、构建工具与签名路径检查、官方 Releases API 查询、git pull --ff-only；日志 .openai/pull-apk-20260906.log。
- 验证结果：APK 编译、v2/v3 签名、启动 Activity、versionCode5 和包名、473 张地形/worker/覆盖索引/私有文件排除 PASS；517 个 APK 静态资源逐项 SHA-256 与当前 mobile/dist 一致。TypeScript、107/107 逻辑测试 PASS；ADB 无设备，未做真机安装验证。git pull SSL 超时后已用官方 refs API 核验构建前 main 与本地一致。
- 本地产物：APK/Guanyun-0.1.4-test.apk，55,055,209 字节；SHA-256 `65CC6EF1CDB7FC9E3A5DC22346DA509A3BF800FCFF8A39DB66F72182A2399136`。旁附 .sha256 和 INSTALL-0.1.4.txt。新签名证书 SHA-256 `a3aa453c7fa05d8a5d54a11c648edbcc02297b064db50e44bcfea2b0b91cd29c`，私钥只保留本机、不上传。
- 日志：.openai/{build-apk-web-014,build-apk-014,typecheck-apk-014,tests-apk-014,verify-apk-assets-014}-20260906.log。
- 当前阻塞：无，独立测试版可继续构建；覆盖更新仍需要原签名。
- GitHub 同步：构建源码提交 `b16b40911bc4adbdadcc1b1f99c40efb1e9cca39` 已推送 main，并核验远端 SHA 一致。Release `v0.1.4-test` 已公开发布（prerelease=true/draft=false），目标为该提交；APK、SHA256 与安装说明三份附件均 uploaded，服务器大小与 SHA-256 全部匹配本地。地址 https://github.com/Siger1989/map/releases/tag/v0.1.4-test 。
- 发布日志：.openai/{push-apk-014,sync-apk-014,upload-apk-014,publish-apk-014}-20260906.log 和 .openai/release-apk-014-verified.log。没有上传签名密钥或运行日志；后续仅补交付状态。
- 下一步：本轮打包与下载交付完成；可安装独立“观云测试版”，无需卸载旧版。手机真机安装、触控和性能仍待用户设备验证。

## 当前任务：修复拖动剖面海拔时跳动（2026-09-06）
- 当前目标：稳定鼠标拖动时的滑条、海拔值及三维剖面更新。
- 当前进展：真实鼠标单向上拖已复现 5 次数值逆向回跳，范围在 -150/6000 与 -500/9000 之间切换（.openai/section-drag-before-20260906.log）。SectionPanel 改为保留最近完整统计范围，忽略加载中的临时范围；按住期间冻结 min/max，捕获指针并处理松手、取消、失去捕获和失焦。
- 修改文件：modules/section/SectionPanel.tsx、scripts/verify-section-browser.mjs（新增真实鼠标往返拖动/停住/移出松手断言）、docs/elevation-section.md、本状态。地形计算与既有路线/模型数据不变。
- 命令：git status、git diff --stat、git pull --ff-only（Already up to date），日志 .openai/pull-section-drag-20260906.log。
- 验证结果：最终 PASS。修复后同视角 30 步真实鼠标上拖的 min/max 始终 -150/6000，0 次逆向回跳，数值从 1777.6 连续增至 3907.2（.openai/section-drag-after-20260906.log）。完整浏览器回归包含双向各 20 步真实鼠标拖动，跨 ready/loading 状态范围固定、数值单调；按住停留 700ms 无变化，移出后松手保留数值，后续重新调整正常。既有纯色/改色/旋转/反复开关/窄屏/WebGL 检查继续 PASS。
- 自动检查：TypeScript、107/107 逻辑测试、网页生产构建、Android 静态入口构建、git diff --check 均 PASS。日志 .openai/{browser-section-drag,typecheck-section-drag,tests-section-drag,build-section-drag-web,build-section-drag-mobile,diffcheck-section-drag}-20260906.log。
- 截图：既有 artifacts/screenshots/section-fixed-{white,color,height4000,rotated,reopened,mobile}-20260906.png 已由本轮重新生成；PASS，切面、紧凑提示和侧边控件保持正常；拖动稳定性以逐步采样和鼠标自动化断言验证。后续修复：无。
- 当前阻塞：无。
- GitHub 同步：功能提交 `0609979a1fcb4c20063347a107dd70051af14b34` 已推送 main，官方 refs API 核验 SHA 一致（PASS）。首次推送停滞后已终止，仅重试同一提交成功；日志 .openai/{push-section-drag,push-section-drag-retry,sync-section-drag}-20260906.log。后续仅补交付状态。
- 下一步：本轮修复、验证和同步完成，localhost:3000 保持运行且 HTTP 200，刷新后生效。本轮实测桌面鼠标，未进行手机真机触控验证或重新打包 APK。

## 当前任务：精简左侧剖面提示（2026-09-06）
- 当前目标：缩小用户截图中的左侧说明框，只保留海拔及必要的加载/异常状态。
- 当前进展：已移除说明段落、图例和采样间距，正常只显示“剖面 · 海拔 m”；更新/异常时保留短状态与重试。提示框改为内容自适应尺寸，精简边距；剖切计算、右侧控制和路线/模型数据不变。
- 修改文件：modules/section/{SectionPanel.tsx,section.css}、scripts/verify-section-browser.mjs（加载判断改读 phase）、docs/elevation-section.md、本状态。删除废弃图例样式，无新增文件。
- 命令：git status、git diff --stat、git pull --ff-only（Already up to date），日志 .openai/pull-section-compact-20260906.log。
- 验证结果：PASS。TypeScript、107/107 既有逻辑测试、网页生产构建、Android 静态入口构建、脚本语法及差异检查通过；本轮未新增测试或修改剖切算法。
- 浏览器截图：artifacts/screenshots/section-caption-compact-{desktop,mobile}-20260906.png；PASS，同用户视角/4049.3m，1180×850 与 430×780 下提示框均约 104×33px，单行且不遮挡侧栏。初次点击时页面未完成初始化导致定位输入框超时，初始化后重新打开正常。下一步修复：无。
- 日志：.openai/{format-section-compact,typecheck-section-compact,tests-section-compact,build-section-compact-web,build-section-compact-mobile,check-section-compact-script,diffcheck-section-compact}-20260906.log。
- 当前阻塞：无。
- GitHub 同步：功能提交 `474351f4b45706a93dc7ee41b00a40b86ceace38` 已推送 main，官方 refs API 核验 SHA 一致（PASS）。日志 .openai/{push-section-compact,sync-section-compact}-20260906.log，后续仅补交付状态。
- 下一步：本轮精简和验证完成，本地预览保持运行；刷新即可查看。本轮仅浏览器验证，未重新打包 APK。

## 最新修复：剖面缺失与画面叠乱（2026-09-06）
- 当前目标：按用户明确要求查看实际页面，修复 3D 剖面不可见和图层叠乱，保留原 UI、可选纯色截面和单线轮廓。
- 当前进展：已在独立 Edge/Playwright 上以用户相同 URL/视角复现。确认 tileSize 256→512 导致共享 RTT 从 1024→2048 后帧缓冲尺寸不兼容（状态 36057，GL 1286），旧纹理残留且填色不绘制。改回 256 后 GL=0；填充改读同一裁切 DEM，轮廓按更细瓦片覆盖范围裁掉粗层级的重复线。
- 修改文件：SectionLayer、contourCoverage、新增 coverage 测试和浏览器渲染验证脚本、section-terrain 回归约束、.gitignore 截图排除、文档/状态。
- 命令/日志：git status、git diff --stat、git pull --ff-only（Already up to date）；.openai/pull-section-fix-20260906.log。
- 验证结果：最终 PASS。完整 107/107 逻辑测试、TypeScript、网页生产构建、Android 静态入口构建、git diff --check 均通过。真实 Edge 浏览器六场景 PASS：白色/自定义蓝色、2000→4000→3000m、缩放/旋转、反复开关、430×780 窄屏；全部 GL=0、RTT=1024，保留指定 65°/55° 视角。初始白色切面像素 423469/1003000；原接缝区域 4752/4760 像素为纯色，通过 >99.5% 断言。
- 截图检查（均位于 artifacts/screenshots/）：section-before、section-before-height2500-20260906.png，FAIL，块状残留且无截面；section-normal-baseline-20260906.png，PASS，普通地图对照；section-size-fix-20260906.png，PASS，白色恢复/GL=0，随后继续处理轮廓；section-same-dem、section-near-same-dem、section-near-loaded-20260906.png，FAIL，加载阶段及粗细层级线未清理；section-contours-fix、section-color-fixed-20260906.png，PASS，纯色切面/无穿越切面的粗线，下一步回归更多视角。
- 浏览器验证补充：首轮白色、改色、4000m、旋转 GL=0，但重复开启像素断言 FAIL。复现诊断确认是 isSourceLoaded 在 setTiles 尚未开始请求时短暂为真，截图落在加载阶段；等待剖面状态完成与两个数据源就绪后，重复开启 PASS（section-reopen-loaded-20260906.png）。已修正验收脚本等待条件，继续全流程。
- 广角截图复核：多场景脚本已 PASS，但人工看到一条透明接缝。隔离轮廓层后仍存在；全覆盖填色与 nearest 采样均使它消失，确认来自 DEM 边缘插值。剖面填色改 nearest，保留单线轮廓；section-seam-nearest、section-nearest-near-20260906.png PASS。已追加原缺陷区域的纯色像素断言，再跑最终验证。
- 最终截图：artifacts/screenshots/section-fixed-{white,color,height4000,rotated,reopened,mobile}-20260906.png。PASS：截面可见且为指定纯色、无大片旧纹理残留、单线轮廓、窄屏面板在边界内；初轮过早截图已由最终完成加载后的截图更新。后续修复：无。
- 最终日志：.openai/{browser-section-fix-final,typecheck-section-fix-final,tests-section-fix-final,build-section-fix-web,build-section-fix-mobile,diffcheck-section-fix}-20260906.log。浏览器脚本只在独立测试上下文注入地图引用，产品未暴露调试对象。
- 当前阻塞：无。未测手机真机触控/帧率，未重新打包 APK；既有路线、模型存档、天气模块未修改。
- GitHub 同步：功能提交 `9b735943e184de295dacfca60db729177bcac8e0` 已推送 main，GitHub 官方 refs API 核验与本地一致（PASS）。首次推送连接重置，第二次成功；日志 .openai/{push-section-fix,push-section-fix-retry,sync-section-fix}-20260906.log。后续仅补此交付状态。
- 下一步：本轮修复、实际浏览器验收和同步完成；localhost:3000 保持运行且 HTTP 200。刷新页面后重新进入剖面即可加载修复。

## 正在开发：三维地形海拔剖切（2026-09-05）
- 当前目标：保留 3D 相机，按侧边滑条的真实海拔裁切当前视野山体；剖切面默认白色，可自定义纯色，轮廓单条实线；UI 保持原配色。
- 当前进展：已移除临时二维俯视实现，改用原生三维 DEM 裁切、纯色切口、连续轮廓；模型按同一真实海拔裁切并封口。进入临时按 1× 海拔显示，退出恢复原图层/起伏设置。路线与模型编辑在剖面关闭后恢复。
- 性能反馈：用户报告明显卡顿。已删除移动后整批 DEM 重载，改由原生视锥加载；剖面数据源采用较低显示采样密度及 LOD 数量约束，滑条 350ms 合并更新，移动中延后重建；轮廓片段连接并去共线点，统计结果复用，250ms 合并发布。缓存原始 DEM 48 张、轮廓元数据 128 张，读取最多 3 并发。
- 修改文件：新增 modules/section/{types,appearance,terrainMath,elevation,models,SectionLayer,SectionPanel,section.css}；修改 TerrainMap、AnnotationLayer、MapActions、app/page、双入口样式和 Android 返回；新增 section/section-terrain 测试，更新 android-back 与模型适配测试。
- 已执行：启动检查与项目文件阅读；旧二维专项后已重写验证；三维专项首轮 15/15 PASS，TypeScript PASS；已查阅本地 MapLibre 6.7 渲染实现，修正 color-relief 只解析 Interpolate 的兼容问题。
- 验证结果：PASS。完整 105/105 测试、TypeScript、网页生产构建与 Android 静态入口构建通过；localhost:3000 HTTP 200 / 44606 字节。差异检查发现状态文件尾部空行，已清理。未测实际浏览器帧率或真机触控，未重新打包 APK。
- 当前阻塞：无。
- 日志：.openai/{tests-section-final,typecheck-section-final,build-section-web,build-section-mobile,diffcheck-section,preview-section}-20260905.log。专项验证含纯色改变零 DEM 重载、连续 100 次移动零额外重载、连续轮廓合并、过期结果和模型封口。
- GitHub 同步：功能提交 `184c22406d19e5401198cd773f23d4b234417c78` 已推送 main，并经 GitHub 官方 refs API 核对与本地 SHA 一致（PASS），日志 .openai/{push-section,sync-section}-20260905.log。后续提交仅补本交付状态。
- 下一步：实现、自动检查和功能同步完成。本地预览保持运行；刷新后检查当前视角的实际流畅度，若仍卡需实测区分 GPU、底图/DEM 加载及浏览器瓶颈。
## 最新开发：直接拖动模型本体并同步位置（2026-09-05）
- 当前目标：长按三维模型本体直接调整位置，模型/名称标记/坐标读数同步，松手沿原路径保存并支持撤销。
- 当前进展：已增加模型本体拖动拾取，优先于被模型覆盖的路线节点；沿原有预览/保存/撤销流程同步模型、名称和坐标，工具条显示实时经纬度。使用真实地面锚点作为移动原点，保留尺寸/旋转/埋深。
- 修改范围：地图拖动拾取、模型接口、页面坐标反馈、使用说明和相关测试；保留原路线编辑与参数定义。
- 已执行：git status、git diff --stat、读取 README/AGENTS/CURRENT_STATE/LOG、模块检索。
- 已修改：modules/annotations/{AnnotationLayer,AnnotationPanel}、modules/map/TerrainMap、app/page.tsx、tests/selection-editing.test.mjs、README、docs/selection-and-node-editing.md。
- 验证结果：PASS。类型检查、完整 91/91 测试、网页生产构建、Android 静态入口构建、git diff --check、本地 localhost:3000 HTTP 200 / 43432 字节均通过。包含新增 6 种模型/地表地下组合验证；首轮还原高度断言的约 1e-13 米浮点舍入已改用 1e-9 容差断言。
- 日志：.openai/{format-model-body,tests-model-body,typecheck-model-body,tests-model-body-final,build-model-body-web,build-model-body-mobile,diffcheck-model-body,preview-model-body}-20260905.log。未重新打包 APK，未做浏览器或真机触控验收。
- 当前阻塞：无。
- GitHub 同步：功能提交 `48b946e978426b3cd55853c6d4b9f22ee229888a` 已推送 main；Git 远程核验遇连接重置/慢连接，改用 GitHub 官方 refs API 实时核验 SHA 与本地一致（PASS）。日志 .openai/{push-model-body,sync-model-body-api}-20260905.log；后续仅补本交付状态。
- 下一步：本轮实现、验证和功能同步已完成，本地预览保持当前地图视角，刷新后可长按模型本体拖动；实机手感和新版 APK 待后续验收。

## 最新开发：路线点选与长按节点编辑（2026-09-05）
- 当前目标：地图上点选手绘路线/标记，打开详情继续编辑；长按节点或标记后拖动位置。
- 当前进展：已补路线 ID/容差拾取/高亮和详情联动；节点及标记支持长按 480ms 后拖动预览，松手提交；取消、失焦和双指切换不提交。已保存路线及标记可撤销移动，草稿纳入原撤销；接点同步移动、续画保留已改节点。模型实体也接入点击拾取。
- 修改范围：tracks、annotations、map 交互适配和页面接线，不改天气/地形/道路吸附算法。
- 已执行：git status、git diff --stat、git pull --ff-only（已最新）、读取模块/状态/规则。
- 已修改：app/page.tsx；map/{TerrainMap,FeatureDragBridge}；tracks/{TrackLayer,TrackPanel,useManualTracks,draft,editing,tracks.css}；annotations/{AnnotationLayer,AnnotationPanel,useAnnotations,annotations.css}；新增 tests/selection-editing.test.mjs、docs/selection-and-node-editing.md，更新 README。
- 已执行：npx tsc --noEmit、node --experimental-strip-types --test tests/selection-editing.test.mjs tests/track-interaction.test.mjs、限定文件 oxfmt；日志 .openai/{typecheck-selection,tests-selection,tests-selection-model,format-selection}-20260905.log。
- 验证结果：PASS。完整 85/85 测试（含新增 17 项）、TypeScript、网页生产构建、Android 静态入口构建、git diff --check 均通过；本地 localhost:3000 HTTP 200 / 43420 字节。模型专项含实际 Three.js 拾取数学和 DOM/几何复用适配测试，不等同真实浏览器渲染验收。
- 完整日志：.openai/{typecheck-selection-final,tests-selection-final,build-selection-web,build-selection-mobile,diffcheck-selection,preview-selection}-20260905.log。构建仅有既有地图引擎大分包/框架路由分类提示；无构建错误。
- 当前阻塞：无。本轮没有浏览器截图/真实地图触控或手机实机验证，没有重新打包 APK；旧 APK 不包含本轮功能。预览继续保留 localhost:3000，会话 27863。
- GitHub 同步：功能提交 `380c2b615950f3aa22911bf255bb76e50b17b9c1` 已推送 origin/main，git ls-remote 实时核验与本地一致（PASS）；后续仅补此交付状态。日志 .openai/{push-selection,sync-selection}-20260905.log。
- 下一步：本轮实现、文档、自动检查及 GitHub 同步完成；手机触控体验待实机验收。可在预览中完成绘制后点选路线/标记，长按节点调整位置。

## 最新开发：国内图源适配、道路吸附与地表/地下标记模型（2026-09-05）
- 当前目标：寻找国内免费底图，改善依赖 VPN 才能浏览的问题；补全用户明确要求的“吸附地图上的道路和山间小路”，不是只连接已保存轨迹的节点。
- 用户追加目标：地图标记与基础几何模型（长方体/圆柱等），可设置名称、颜色、真实米制尺寸、位置和角度；地表/地下切换与埋深，地下模型透过地表半透明可见，用于洞穴/开挖标注和比例参考。独立 annotations 模块，本机存储并提供参数编辑。
- 当前进展：已接入独立道路吸附开关和地图道路查询（保留节点吸附）；已接入 annotations 模块，支持地点/长方体/圆柱/球体、米制尺寸/角度/地面海拔/埋深、地下透明显示、本机存储、复制和参数导出。底图/地名/外部高程/天气/导航分别依赖不同境外服务，不能仅改底图后宣称全部服务国内化。
- 计划范围：tracks 绘制与道路匹配模块、map 公共接口、手绘控件及相关测试；国内图源按官方公开接口与免费条件核验后再选择。保留原视角/双指交互、存档、地形算法和天气计算。
- 已修改文件：本状态文件、app/page.tsx、app/layout.tsx、mobile/main.tsx、modules/controls/ControlDock.tsx、modules/map/TerrainMap.tsx、modules/tracks/{DrawingSession,TrackDrawing,TrackPanel,useManualTracks}；新增 modules/tracks/roadSnapping.ts、modules/map/roadSnap.ts 与 modules/annotations/。研究请求输出存放 .openai/domestic-*.log（忽略）。
- 已执行命令：git status、git diff --stat、git pull --ff-only、源码检索与说明读取；curl 对候选国内服务执行有超时的连接/元数据探测。
- 验证结果：最终 PASS（npm ci、TypeScript、68/68 测试，含新增13项、网页生产构建、安卓静态入口构建、git diff --check、localhost:3000 HTTP 200、本地字形 HTTP 200 / 76580 字节）。国内图源真实服务仍 BLOCKED（无本应用 Key，公开免 Key 候选未验证）。
- 当前阻塞：天地图需应用 Key；GeoQ 免费平台说明不能单独证明公开切片可作为本应用图源，且本机直连其切片域名超时。不能盗用他人示例 Key。
- 国内图源代码：新增 modules/cartography/basemaps.ts 与 config/domestic-maps.env.example；有自有天地图浏览器 Key 后启用国内 WMTS 影像/底图/中文注记，无 Key 保留原图源；国内模式等高线字体改为本地 public/fonts/，NASA 最新观测停用，国际道路数据按开启道路吸附才加载。天气/导航/区域外高程仍可能依赖境外服务。
- 新增说明：docs/roads-models-domestic.md、LOG.md、public/fonts/README.md/授权；README 已链接。Android 返回键补充取消模型放置；新模型参数导出在浏览器下载、WebView 可复制。
- 日志：.openai/{typecheck-roads-models-final-20260905,tests-roads-models-final-20260905,build-roads-models-web-final-20260905,build-roads-models-mobile-final-20260905,diffcheck-roads-models-20260905}.log；本地预览 http://localhost:3000/，会话 27863。新增模型按需加载，避免扩大初始地图包；生产构建仍有地图引擎大分包提示。
- GitHub 同步：功能源码提交 `829645e6258ee40fa89009bd05766a405f3e5721` 已推送 main；通过 git ls-remote 实时核对与本地 SHA 一致（PASS）。本地未设置 Git 作者，使用单次 Codex 代理身份提交，没有修改全局 Git 配置。后续仅补交付状态。
- 下一步：配置自己的天地图 Key 进行国内实网验证，并在手机验收道路触控、地下透视与性能。本轮代码、文档和自动检查已完成；真实国内服务因 Key 缺失待验证。尚未重新打包 APK，已安装 0.1.3 APK 不会自动更新；未执行浏览器或真机视觉/触控验收。

## 最新交付：2026-09-05，0.1.3-test
- 新增道路路线左侧气温/降水双列色带，按里程选点与各路段耗时匹配预计到达时间预报；可查看数值/颜色图例和设置出发时间。当前位置有效且靠近路线时显示实际进度；未定位、过期、精度不足或偏离路线时明确提示。
- 新增独立 position 模块：当前位置蓝点/精度圈、停止定位、当前位置作起点；正北/手机绝对方向切换，绘制时暂停自动转图，手动旋转退出方向跟随。Android 仅按需申请前台位置权限，没有后台定位或语音导航。
- 新增统一收藏夹，道路路线保存起终点、出行方式、完整路线和转向列表，也可打开已有手绘线路。数据仅存本机；道路最多20条，恢复收藏不会重新计算道路。
- 修复画不了的具体问题：触摸与放大镜原来读取可能高度为0的 canvas-container，改读真实 canvas CSS 尺寸；加强绘制 touch-action 优先级。提示明确为①按住地图用准星确认起点，松手②拖动旁边绿色牵引环画线。原双指控图、平滑/逐点、吸附和整线分析保留。
- APK：D:/天气系统/APK/Guanyun-0.1.3-test.apk，53,328,190字节，versionCode 4；SHA-256 BD666AF667B89B52608EFA136EC73BAA58FD537D090B252731571793CD48458A。v2/v3签名通过，与旧版证书一致，可覆盖更新；旧包与私有测试密钥保留。
- 验证完成：TypeScript退出0，55/55测试通过，网页构建0，APK构建0，git diff --check 0；473张地形瓦片及worker/索引/新功能bundle校验通过，localhost:3000 HTTP200。实际成都约2.1km步行路线经新适配器取得起终点各168小时预报，收藏完整格式校验通过。
- 日志：.openai/{typecheck-013-final,tests-013,build-web-013,build-apk-013,route-journey-013-live,diffcheck-013}.log。完整职责/文件/操作/回滚见 docs/navigation-weather-location.md。
- 修改范围为 position、journey、navigation、tracks及地图/页面/控件接口、双入口样式与Android前台权限。只替换错误坐标来源和旧提示，不删除业务功能；地形/卫星/地质/云雨数据算法与道路服务保持。
- 验证边界：adb无设备，没有新版手机权限、罗盘、手感、渲染/性能实测；没有浏览器视觉/触控自动化。没有语音导航、偏航重算、实时路况或自动地图跟随。现有非商业来源/地质云授权限制保持，本包是测试原型。
- 新代码与APK已同步 GitHub，v0.1.3-test 测试版已公开发布并核验；代码提交/标签为 2ac408cd6070e1b69519d064cdd5891aeefdfe51，后续提交仅补交付状态。本地预览继续保留，不重新发布私有 Sites。

## 跨设备同步：2026-09-05
- 用户指定后续统一同步到 https://github.com/Siger1989/map ，用于在家继续研究。已配置 origin；远程初始为空、主分支 main。写入 AGENTS.md 作为后续工作规则。
- 新增 docs/continue-development.md，包含首次克隆/运行、两台电脑拉取提交、APK下载与可配置SDK/JDK构建、测试签名私密迁移说明；README链接指向仓库与Releases。
- 首次快照整理同步配置、忽略规则和说明；代码/测试/473地形PNG进Git；APK/校验/安装说明走测试版Release；Token、签名密钥、依赖及日志排除。用户后来追加的0.1.3新功能一并继续同步。
- 首次正式推送已核验：61ba1c63c10a31c8986e2dcfb018fdb00518f22b；0.1.3新源码也已推送 main，远程提交和 v0.1.3-test 标签均核对为 2ac408cd6070e1b69519d064cdd5891aeefdfe51。新增34文件变更检查无凭证模式或被排除路径混入。
- Release：https://github.com/Siger1989/map/releases/tag/v0.1.3-test ，draft=false / prerelease=true；APK、SHA256文件、INSTALL.txt三份附件全部 uploaded，服务器大小与SHA256逐一匹配本地。APK为53,328,190字节，哈希见顶部；核验日志 .openai/github-013-release-verify.log。没有上传环境文件或签名密钥，也没有改变仓库可见性。

## 历史交付：2026-09-05，0.1.2-test
- 用户本轮连续要求均已实现：单指绘制/真实双指平移缩放旋转俯仰；默认放大镜/偏移准星精确定起点再牵引平滑画，也保留逐点连线；下一笔精确续接端点；14px节点吸附与可见提示；笔画保存时连接、已保存线路续画/反向/合并相接线路；可调0.5–5px线宽和颜色；手机浮窗缩至252px/44dvh。
- 新增 journey 模块，草稿/存档详情提供总里程、最高/最低/起终海拔、净高差、累计爬升下降、高程剖面。沿同源DEM分瓦片批量采样，3并发/24张解码缓存，最多192–200采样点；采样间隔与估算定义界面明示。缺失处断开，完整爬升不填0。空隙不算里程，不跨分岔猜方向。
- 手绘沿途天气已实现：用户点获取才批量请求2–6个地点，7天逐小时预报，按北京时间出发与可调平均速度估算ETA、匹配最近整点。缺测不当无雨，超出预报范围明确提示；降水为预报整点前一小时含雨雪总量。道路规划原时序接口保留，本轮沿途天气入口在手绘线路详情。
- APK：D:/天气系统/APK/Guanyun-0.1.2-test.apk，53,324,094字节，versionCode 3，SHA-256 9D9DC256BE86656DFB51A6C841A2A6FD9EA370B88BBC9904C325147D57A16D11。v2/v3签名通过，与0.1.1证书SHA-256相同，可覆盖旧版；旧包和测试签名保留。校验473张地形瓦片、worker/覆盖索引、bundle精定位/吸附/统计/天气字符串及无.env/密钥混入。
- 最终验证：TypeScript退出0、47/47测试通过、网页生产构建0、APK构建0、git diff --check 0（仅既有CRLF提醒）。本地localhost:3000 HTTP200。新天气适配器实际取得成都/都江堰各168小时预报；日志 .openai/{typecheck-track-012-final,test-track-012-final,build-track-012,build-apk-012,journey-weather-live,diffcheck-track-012}.log。
- 模块/文件：tracks重做输入状态与草稿/存档；新增journey独立分析模块、map/magnifier；TerrainMap/page通过MapHandle/props接线；layout/mobile入口共用新CSS；workspace缩浮窗；AndroidManifest/MainActivity仅升版本/UA。完整职责、修改文件与回滚记录见docs/track-drawing-and-journey.md。移除旧绘制SVG全屏触摸拦截、强制暂停移图和绘制时禁相机，不删除原业务数据功能。
- 未受影响：现有道路规划、道路地名、卫星/地质/云雨图层和地形原始数据/网关算法。新统计模块读取同一DEM与独立天气适配器。当前数据仍含非商业来源，1:20万缺服务授权；不是已完成商用授权的正式发行包。
- 验证边界：adb无设备，无新版手机安装/渲染/手感/性能验收；按当前Sites技能未进行浏览器截图/DOM/触控自动化。已验证的是代码、逻辑、服务响应、构建与签名。无实时定位跟随/语音导航。轨迹只存本机，卸载或清数据会丢失；覆盖更新保留原存档。
- 本地预览与当前hash视角继续保留，没有再次发布需要登录的私有网站。
---


## 目标与范围
- 用户需要直观的三维地形、带日期的最新可用卫星影像、海拔等高线、简化三维云层、降雨动画，以及独立图层开关。
- 用户已确认首版电脑浏览器交互原型，默认成都及川西山区。
- 当前目录原为空；采用 Sites / React / MapLibre，模块独立。没有原有业务模块受到影响。

## 结构与接口
- `app/page.tsx`：工作台与图层状态，向地图传递配置，不操作模块内部变量。
- `modules/map/`：地图生命周期、相机、拾取高程；接收图层状态与天气数据。
- `modules/terrain/`：真实 DEM 与带米数的等高线。
- `modules/satellite/`：NASA GIBS 图层配置、最新可用日期及失败状态。
- `modules/weather/`：预报适配、数据校验、三维云雨可视化；云高度/形态明确为示意。
- `modules/controls/`：图层开关、时间轴和数值展示。

## 进度
- 已完成初始化与依赖安装，地图/地形/等高线/五个开关界面已编译，预览 HTTP 200；已请求在 Codex 打开本地预览（UI 返回 queued）。
- 第一轮 TypeScript 检查通过；正在接入卫星日期、覆盖核验和 25 点逐小时模型天气。
- 已连通 NASA GIBS 元数据、Open-Meteo 和 AWS Terrain；尚未完成最终功能与生产构建。
- 根据 Sites 技能，用户未明确要求浏览器测试，因此未执行浏览器截图和交互 QA，最终交付应准确说明验证范围。

## 数据真实性
- 分别显示卫星影像日期、天气有效时间、模型来源。
- 缺失值不能转为零，不伪造观测或随机雨区。
- 简化三维云雨是模型驱动的示意，不能表示实测云体高度或结构。
- 最新影像指提供方发布的最新可用影像，不承诺实时高清地面影像。

## 用户追加与排查
- 用户追加：更清晰的影像、可拖动的视角控制器、俯/斜/侧视快捷键、道路河流和中文地名。
- 已加入 EOX Sentinel-2 2024 10 米级无云合成（非商业用途），与 NASA 最新观测分开切换；已加入相机控制模块和独立 cartography 模块。
- 用户反馈三维地形不明显后，开始针对其反馈检查实际浏览器。关键截图显示地图平面、海拔空值；发现初始化等候全图 load，调整为 style.load，并在基础样式直接声明 terrain。默认移至川西山体 [103.28,31.08]，zoom 10.5 / pitch 65。
- 本地预览稳定浏览器 tab provider ID：f2abd7ab-1781-48f6-a030-f9986cdc0f36；CUA browser 1 / tab 1。
- 已定位三维失效根因：MapLibre 6.7 模块 worker 默认相对路径在 Vite 优化后指向不存在的 `.vite/deps/maplibre-gl-worker.mjs`，DEM 和矢量源持续 pending，而普通影像仍能显示。已添加本地 worker 复制脚本与显式 setWorkerUrl，并分离 hillshade / terrain 源。
- 天气数据逻辑测试 4/4 通过：缺失/零值区分、时区与时间对齐、缺失网格拒绝、雨雪区分。
- 正在重启预览并执行首次生产构建；日志 `.openai/preview.log`、`.openai/build.log`。
- worker 修复已实际验证：浏览器返回 elevationReady=true，中心渲染高程约 2483.7m（含 1.3 倍显示增强及地形层级差异），独立原始高程读取 2007m；截图确认 80 度侧视中的真实山脊和山谷、中文山峰地名。
- 最新观测实测回退至当前位置 2026-09-04 可用 VIIRS 图像；服务发布日为 2026-09-05，但当天该点尚无覆盖。
- WebMCP 两个工具已发现，配置相机 pitch=80 与图层开关后读回一致，pitch=100 明确拒绝。首次生产构建成功；收尾后还需重建最终版本。

## 当前验证
- 最终 TypeScript 检查通过，天气逻辑 4/4 测试通过，生产构建成功。
- 实际浏览器验证：三维山体（含侧视）、独立原始海拔、等高线、中文地名/道路、高清与最新影像切换。
- CloudRainLayerReady=true；时间轴从 10:00 切到 22:00 后温度与三层云量随模型更新，卫星日期保持 2026-09-04。
- WebMCP 两个接口已验证合法修改、读回状态和非法 pitch=100 拒绝。道路/地名关闭后对应地图图层 visibility 同步关闭。
- 原有业务模块不存在，因此没有删除旧功能；新增模块和文件职责见 README.md。

## 下一步
- 用户指出成都城区异常圆包，暂停发布：原 Mapzen z12/13 瓦片中心附近实测约 488–552m，存在局部高程突起；并非凭截图即可判断地形准确。改用成都区域 FABDEM 去建筑/树木影响高程，外侧平滑衔接原数据。
- 用户新增：三维地形卫星贴图、渐变海拔着色与图例。已把当前视图切回高清无云地表；此前最新 VIIRS 观测有大片云，覆盖地面。
- 正在增加地形数据准备脚本、统一高程来源、独立 color-relief 图层与对应 UI 图例。天气/道路模块保持接口，云层问题仍需与地形隔离验证。
- FABDEM 区域瓦片已生成 473 张 / 50 MiB，全部通过尺寸与清单检查。城区两点生成高程 493.66/498.35m，对照原始 FABDEM 493.39/498.28m；山地测试点生成 800.09m、源 794.52m。已统一地形/等高线/读取 URL，并修复模板占位符被 URL 编码导致 400 的问题。
- 按用户再次反馈，将连续淡色渐变改为饱和的分段海拔色带：0–5000m 每 500m 一档，5000–6000m 一档，6000m+ 一档；100% 覆盖，区间图例使用同一配置。保留卫星、道路与云雨独立开关。新增 URL hash 保持刷新视角。
- 已完成实际浏览器验证：成都中心 [104.066,30.659] / zoom 13.8 / pitch 80，terrain ready=true，渲染高程 493.456m、点读取 493.664m，截图显示平缓城区卫星纹理，原异常圆包消失。川西截图显示真实山脊与强饱和海拔色带；关闭着色还原地表贴图。
- 修正 MapLibre 6.7 color-relief 仅支持 Interpolate 的限制：使用双阈值（边界过渡 0.25m）绘制实色高度档，未使用会透明的 step 表达式。图例与绘制共用阈值。
- 新地形 API 的本地瓦片、外部范围回退均返回 PNG 200；非法坐标返回 400。TypeScript、天气 4/4 测试、生产构建通过。开发服 HMR 曾触发 vinext ALS 栈递归，重启后恢复，后台验证页无错误/警告。
- 私有发布尚未完成。Sites 打包辅助脚本在本机 Node 24 的文件复制阶段原生退出 -1073740791，无可用归档；若无法解决将采用工具允许的远程构建保存。代码与地形数据已准备好提交。
- 私有发布 v1（deployment appgdep_6a9b89242370819196de1375405e1acb）因依赖来源被拒绝。锁文件所有 729 条 resolved 为 npmmirror 镜像；改为 npm 官方源，版本与 integrity 均保持不变，三个关键依赖 URL 已验证可用，准备重新保存发布。
- 2026-09-05 私有发布 v2 成功：https://guanyun-weather-terrain.siger1989.chatgpt.site 。发布源提交 ea9407002a21aa97195581b94348b8a5157b098c；version appgprj_6a9b7758a710819190cfca9ca304afe5~appgver_69fba679b7908191a43db54adcab9e7d；deployment appgdep_6a9b89d5d7c481918899026c5ef2ae9c。采用远程构建，状态 succeeded。
- 本轮完成：真实三维地形 worker 修复、成都 FABDEM 数据修正、高清地表贴图/最新观测区分、八项图层开关、清晰海拔分段色带和区间图例、视角控制和刷新恢复、道路中文地名。未删除业务功能，天气模型/动画/时间轴接口保留。图层合法读写和非法值拒绝均通过浏览器验证。
- 发布后请求在同一个 tab 打开私有 URL，并保留 #11.55/29.5796/101.7693/70.4/72；open_in_codex 返回 queued，随后 CUA 导航和选取该 tab 均超时，因此仅确认服务器发布 succeeded，未确认发布页的浏览器渲染。已保留本地开发服务 session 16619 / localhost:3000，避免中断用户继续使用；临时后台验证 tab 2 已关闭。
- 用户反馈右侧变为登录页：私有在线 Sites 的访问身份校验导致 OpenAI/Google 登录跳转。改回本地预览，不更改线上访问范围。原 session 16619 服务已停止，已用隐藏后台 Node 进程 30232 重新启动 localhost:3000，HTTP 200；日志 preview-background.log / preview-background-error.log。open_in_codex 已请求同一 tab 切回本地（queued）；CUA 选取登录页仍超时，尚未收到 UI 打开确认。本次没有业务代码改动。

## 2026-09-05 云层、路线与数据来源讨论
- 用户认为现有云丑，要求先讨论实现原理与最佳方案，并研究免费地图数据；本轮只做源码检查和官方来源研究，没有修改业务代码或重新发布。
- 已明确导航范围：起点/终点路线规划，支持不同出行方式；后续加入沿途天气。建议按各路段预计到达时间取预报，导航与天气通过路线坐标和累计耗时接口连接，尚未实施。
- 当前云实现核验：WeatherLayer.ts 使用透明椭球实例；25 个天气点、0.32 度间距，云量决定数量，程序生成位置和形状，三层高度为模型地面高程加固定偏移。没有真实云底/云顶和体积密度，没有按高空风平流；现有风数据为 10 米近地风。不能称为实测三维云。
- 待讨论的改进方向：真实云覆盖或模型云量控制大尺度分布，三维密度与透光改善侧视，远处简化并提供质量档位；先做小范围性能与视觉比较，再确定默认实现。卫星观测与未来模型预报需区分；单张云图不能完整还原三维云体。
- 官方来源研究：OpenFreeMap 公共服务免费且允许商用，要求署名，无 SLA；Open-Meteo 免费 API 限非商业且有配额。当前 EOX 2024 合成底图与 FABDEM V1-2 均为 CC BY-NC-SA，后续对外运营需核对授权或替换。
- 候选：Himawari-9 公开原始数据覆盖东亚、全圆盘约 10 分钟，需服务端加工；Sentinel 原始影像开放但不等于免费的无云瓦片服务；Copernicus GLO-30 原始公开地形与托管查看服务权限应分别核对。
- 路线候选 openrouteservice 支持驾车/步行/骑行等，有开发者 Key 和公共服务限额；高德需按实际用途核对授权和额度。成都/川西道路完整性、出行方式覆盖、网络可用性和路线质量尚未实测，不能先承诺。
- 普通用户可设计为无需分别注册数据商账号；开发端需处理合法接入、密钥、缓存、配额和服务可用性。联网不是无限免费或离线可用的保证。

## 2026-09-05 商用替代资源与地质图（进行中）
- 用户明确计划买断销售、手机登录、可自带付费模型；要求寻找允许商用的免费替代资源。基础底图保留 OpenFreeMap；MET Norway Locationforecast 全球预报 API 数据 CC BY 4.0/NLOD、无商业排除，要求署名、真实应用身份、缓存，全应用超过 20 请求/秒需协商，尚未接入。全球预报约 9km；不能承诺川西山谷级精度。
- Copernicus Sentinel-2 季度无云合成候选已实际查询 STAC：成都相交产品 Sentinel-2_mosaic_2026_Q2_48RVV_0_0，10m，2026-04-01 至 06-30；集合许可链接为 Sentinel_Data_Legal_Notice。原始 COG 下载需要 CDSE 开发者凭证；已验证目录，未下载影像。可替代 EOX，但需本地加工与托管，不能把免费目录当无限瓦片 API。
- 地形候选 Copernicus GLO-30-F 公开许可允许复制、分发和改编，须署名/免责。它是 DSM，含建筑植被，不能直接声称等价替代 FABDEM；MERIT DEM 90m 可选择 ODbL 商用、衍生数据同许可，整库原样再分发另需作者书面同意，需注册下载。天气长期候选 ECMWF Open Data（CC BY 4.0），路线候选自托管 Valhalla（MIT + OSM 数据许可）。
- 用户追加地质图贴合三维地形、独立开关、图例。地质云首页本机 HTTP 200，官方有公开浏览/服务说明，但未找到收费软件复用的明确许可，不抓取其受限数据。
- 已新增 modules/geology/data.ts、GeologyLayer.ts、GeologyPanel.tsx，及固定上游缓存代理 app/api/geology/tiles/[z]/[x]/[y]/route.ts；接入 map/types.ts、TerrainMap.tsx、LayerPanel.tsx、useMapTools.ts、app/page.tsx、globals.css。使用 Macrostrat 的 CC BY 4.0 地层色块/构造线，保留原图配色、原始来源和查询属性；开启地质与海拔着色互斥。默认地质关闭，无需 Key。
- Macrostrat 中国区域实际图源 source_id 154：Chorlton / Geological Survey of Canada，Generalized Geology of the World，2007，doi:10.4095/223767。实测 carto z3/4/5 有数据，z6/7/9 为空，所以当前 source maxzoom=5 保留概览过缩放并明确精度局限。川西 z5/25/13 返回 14552 字节，含 44 面、45 线；本地代理返回 200。此处不是高精度中国地质图，更不是地下地层模型。
- 首轮检查已过：tsc、生产构建、7/7 测试（原天气4 + 地质3，包括图层样式规范、开关/透明度/图例/点选/来源URL安全）。日志 .openai/build-geology.log。未做浏览器自动截图/交互 QA，用户实际看到地质图并反馈。
- 用户反馈需要更细地质图、每种颜色说明；又明确图例不要藏在右边面板，需移到外面，字号可小。已把 GeologyPanel 移到 app/page.tsx 地图独立浮层，缩小字体，常驻图例，不随右侧面板关闭而消失；这次 UI 修改尚待最终重验。
- 正在研究更细且许可明确的中国区域数据：USGS geo3al（Generalized Geology of the Far East），官方目录明确 public domain，1999 地质年代与岩石类型图。入口 https://data.usgs.gov/datacatalog/data/USGS:60abc7f9d34ea221ce51e5ee ，DOI https://doi.org/10.5066/P9EXVH3J 。尚未下载或替换现有地质图，比例尺与对比精度仍需核对。用户免费资源清单仍需完整交付，不要只回答最后一个图例位置调整。

## 2026-09-05 地质图收尾与 1∶20 万调查
- 地质图例已从 LayerPanel 移出，作为 app/page.tsx 独立地图浮窗显示；字号 12px、辅助说明 10px。颜色列表常驻，放在点选详情之前；移除嵌套列表高度限制，仅在浮窗超出视口时滚动。图层面板开关不影响浮窗显示，地质图层本身关闭时才隐藏。
- 已核对 USGS geo3al 原始 FGDC 元数据：虽然官方目录标 public domain，但 useconst 限制向第三方使用和再分发，存在授权冲突。已向用户纠正先前只读目录的结论；没有接入该数据，删除本轮下载的原始 GMT 临时文件，保留忽略的 XML 供研究证据。未生成或发布其衍生地图。
- 用户进一步要求 1∶20 万：找到《全国1∶200 000数字地质图（公开版）空间数据库（V1）》正式论文，2019，DOI 10.12029/gc2019Z101；1163 幅，约 72% 国土，90GB，MapGIS/ArcGIS 矢量及属性/图例，原始资料 1957–1995。数据 DOI 10.23650/data.A.2019.NGA120157.K1.1.1.V1。官方旧入口本次 HTTP 502、HTTPS 失败，尚未取得具体图幅或商用再分发条款；不宣称已经接入 1∶20 万。
- 地调局 2019 公告确认地质云发布 1∶20 万与 1∶25 万合计 1264 幅，不能全部称为 1∶20 万。2026-08-27 另发布 1∶20 万网格化数据集登记公告，但无直达下载/商用许可。川西实际覆盖需取得分幅索引后核验。
- 新增 docs/data-sources.md，记录免费商用替代候选、申请/加工/托管区别、具体来源与核验边界。README 增加地质模块、改动文件、验证和回滚说明。天气、云雨、道路、卫星和地形算法未改，无业务功能删除；原有非商业数据仍待替换。
- UI 移出后的天气/地质测试 7/7 已通过；最终 TypeScript 与构建正在收尾。未新增浏览器截图或交互 QA，继续本地预览，不部署在线版本。
- 最终验证完成：TypeScript 无错误，天气+地质 7/7 测试通过，生产构建退出码 0（.openai/build-geology-final.log），git diff --check 无空白错误。本地页面 HTTP 200、地质代理瓦片 HTTP 200 / 14552 字节。没有对本轮浮窗布局执行浏览器视觉 QA。
- 交付边界：独立地质图例与概览图层完成；免费候选和 1∶20 万正式数据集资料已交付 docs/data-sources.md；1∶20 万实际文件、当前下载通道与对外商用授权仍未取得，故未接入。后续优先取得成都/川西公开版图幅、配套图例和具体许可，再进行坐标核验和瓦片转换。

## 2026-09-05 继续接入 1∶20 万（进行中）
- 用户明确要求继续寻找实际接入。旧 igss.cgs.gov.cn/admin/token/service/index.jsp 返回 404；新版门户公开 JS 确认使用 /igss/ 网关、WMTS 与 WMS，并通过元数据解析矩阵。新版网关请求 qg20_20210401_FCnDDRJd 的 GetCapabilities 返回 HTTP 200、29 字节“Token失效，请重新登录”，是认证错误，不是已拿到地图或已验证该图层。
- 研究文件位于 .openai/geocloud-*.log（忽略）；未使用门户的第三方底图 Key、未提取用户会话、未借用其他人的 token。已询问用户是否有地质云账号/服务 Token，不要求把凭证发到聊天。
- 实现计划：地质模块内加入 WMTS 元数据/坐标适配、服务端私有 Token 代理、图源切换与明确授权状态，外置图例保持。元数据校验真实图层标题/比例尺；当前无有效 Token，最终真实图幅测试仍需授权。天气/云雨/道路/地形算法不改；可通过图源选择退回原概览图。
- 已实现 modules/geology/geocloud/{capabilities.ts,projection.ts,server.ts,GeocloudLayer.ts}、app/api/geology/geocloud/route.ts；新增 fast-xml-parser，保持原框架与依赖版本不变。服务端固定官方网关，Token 不下发；辨认 HTTP 200 授权错误；元数据必须明确 1∶20 万地质图后才显示。
- 新增 geologySource 配置，外置图例可选择世界概览/地质云；独立来源状态避免旧图例或过期异步请求冒充详图。支持 WMTS 原始矩阵标识、轴顺序、范围，EPSG:4326/4490/CRS84 瓦片转换为墨卡托后贴合地形，优先直接处理 3857。Raster 详图只使用原服务图例，缺失时不推测颜色，也不假装支持岩性点选。
- 空白 .env.local 已准备且被 git 忽略，config/geocloud.env.example 是公开模板；无凭证被填入。docs/geocloud-integration.md 写明历史标识仍待真实元数据确认、授权步骤及实际数据未验收。源图例/川西覆盖/真实坐标精度仍需有效服务 Token。
- 首轮新增协议检查 13/13 通过；TypeScript 发现 JSON unknown 和 Response TypedArray 类型问题，已修复，正在最终复验。又增加未授权与异步图源切换测试。
- 最终验证：TypeScript 通过；天气+地质+WMTS 14/14 测试通过；生产构建退出码 0（.openai/build-geocloud.log）。本地页面 HTTP 200，旧概览瓦片 HTTP 200 / 14552 字节；新 API 在空配置下按预期返回 HTTP 503 和“尚未配置授权 Token”。git diff --check 无空白错误，git check-ignore 确认 .env.local 不跟踪。未执行浏览器视觉 QA。
- 未完成项与真实阻挡：没有本应用有效的地质云服务 Token，也未获取通过认证的真实 Capabilities，因此历史服务标识、真实图幅覆盖、图例与视觉贴合尚未验收。不能说地图已经升级到 1∶20 万。用户账号/Token 状态异步询问尚未收到答复；配置、选择器和重连已准备，等待真实授权信息后继续实图验证。没有替用户注册、接受协议、提交申请或发布在线服务。

## 2026-09-05 手机优先 UI（进行中）
- 用户明确主要在手机上使用，要求优化分散 UI 并适配手机视图。本轮只修改界面组织，不安装移动端容器、不上线新服务，不添加尚未接通的导航入口。
- 新增 controls/ControlDock.tsx（单一非模态底部面板、地图/天气/图层/视角入口、拖柄与 Escape 收起）、WeatherSummary.tsx（地点天气和海拔摘要）、MapActions.tsx（地图快捷操作）。默认面板收起，保留地图空间。
- 重组 app/page.tsx；天气/图层/视角组件去除绝对位置，Timeline 改为紧凑时间轴。海拔和地质图例仍独立显示在地图上，不藏进底部面板。
- 样式按职责拆分为 app/globals.css（主题基础）、controls/workspace.css（响应式框架）、controls/panels.css（面板内容）、geology/legend.css（图例）。移除旧的多轮定位覆盖规则；layout.tsx 配置 viewport-fit=cover 与安全区。支持手机竖屏、横屏侧置工作台、桌面居中工作台。
- 待完成：检查窄屏和短屏规则、TypeScript、既有测试、构建、本地 HTTP。尚未进行手机真机或浏览器视觉 QA；继续保留本地预览。
- 最终验证完成：npx tsc --noEmit 退出码 0；原有天气/地质/WMTS 14/14 测试通过；npm run build 退出码 0；git diff --check 退出码 0。日志 .openai/{typecheck-mobile-ui-final,test-mobile-ui,build-mobile-ui,diffcheck-mobile-ui}.log。本地 localhost:3000 页面 HTTP 200。
- 已把地图加载/错误状态放入顶部摘要，长内容在面板内完整保留；小尺寸竖屏展开面板时缩放按钮暂收起，保留朝北与 2D/3D，缩放仍可通过双指手势或收起面板后按钮操作。地质颜色列表移至图例顶部，优先可见。
- 修改/新增文件完整说明已写入 README.md 的“手机优先工作台”。无业务功能删除，无数据源/地图算法/API 变化。没有生成 APK、没有浏览器截图/交互 QA、没有手机真机验证；已完成的是响应式网页界面及编译/既有逻辑回归检查。沿用当前本地预览，没有再次发布私有在线版本。

## 2026-09-05 安卓 APK 与双指视角（进行中）
- 用户要求在项目文件夹生成 APK，并询问安装即用、导航状态。已明确导航未实现；正将当前地图/天气客户端独立打包，避免绑定电脑 localhost。
- 用户追加：视角不应单独占一个界面，手机角度必须双指调整。已移除底部“视角”入口，明确开启 MapLibre 原生 touchPitch/touchZoomRotate；单指保留平移，双指旋转/缩放/上下滑动俯仰。桌面保留地图内辅助控制器。
- 已发现 D:/GodotAndroid/sdk Android 35 和 build-tools 35.0.0、便携 JDK 17；adb 当前没有连接设备。使用独立 mobile/ 静态入口复用 React 界面、Android WebView 本地 HTTPS 资源与固定源数据适配，不加载开发服务器或在线私有登录站点。
- 新增 mobile/main.tsx、index.html、vite.config.ts 与 mobile/android/ 原生容器；计划 scripts/build-android.ps1 生成项目 APK/ 安装包、独立测试签名与校验信息。公开地图和天气联网请求，成都高程打包；地质云 1:20 万仍缺授权，安卓版本明确提示。未开发路线计算，也不宣称商业发布就绪。
- 安卓包已生成并最终校验通过：APK/Guanyun-0.1.0-test.apk，53,303,614 字节；SHA-256 99F1716645E89EF76A0A3D10688F56222965AC9189C63B5D8BC244AD22C0C673。包名 com.guanyun.weather，版本 0.1.0-test，minSdk 26 / targetSdk 35，仅 INTERNET 权限，v2/v3 签名通过。安装说明和 sha256 文件同目录。
- 打包时发现 Android Windows 原生工具不接受中文绝对路径，以及 AAPT2 的嵌套 assets 条目含反斜杠。脚本改为相对路径，并在对齐/签名前规范化 ZIP 条目；校验确认模块 worker、地形覆盖索引及 473 张本地高程瓦片完整，未混入 .env/密钥/构建文件。最终日志 .openai/build-apk-final.log，构建退出码 0。
- MainActivity 本地资源容器、LocalGateway 固定数据适配、DataTransport 限制型网络访问已完成。原生适配代码的 JVM 检查通过，并实际请求到地形 PNG 87,207 字节、地质 MVT 14,552 字节、NASA VIIRS 元数据日期 2026-09-05；这不等于真机 WebView 联调。
- 类型检查、原有天气/地质 14/14 测试、网站生产构建、git diff --check 全部通过。文档 mobile/README.md 记录接口/依赖/回滚，README 增加入口说明。无导航路线计算，1:20 万授权仍未取得；当前包用于个人原型测试，不代表全部数据已可商用。没有设备连接，未完成手机安装启动/渲染/双指触控/性能验收。
- 手势最终行为：底部仅地图/天气/图层；手机单指平移、双指旋转/捏合、两指并排上下滑动俯仰。原独立视角页面已移除，大屏鼠标设备保留地图内辅助控制器；已有地图/天气数据算法与网站 API 保持。

## 2026-09-05 紧凑地图界面、路线、视角控件（进行中）
- 用户手机截图显示原底部摘要/时间轴/导航栏、顶部标题与海拔图例遮挡严重；已取消底部上拉面板，改为 40px 按钮组和按需小浮窗，海拔改为 66px 宽常驻色带。缩小标题及地图控件；安卓根容器消费已应用的系统安全区，避免 WebView 再次留白。
- 用户追加接入路线规划，以及按示意图制作绿色固定底点的模型和可滑动旋转环。准备新增独立 navigation 模块与地图路线接口；控件直接叠在地图角落，地图双指手势保留。
- 正在核实 Valhalla/FOSSGIS 路线和 Photon 地名搜索公共服务；仅用于当前轻量测试，保留可替换适配器。Nominatim 公共服务不接入。新版 APK 将使用相同测试签名，版本 0.1.1-test / code 2。
- 待完成：路线实测/错误处理、视角控件、编译与回归、重新生成 APK；此时不能宣称全部功能已验证。

## 2026-09-05 本轮实现与初验
- 新增 modules/navigation/{types,provider,useNavigation,RoutePanel,RouteLayer,navigation.css}：FOSSGIS/Valhalla 道路计算、Photon 中文地名搜索、驾车/骑行/步行、地图选点/交换、路线距离/预计时长/转向、失败/取消/过期结果保护。通过 RouteOverlay 与 MapHandle 连接地图。单用户请求间隔 1.1 秒、内存缓存/超时；正式运营需要自有/有保障的服务。没有实时定位跟随、语音和路况。
- 新增 controls/CameraGizmo.tsx + cameraGesture.ts：按用户图示实现底点固定绿色立体楔形模型，拖动调俯仰；椭圆环拖动调方位，跨 ±180 度连续。SVG 小控件直接在地图角落，原桌面大控制器入口移除；地图仍为双指调角度。
- 用户又追加手绘轨迹。新增 modules/tracks/{drawing,useManualTracks,TrackDrawing,TrackPanel,TrackLayer,tracks.css}：24–80px 牵引杆缓冲、独立笔尖与手指环、暂停移动地图/继续画、撤销/清草稿、本机保存/显示/删除。每一笔分别保存，不跨笔补线、不将手绘轨迹冒充可导航道路。地图 unproject 使用 MapLibre 地形参与的屏幕投影，反投影误差大时拒绝天空区域。
- 本轮跨模块仅使用 props / RouteOverlay / TrackOverlay / MapHandle；新增 CSS 由网页和安卓入口共同导入。相机移动不反复重置路线 GeoJSON（memoized overlays）。安卓返回键覆盖浮窗/轨迹编辑/选点，不再直接退出丢失当前操作。
- 已通过 TypeScript 与 27/27 测试（原14 + 路线6 + 牵引/轨迹/视角7）。实际服务通过生产适配器返回成都驾车约 2.0km/356s、骑行 2.55km/577s、步行 2.10km/1730s，中文“都江堰”搜索有结果。三个模式为真实不同道路成本请求；耗时不代表实时路况。日志 .openai/{test-compact,navigation-live,typecheck-compact-final}.log。
- 待完成最终网页/安卓构建、APK签名核验和文档更新。尚未进行新版真机操作或浏览器视觉验收；不要把编译/API测试当作触控实测。

## 0.1.2 轨迹交互与完整线路开发记录（已收尾，最终结果见顶部）
- 用户连续补充：单指画线/双指原生控图，默认线细且颜色/宽度可调、浮窗更小；起点用偏离手指的放大镜精定位，同时保留牵引平滑画线；节点/端点吸附拼接、多次续画和线路统计/沿途天气。
- 最终交互目标：默认平滑模式先用放大镜定精确起点，然后从偏移牵引环连续画；松手保留终点，下一笔接着画。逐点连线为第二模式。双指落下取消未确认点/提交已有墨迹，并交还真实 MapLibre pan/pinch/rotate/pitch；全部抬指后再单指起笔，不生成跳跃线。
- 已开始新增 DrawingGestureBridge（公共地图事件，不转发合成触摸）、style/TrackStyleControls、draft 状态历史、precision/PointMagnifier 与 map/magnifier 实际渲染帧放大；TrackDrawing 正在重接完整交互，当前不可交付。
- 计划节点吸附/相连笔画拼接、保存轨迹续画；地形采样统计和按时间/速度沿线预报。所有改动通过 MapHandle/props，既有数据源不替换。
- 此时尚未最终编译/测试/重建APK，不能宣称0.1.2已完成。原0.1.1安装包仍保留。新手势/精定位实现需边界测试；没有获得浏览器QA要求，按当前Sites技能不执行浏览器截图/DOM/触控自动化。
- 本轮主要实现已接入：精定位/平滑与逐点模式、原生双指交接、14px节点吸附、相接笔画保存合并、已保存线路续画/反向/合并相接线路、0.5–5px线宽和颜色、252px/44dvh手机浮窗。新增 journey 模块按同源DEM分瓦片限并发采样，高程剖面/累计爬升下降/净高差与里程；多点Open-Meteo预报按北京时间出发与可调速度匹配沿途ETA。
- TypeScript 初轮通过。接下来增加手势交接/精确起点/吸附合并/高程缺失/跨天预报测试，实请求少量数据并构建0.1.2。没有手机实际触控验收，不要提前交付。

- 0.1.2最终收尾：47/47检查、类型/网页/APK构建、真实两地168小时预报、签名匹配和打包功能/473瓦片核验完成。无剩余本轮编码/打包项；真机手感/性能验收尚无连接设备。具体哈希与验证边界见顶部最新交付。

## 0.1.3 导航进度、收藏与传感器开发记录（以下为过程，最终结果见顶部）
- 用户追加：已规划导航左侧两条颜色进度带（气温/雨量）、当前位置进度；画线实际画不了；路线收藏夹；当前定位按钮；正北/跟随手机方向切换。此前GitHub同步目标仍有效，完成新功能后继续同步。
- 已找到一项具体绘制缺陷：DrawingGestureBridge与map/magnifier用getCanvasContainer().clientHeight/rect换算。MapLibre的canvas是绝对定位，外层canvas-container没有独立高度，触摸可能得到NaN坐标、放大镜无法取样。将改用真实getCanvas()的CSS尺寸/rect，并增加零高容器回归检查。
- 计划：独立position模块管理用户主动启动的定位/方向传感器，Android WebChromeClient桥接本地HTTPS源定位权限；navigation收藏存档与恢复；journey按路段累计耗时匹配沿途预报与左侧窄色带；使用props/MapHandle连接。原始地图/地质/卫星数据不改。
- GitHub首次快照已暂存646文件（含473地形PNG），凭证模式/排除路径/体积检查通过。初始提交与推送在执行，日志.openai/github-initial-*.log；最终需核验远程SHA。APK Release将以本轮修复后新版本为准，当前0.1.2本地包保留。
- 当前未完成0.1.3源码/测试/构建/Release；不能声称定位或进度色带已可用。没有浏览器QA授权，不执行本产品浏览器DOM/截图/模拟触控验收。
- 0.1.3主要源码已接线：position模块的主动定位/绝对方向/误差圈，原生LocationPermissions仅允许本地HTTPS资源域且走Android前台位置权限；路线收藏与恢复、统一收藏夹；journey根据路段耗时计算8点以内的ETA预报，左侧两色带/颜色说明/当前进度，旧定位或偏离路线不强行给进度。
- 绘制已改为getCanvas()真实CSS尺寸，触摸与放大镜不再依赖零高外层；补充同场景测试。绘制CSS提高触摸优先级，避免禁单指地图平移后浏览器接管拖动；提示分成①定起点②拖绿色环。版本已升0.1.3-test/code4，尚待最终检查/构建。
- GitHub首次推送已成功：origin/main = 61ba1c63c10a31c8986e2dcfb018fdb00518f22b，与本地首次快照一致。当前功能新增仍未提交/上传；完成0.1.3后再次同步并发测试版Release。不要报告全部新需求已上传。

## 当前任务：自由矩形剖切面（2026-09-06，进行中）
- 当前目标：将水平海拔剖面改成可拖动、缩放、自由旋转的有限矩形切面，裁掉靠近观察者的一侧并显示相交轮廓。
- 当前进展：完成项目检查、干净工作区快进同步及 MapLibre 6.7/Three.js 渲染路径核实。采用独立 GPU 裁切适配器与自定义切面图层；原始 DEM 不再因调整切面而改写或 setTiles。保留旧水平算法用于已有测试，产品入口切换至新实现。
- 涉及文件：modules/section/ 新平面数学、GPU 适配器、图层及控件；TerrainMap、AnnotationLayer、app/page.tsx 接线；相关测试与文档。
- 已执行命令：git status --short、git diff --stat、git pull --ff-only；读取项目规范、模块源码及安装的 MapLibre 6.7 源码。
- 验证结果：进行中，尚不可交付。
- 当前阻塞：无；GPU 接入与真实画面需要专项验证。
- 下一步：实现有限矩形裁切和交互，检查手机 390×844/360×780 及真实 WebGL 效果，类型/逻辑/双入口构建后同步 GitHub。

### 自由剖面首轮验证
- 已完成：GPU 裁切、有限矩形边界、实时观察侧选择、DEM 求交填充与单线轮廓、五个拖动手柄、位置/角度/尺寸紧凑分组、模型同面裁切与封口。地图持续使用 elevation 原源。
- 文件：新增 planeMath.ts、terrainClip.ts、PlaneSectionLayer.ts、planeModels.ts、section-plane.test.mjs；修改 SectionPanel/section.css/types、TerrainMap、AnnotationLayer、app/page.tsx。
- 命令：npx tsc --noEmit PASS；node --experimental-strip-types --test tests/section-plane.test.mjs，5/5 PASS；oxfmt PASS。初次浏览器在 dev server 未就绪前连接失败，服务就绪后有界复测 PASS。
- 截图：artifacts/screenshots/free-plane-initial-20260906.png；PASS，真实川西山体沿矩形面裁切、白色轮廓贴合山脊、外侧山体保留；WebGL/page errors 为零，原 elevation 源保持。截图有开口延伸向观察者，为有限矩形沿法线裁切的预期效果。
- 当前阻塞：无；尚待拖动/角度/背面/手机和完整回归。下一步：专项交互与 GPU 像素验证。

## 0.2.9 本轮追加进度
- 已完成代码接线：气温25格预报着色/时间图例；规划灰按钮改可点击校验；导航启动模式选择、自动同模式接入原起点、已过起点防止重合段匹配回接入路；四类路线图片/GPX/KML/高德分段链接分享，Android只读route分享Provider。
- 用户追加图片二维码，确认离线允许简化，并进一步要求超限时大幅概括弯道；新routeShare/qrCodec渐进RDP压缩，保留起终点/途经点/主要边界，独立二维码不修改原图及GPX/KML，载入前显示精度和概括提示。新RouteQrReader及工具扫码入口，图源扫码可分流路线码。
- 用户指出图片无起终点名称：现另用Canvas显式绘制红绿起终点标记/名称及顶部经纬度，路线改为明亮绿色，修正经度边界浮点环绕。待重新生成视觉验收。
- 已PASS：252全量回归（二维码追加前）；新增3项二维码编码/本机jsQR解码/激进简化/损坏超限拒绝测试PASS。类型在初期修复DOM append冲突后PASS，最终仍待复跑。
- 浏览器真实搜索：成都东站→春熙路驾车10.1km/24分钟规划成功；原分享图片/海拔图生成成功，无console error。390无横溢；初版亮色主题文字对比度已改。新QR/终点标签及360验收未完成。
- GitHub连接恢复：0.2.8草稿id384434144，APK服务端digest已匹配797d5eb...，仍未发布。将由0.2.9完成包交付，不声称旧草稿公开可下载。
- 当前自建dev进程session40756端口3108；浏览器IAB tab3，route-share对话框可能仍打开。工具脚本.openai/probe-gh-028.py、verify-apk-028.py未跟踪；Harmony6文件保持未动。下一步完成UI/扫码/模拟定位的集成验证，再全量检查、更新版本16/0.2.9、双构建、APK核对、提交推送和发布测试Release。
- 构建校验发现旧mobile/dist累计多个历史index散列文件；scripts/build-android.ps1改为每次完整构建使用新stage/web目录，不删除旧文件。首包不发布，重新构建后核对完整资源；SkipWebBuild仍显式使用既有dist。
- 逻辑验证PASS：types及306/306全量测试通过。新增旧路线中间handle在drawing时保留、原值吸附闭环、主线/分支两条通路、保存重读和撤销回归；首轮导航计算浮点舍入差异改按既有vertexKey精度比较。独立UI端口9180已被其他服务占用，未干预，改9191；用户9178数据保留。
- 用户追加精简操作：草稿节点也须直接操作。已改为选中即出现单排＋/−/分叉/连接/撤销/完成；连接改地图点选目标节点，去掉路线/坐标下拉菜单。draft.ts增加草稿增删/分叉/连接共享撤销快照，保留kinds/pointLine；孤立单点可删除，草稿拉分叉不先保存。UI与新增回归验证进行中。
- 用户追加备选绕路：新增alternatives.ts按真实共同节点识别回接绕路，原路顺序默认不变；备选完整线替换两连接点之间原段，左右段仅计一次。地图绕路用区别于主线的颜色，选备选时淡化被跳过原段；TrackJourneyRail并列独立进度条可点选/拖动，沿线标记用各自线形重算距离。正在检查类型、复杂连接/闭环回归与UI。


## 0.2.14 实施中验证补记
- 新增缩略底图：绿色起、红色终，交换与备选同步。按用户截图继续压紧一级卡，进度轨道6px，44px触控带，上移搜索栏下方且避底卡。
- 独立9192合成数据实测：收藏→卡→详情→分享→两次返回保留6米绿点；编辑直接拖点、增删、撤销、放弃PASS；孤立分叉保存错误留在编辑PASS；接回旧节点闭环/撤销/跨线保存新组合及9节点连通PASS。截图artifacts/screenshots/*0214*；iframe390×844在原生画布缩放0.82供清晰截图，DOM按真实CSS尺寸核验。
- 5项所选方案导航回归PASS：原路/绕路、反向、最近接入、端点延伸、隐藏路线排除；类型PASS。下一步360×780与标记返回、全量/网页/APK构建/发布。

## 0.2.14 最终追加（2026-09-09）
- 用户反馈：编辑分叉应沿用常规画线；详情增加删除；拖动导航天气进度条的弹窗太大居中。已修改 app/page、RouteViews、routeEdit、DrawingSession、RouteWeatherRail/route-rail.css。
- 分叉接回 TrackDrawing/DrawingGestureBridge：准星定点、松手连接、双指控图，节点优先吸附，沿道路段作为一次撤销；其他可见线仅接入。详情底部确认删除，取消/返回保留；持久化失败返回false不退出。天气预览移到左侧轨道旁，164px紧凑卡，重复说明归入图例。
- 验证PASS：types；332/332逻辑；网页构建；最终APK新stage apk-20260909-070920；v2/v3原系列签名、版本21、包名com.guanyun.weather.preview、zipalign、525资源逐项比对、496PNG解码、473FABDEM/CRC。SHA256 f4a8e9c054b6df797c53ae58d716139843e14c0ae962eda09afe592dae03af50，55,219,775字节。
- 当前BLOCKED：新增三处的最终浏览器截图与手势端到端回归。CUA先ERR_CONNECTION_REFUSED（9192进程停止），重启Vite后浏览器连接仍反复超时/空列表；未更改用户9191存档、未刷新其草稿。后台Start-Process被策略拒绝，改为允许的前台exec服务。既有四窗口390/360截图与DOM/实际交互结果保留，不能冒充新增三处已验收。
- 下一步：恢复CUA后的手机截图，完成design-qa；同步代码与测试APK发布，明确真机尚未验收。

## 0.2.14 回归已恢复并完成，待同步发行
- CUA恢复，用户确认其地图正常。最后三处实际UI已补验：360准星偏移44CSSpx松手加点（截图上218→182），再松手吸附旧节点闭环，撤销恢复分叉，未保存返回放弃PASS；详情确认/取消PASS。没有对用户或测试已被用户操作的数据执行删除。
- 360与390天气小卡均x56/y90/164px宽，高度124/123px，关闭及重试44px，实际拖动99%→44%卡片仍靠边，页面无横溢、仅一个进度组件PASS。截图weather-preview-0214-360/390、route-delete-0214-360、route-details-delete-0214-390、route-branch-precision/closed-0214-360。正文已嵌入360天气卡。
- design-qa.md已按同图对比要求检查三张comparison board及重点截图，浏览器范围PASS；部分实时天气/DEM缺测状态按真实缺失显示—。无真机GPS/触控/性能验收。
- 生成docs/release-0.2.14.md、APK安装说明与发行说明，更新mobile/README。最终APK与332逻辑/types/web/资源/签名验证沿用本节之前的最终结果，无后续业务源码改动。下一步git提交推送和测试Release。
- 发布前diff检查发现Manifest文件尾多一个空行，已移除并完整重出APK，未改业务语义。最终以apk-20260909-073707/web为准：55,219,775字节，SHA256 a5a13e86c26671a819082950669748cc40da53ed8d03217f029e0358eda917ff。独立525资源/496PNG/473FABDEM/CRC校验再次PASS；前f4a8包为中间构建，未公开交付。
# 晚间反馈进度补充
- 已改：独立APK CameraCaptureProvider authority错误映射（此前与.photos重复，现明确.capture并检查唯一性）；地点/模型统一dot/icon/label呈现；两点测量使用第三图修订版、地形自动海拔，移除Z编辑；道路locate最近投影与虚线接入/途经点往返；24处通用输入联想；工作型面板拖图保持、路线看全程不关闭。
- 新增modules/input/*、modules/navigation/roadAccess.ts、tests/feedback-20260909.test.mjs；其他文件见git diff。未修改照片/轨迹旧存储内容，新两点测量使用独立key保留旧折线。
- 验证：类型检查PASS；首轮376测试375PASS/1FAIL，为原模型测试替身缺map.off，已补；新增六项业务回归PASS。下一步重跑、浏览器双尺寸真实流程、APK工具链定位/打包和签名核验。当前SDK默认路径不存在，正查本机实际位置；未交付新APK。
- UI参考：生成图exec-7f35d97f-fad1-4091-b5bc-f459ce7519f4.png（用户选择第三图）、修订exec-f3f55f31-8c8f-4c74-9b0f-9cb4c4d98737.png；按追加要求高度只读不调整。现状截图measurement-reference-20260909.png；390截图旧捕获缩放现象，不能当精确像素验收。

## 最终验证轮
- 用户已明确暂时取不到下午签名，先完成源码/网页；APK发布暂停，不再等待签名才提交。已通过网页和Android网页构建、376/376逻辑与类型。
- UI追加验证发现照片缩略图会抢标记点击：选点时隐藏缩略图，带照片的A与模型B都正确选入测量；任务长按不再转新建，Escape保留取消选点/关闭面板区别。
- 390/360无横溢且按钮44px；远景地点/模型均9px小点/隐藏名称。在线两标记路线508m含47m接入；道路出口指令已与最终到达区分。照片样例保存并打开，960x960解码通过。测量时隐藏路线摘要和沿途天气，避免遮挡。
- 下一步最终类型/构建，文档与源码提交推送核SHA，交付9230预览。
