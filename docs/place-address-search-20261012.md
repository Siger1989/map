# 地点与地址搜索完整本地审查（2026-10-11～12）


## 交付范围

本轮为搜索功能的可审查源码成果，用户已授权同步到独立搜索分支。原工程开工与恢复后均为 `codex/rollback-ui-0235-20260921`，HEAD `1947a6f0efa641928267cb85e01fa1f0f483ec16`，源码工作区干净。实施在隔离目录 `search-worktree`、分支 `codex/place-address-search-20261011`，本地验收阶段没有提交/推送；本次授权仅将这些成果纳入指定分支源码同步，不升版、不生成安装包或替换应用。

基线是0.2.120-test/code127源码；原本机私有APK/PC EXE不包含本轮搜索修改，不能作为本轮测试证据。预览为 `http://127.0.0.1:9174/phone-preview.html`，保持手机框且不进入网页全屏。API独立运行于3108。隔离预览使用apk-preview模式、已有Key及原私有图源种子的只读引用；没有修改Key或用户存档，没有向公开来源上传私有产物。

## 行为变化

- 地图顶部与路线起终点共用搜索引擎和hook。默认自动按区域选择已接入来源；明确选择天地图或全球OSM时，只查询该来源。
- 天地图根据地图中心提供附近范围，支持明确城市范围；无结果时按有界策略扩大。用户可勾选“全国扩展”移除城市/中心限制，原查询文本保留。附近范围是中心周边范围，不声称严格等于当前可见地图框。
- 天地图按每页20条按需加载，官方start偏移范围0～300；count300本来合法，本轮调整为20是控制成本。没有自动扫完全国所有页。
- 详细地址使用现有Key的官方地址编码；若地址已有城市，不重复附加城市。Photon保留无name的街道/门牌。城市偏好为瞬时UI状态，查询仅有短期内存缓存。
- 统计、行政区与建议词响应提供继续查询的动作；行政区中心不作为精确地址。无实际关键词的“全球”提示不生成重复按钮。
- 完整名称匹配优先于包含该名称的周边商家；同类再按地图中心距离排列。地图中心改变只重排现有结果，不触发新搜索请求。
- 结果显示地区、来源、匹配粒度和距地图中心距离。地址编码仅在明确返回“门址”时标为门牌地址，不使用score推断精确度。粗粒度/未知精度提示核对地图。
- 500ms防抖、IME处理、取消与过期响应保护；分页单次加载、去重；每来源请求间隔、超时、结果大小和缓存上限。
- 错误按HTTP状态及官方infocode区分空结果、鉴权、限流、网络、参数、服务和格式错误。不回显Key或请求URL。

- 搜索结果默认折叠筛选；正常390×857/360×780两入口默认完整显示3条、展开显示6条，11条均可滚动访问，明确显示已载数量和固定加载更多。展开/筛选显隐不追加网络查询，每页20条预算不变。
- 搜索浏览的默认最大205px、主动展开最大340px为本轮用户允许的局部安排；390×480路线默认受锚点空间限制为2条，展开6条。主选择44px、输入16px，完整名称/地址/精度/坐标系及分享在详情中可达。
- 顶部输入左右10px留白、44px高度、单行垂直居中，保留光标/清除/搜索按钮。结果标题与关闭键保持11px/9px边距，按真实单双列右工具宿主避让。
- 终点选好后若起点为空，保留自动聚焦起点的既有流程；新起点浮窗0条，终点结果不会残留，Esc仍可关闭。

## 主审修正的根因

