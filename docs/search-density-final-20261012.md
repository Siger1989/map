> 本文件保留本地验收阶段记录；本轮用户已另行授权指定搜索分支同步。实际推送SHA与CI以交付核验为准，完整报告见 [搜索审查](place-address-search-20261012.md)。

# 搜索密度与输入留白最终本地成果 · 2026-10-12

继续原隔离工作区、分支 `codex/place-address-search-20261011`，基线 `1947a6f0efa641928267cb85e01fa1f0f483ec16`。本轮以用户“显示的条目太少”和顶部输入标注为范围；服务优化的既有事实及限制见 [地点/地址搜索报告](place-address-search-20261012.md)。本轮不改变服务请求预算。未合入原D盘、未提交/推送、未升版本、未生成或安装APK/EXE。

## 结果与根因

真实天地图公开小区查询返回11条。之前顶部实际列表仅63.52px，而第一行66.25px；记录中的“少”主要来自标题、始终显示的筛选与署名占据浮窗，而非把11条只取了1条。顶部与路线入口现在在390×857/360×780默认完整显示3条，主动展开完整显示6条，全11条可真实滚动访问；390×480路线默认受锚点两侧空间限制为2条，点击展开可完整显示6条。

用户本轮明确允许展开/收起并说明不要把200px当硬限制：默认最大205px，主动展开最大340px，只适用于搜索结果浏览；其他地图操作浮窗规则没有修改。外宽240px，主选择区44px，固定标题32px、底栏28px，来源/已载数量/加载更多位于滚动区外。筛选按需展开，完整名称、地址、精度、坐标系与分享通过详情可达。地图中心距离不标成真实GPS距离，未知精度仍提示核对。


## 主审复核与修正

1. 初版默认2完整/3局部，继续调整标题/底栏后达到默认3完整、展开6完整。数量含义明确为“已载”，不冒充全国总匹配数。
2. 新增展开按钮后，旧 `suggestions.css` 的 `span:first-child {flex:0 0 auto}` 优先级更高，挤出顶部关闭键，实际closeInset=-21.72px。仅提高搜索title局部selector优先级，允许省略重复标题信息，最终关闭距外框9px、标题11px。
3. 360窄屏展开遮挡右控件；390×480的工具dock又改为两列。读取实际 `.home-map-actions` 与 `.home-position-dock` 宿主rect、按最靠左边界预留8px，修复再次出现的遮挡。未改工具布局；其他搜索owner和桌面定位保持。
4. 路线选终点后若起点为空，原有effect会自动聚焦起点。实际activeLabel=起点、新标题为起点、新结果0条、终点保留“东原晴天见”；不是旧终点结果残留。Esc可关闭新起点提示，保留此有用流程。

## 三尺寸实际测量

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


## 验证门禁

|检查|结果与范围|
|---|---|
|定向单元/集成与实际React组件|41/41 PASS；服务边界、取消/乱序、门牌/跨城/错误、hook单飞分页、展开复位与筛选/结果保留|
|实际API与浏览器|55/55 PASS；仅公开小区查询，HTTP200/count11/returned11，附近queryType2/start0/count20；路线复用缓存；三尺寸选项、几何、44px、输入、滚动、焦点与关闭|
|模拟分页的真实浏览器UI|18/18 PASS；两入口20→35，固定更多无需滚到底；忙时禁用、连续点击只追加1个start20/count20请求，耗尽后不显示更多；无真实API请求|
|全部右侧工具命中与交叠|3/3尺寸 PASS，每尺寸9个可见按钮中心命中、与展开卡无交叠；此补充使用模拟公开结果，不调用GPS|
|TypeScript/搜索范围lint|PASS；RoutePanel整文件仍10项既有FAIL，详见日志，不声明全项目lint通过|
|最终Web/手机Web构建|PASS；CAD浏览器node:module、动态import及大chunk等既有警告保留；没有生成安装包|
|原生/真机/完整隐藏UI矩阵|未验证；浏览器缩小高度不等于真实软键盘、GPS、触控、后台、系统分享验收|

运行日志留在 `.openai/search-density-*-final.log`，不纳入审查patch。当前证据 `qa/search-density-20261012/evidence.json` 明确区分实际API与模拟请求，保存最终源文件hash；此前密度中间记录仅为历史。

## 修改与审查位置

本轮源码为 `modules/controls/PlaceSearch.tsx`、`modules/navigation/RoutePanel.tsx`、`modules/navigation/SearchFeedback.tsx`、`modules/navigation/search.css`、`modules/input/FloatingSearch.tsx`；新增/扩展 `tests/search-ui-components.test.mjs`。没有删除功能或数据。服务/provider、地图图源Key、保存格式、定位/记录/户外地名能力没有本轮额外修改。


预览仍为用户已有Key的私有apk-preview，端口9174，API独立3108；右侧手机框 `http://127.0.0.1:9174/phone-preview.html`。预览不自动更新已安装应用。原目标0.2.120-test/code127的APK/EXE不含隔离搜索改动，未重新核验手机已安装版本；不把安装包作为本次测试证据。