|问题|根因与修正|再次测试条件|
|---|---|---|
|快速输入后的搜索迟缓|旧节流器提前给等待者分配时隙，取消后仍累计延迟；改成实际取得轮次才预留间隔|同时排队、取消等待者、继续新查询，实际发起间隔保持|
|建议词重复原查询|建议解析丢掉keyword/word及prompt类型；按官方结构生成实际新查询，type4不发送城市限制|统计/行政区/prompt1～4及无关键词全球提示|
|“青城山景区”HTTP400|旧行政区正则把景区、小区等词当作specify；收紧明确行政前缀推断，区类歧义不自动限制|景区/小区/社区/校区/园区/超市；省市连写及跨城前缀|
|同名小区被驿站排在前面|原界面纯距离排序；两入口共同优先完整名称，再按距离排列|同名跨城、附近包含该名称的商家、中心改变与无中心|
|Esc后再次点输入框不开结果|焦点仍停在输入框，点击不再触发onFocus；增加实际点击打开动作|键盘关闭→再次点击输入框→选择地点|
|短屏路线搜索盖住底栏|浮窗只按视口计算，未扣除页面栏占位；按实际顶栏/底栏边界及键盘计算，空间足够时选上方|390×480路线终点搜索；窄屏与键盘视口|

## 同条件小区对照

使用同一公开地图相机 `[104.166,30.615]`、390×857、已有私有配置、内置天地图矢量和关键词“东原晴天见”，独立浏览器上下文不读取真实用户数据。

|项|原120|优化版|
|---|---|---|
|请求|全国bbox、queryType7、start0、count300|附近bbox、queryType2、start0、count20|
|实际响应|HTTP200、status1000、count30|HTTP200、status1000、count11|
|检索成功|成都小区及其它城市同名小区均存在|成都小区及周边相关POI存在|
|第一条|菜鸟驿站，距中心26米|小区本身，距中心109米|

原120也能找到“东原晴天剑”和“东原晴天见”。历史漏搜对应的版本、请求、配置或网络原因没有证实；本轮不能声称修复了一个已重现的旧版漏搜，也不能把两字差异当成已确认根因。此处明确记录了算法导致的请求范围变化，并通过相同相机确认排序变化。全国扩展/明确城市提供其它同名地点的检索方式。

## 验收记录

|检查|结果|证据/边界|
|---|---|---|
|定向回归与React组件|PASS，41/41|七个测试文件，见下方命令；服务响应注入，含真实React组件展开/复位、筛选/结果保留、不新增请求；不是实际API测试|
|主agent TypeScript|PASS|`npx tsc --noEmit`，最终源码|
|搜索服务、共享hook、顶部入口、反馈/选项/排序及浮窗lint|PASS|定向Oxlint，新增/修改的搜索代码|
|RoutePanel完整文件lint|FAIL，10个既有问题|原文件已存在的生命周期/refs、依赖及语义标签问题；基线源码逐项对照，未扩展为无关重构。不能称相关整文件lint全绿|
|Web及手机Web构建|PASS|`npm run build`、`npm run build:android:web`；只验证编译，不是APK/EXE交付|
|第一阶段浏览器模拟交互（历史服务/入口回归）|PASS，21/21|实际浏览器，模拟搜索响应；空结果、鉴权/限流/参数/网络、过期/取消、IME、分页、建议、显式来源、城市/全国、粗精度、键盘、头尾栏避让|
|真实小区/街道/公开医院地址|PASS（案例）|两处入口的小区及医院门址；国学巷实际返回街道和相关POI。仅用公开地点，没有私人地址|
|真实景区查询|参数回归PASS；覆盖有限|修复前HTTP400/specify错误，修复后HTTP200、6条周边相关POI；未返回可确认的精确景区入口|
|最终三尺寸布局与点击|PASS，55/55（实际API/浏览器）|390×857、360×780正常两入口3完整/展开6完整；390×480顶部3/6，路线默认2/展开6；全11条可滚动。240px外框、默认最大205px/主动展开340px、短屏路线默认188px；输入16px/44px及左右10px，标题11px/关闭9px|
|最终模拟分页浏览器回归|PASS，18/18|两入口20→35；更多固定可见、忙时禁用、连续点击仅1个start20/count20请求，耗尽后隐藏更多；无真实API请求|
|最终右工具命中与交叠|PASS，3/3尺寸|每尺寸9个可见按钮中心命中，与展开卡无交叠；补充使用模拟公开结果，不调用GPS|
|天地图底图|PASS（当前浏览器）|内置入口实际选择，地图道路/地名可见，最终实测68次瓦片HTTP200。初次空底图截图过早，不作为Key失效证据|
|git diff --check|PASS|没有空白错误；LF/CRLF提示非检查失败|
|原生平台能力|未测|Android/PC原生、真实GPS、系统键盘触控、后台记录、权限/相机/系统分享、性能；未启动记录或伪造原生回调|

第一阶段历史截图（保留原服务审查证据，布局已由下面最终密度结果更新）：[顶部390](../artifacts/screenshots/search-20261011/optimized-search-390.png)、[顶部360](../artifacts/screenshots/search-20261011/optimized-search-360.png)、[路线390](../artifacts/screenshots/search-20261011/optimized-route-390-final.png)、[路线360](../artifacts/screenshots/search-20261011/optimized-route-360-final.png)、[路线短屏](../artifacts/screenshots/search-20261011/optimized-route-short-final.png)、[同相机基线](../artifacts/screenshots/search-20261011/baseline-same-camera-390.png)。模拟响应截图单独命名 `mock-route-short-final.png`，不冒充真实搜索结果。


```powershell
npx tsc --noEmit
node --experimental-strip-types --test-reporter=spec --test tests/tianditu-search.test.mjs tests/place-search-distance.test.mjs tests/search-viewport.test.mjs tests/place-search-pipeline.test.mjs tests/search-hook.test.mjs tests/search-result-order.test.mjs tests/search-ui-components.test.mjs
npm run build:android:web
npm run build
git diff --check
```

## 最终密度、输入留白与路线焦点证据

### 结果与根因

真实天地图公开小区查询返回11条。之前顶部实际列表仅63.52px，而第一行66.25px；记录中的“少”主要来自标题、始终显示的筛选与署名占据浮窗，而非把11条只取了1条。顶部与路线入口现在在390×857/360×780默认完整显示3条，主动展开完整显示6条，全11条可真实滚动访问；390×480路线默认受锚点两侧空间限制为2条，点击展开可完整显示6条。

用户本轮明确允许展开/收起并说明不要把200px当硬限制：默认最大205px，主动展开最大340px，只适用于搜索结果浏览；其他地图操作浮窗规则没有修改。外宽240px，主选择区44px，固定标题32px、底栏28px，来源/已载数量/加载更多位于滚动区外。筛选按需展开，完整名称、地址、精度、坐标系与分享通过详情可达。地图中心距离不标成真实GPS距离，未知精度仍提示核对。


### 主审复核与修正

1. 初版默认2完整/3局部，继续调整标题/底栏后达到默认3完整、展开6完整。数量含义明确为“已载”，不冒充全国总匹配数。
2. 新增展开按钮后，旧 `suggestions.css` 的 `span:first-child {flex:0 0 auto}` 优先级更高，挤出顶部关闭键，实际closeInset=-21.72px。仅提高搜索title局部selector优先级，允许省略重复标题信息，最终关闭距外框9px、标题11px。
3. 360窄屏展开遮挡右控件；390×480的工具dock又改为两列。读取实际 `.home-map-actions` 与 `.home-position-dock` 宿主rect、按最靠左边界预留8px，修复再次出现的遮挡。未改工具布局；其他搜索owner和桌面定位保持。
4. 路线选终点后若起点为空，原有effect会自动聚焦起点。实际activeLabel=起点、新标题为起点、新结果0条、终点保留“东原晴天见”；不是旧终点结果残留。Esc可关闭新起点提示，保留此有用流程。

### 三尺寸实际测量

|入口/尺寸/状态|外框高|列表高|完整行|含局部行|已载|
|---|---:|---:|---:|---:|---:|
|place-390x857-compact|205px|139px|3|4|11|
|place-390x857-expanded|340px|274px|6|7|11|
|place-360x780-compact|205px|139px|3|4|11|
|place-360x780-expanded|340px|274px|6|7|11|
|place-390x480-compact|205px|139px|3|4|11|
|place-390x480-expanded|340px|274px|6|7|11|
|route-390x857-compact|205px|139px|3|4|11|
|route-390x857-expanded|340px|274px|6|7|11|
|route-360x780-compact|205px|139px|3|4|11|
|route-360x780-expanded|340px|274px|6|7|11|
|route-390x480-compact|188px|122px|2|3|11|
|route-390x480-expanded|340px|274px|6|7|11|



## 文件与不受影响范围

修改 `modules/controls/PlaceSearch.tsx`、`modules/navigation/RoutePanel.tsx`、`provider.ts`、`types.ts`、`tiandituSearch.ts`，以及共享 `modules/input/FloatingSearch.tsx`、`floatingGeometry.ts`。

新增导航搜索模块：`placeSearch.ts`、`placeSearchTransport.ts`、`placeSearchHelpers.ts`、`photonSearch.ts`、`tiandituGeocoder.ts`、`tiandituSuggestions.ts`、`usePlaceSearch.ts`、`SearchOptions.tsx`、`SearchFeedback.tsx`、`searchResultOrder.ts`、`search.css`。新增pipeline、hook、排序与真实React组件测试；更新天地图和视口测试。最终密度补充改动仅为PlaceSearch、RoutePanel、SearchFeedback、search.css与FloatingSearch，服务请求预算保持。新增服务/hook模块均不超过200行，旧导出接口保留。

没有改变导航路径计算、GPS跟随、记录/画线/标记存储、收藏导入导出、CAD/行业、天气、底图服务、版本号、签名或原生桥接。底图异常只做独立诊断，未借搜索任务改写高程代理。

## 限制与后续决定

- 现有来源覆盖、排序和服务可用性有限；Photon是公共演示服务，有合理使用约束，未保证所有国内门牌或全球地址可查。未实际触发失效Key或限流，负控使用模拟响应。
- 天地图官方文档未明确结果坐标datum，本轮不赋予未经核实的WGS84标记；Photon标为WGS84。没有新增GCJ/BD来源或把它们直接当作WGS84。
- 先前远程高程经代理出现部分502；本轮实际搜索截图使用2D内置矢量，不以此宣称3D高程问题已修复。
- 当前本地成果可审查。若要更全面的地址覆盖或接入高德/百度等，需先明确真实账号授权、坐标适配、许可与费用；本轮没有开账号、创建/扩大凭证授权或引入付费服务。
- 本轮已获指定源码分支同步授权；APK/EXE交付、Release发布或合并其他分支仍需单独授权。环境断连期间的“最终验收未完成”已由本记录更新，历史证据保留。

官方依据：[天地图搜索](https://lbs.tianditu.gov.cn/server/search2.html)、[正向地址编码](https://lbs.tianditu.gov.cn/server/geocodinginterface.html)、[Photon API](https://github.com/komoot/photon/blob/master/docs/api-v1.md)、[Photon公共服务说明](https://github.com/komoot/photon#demo-server)。协议核查采用当轮官方页面，未引用第三方文章。



## 本次GitHub同步边界

同步目标为 `Siger1989/map` 的 `codex/place-address-search-20261011`，实际远端提交SHA由主agent在推送后核对并提供。原工程保持原分支与数据，不合main，不打包、不发布Release，不改变认证权限。

旧基线已经在远端且历史曾跟踪本机环境文件和测试签名钥库。本次只在新分支取消 `.env.local` 与 `mobile/.build/guanyun-test.jks` 的跟踪，本机文件保留；没有改写已有历史或轮换凭据。公开提交不加入私有Key/图源种子、签名文件、个人用户数据、依赖、profile或运行日志。W697需保留并核验其已有本机私有配置；拉取源码不等于APK更新或预览已对齐。

完整跨设备步骤见 [W697接续](search-github-handoff-20261012.md)。最终源文件和测试hash见 `qa/search-density-20261012/evidence.json`，此轮未重新施工工程代码。该提交的CI结果由推送后读取GitHub实际状态确认，不把本地验证当作远端CI。
