# 卫星缺口兜底与隐藏UI回归 — 2026-10-01

本轮仍为9174私有APK配置源码预览，未升版本、构建APK、提交或推送。目标包基线0.2.96/code103不含本轮修改。

## 卫星兜底

用户截图蓝块对应background的#203b3f；自定义源会关闭原内置影像，目标瓦片未到便露出纯色。新增satellite-underlay源/层，位于所有主影像及业务图层之下；卫星或自定义图源开启，普通地图模式关闭。使用全球统一WebMercator XYZ概览，未改变主图级别、坐标修正或清晰度。

public/basemaps/satellite-overview-v1提供z0–5完整1365项，合计7988437字节。scripts/bundle-satellite-underlay.mjs限4并发构建固定概览，并跳过已有文件；运行时仅读本地资源，不从外网取兜底瓦片。初版z0–3在8级太模糊，最终扩展z5。近景仍会模糊，概览只为填空，主图到齐才是目标细节完成。

来源沿用项目已有[EOX Sentinel-2 2025](https://maps.eox.at/)，保持原始JPEG及上游少量极区PNG字节，SOURCE.json记录来源、投影、署名、CC BY-NC-SA 4.0和逐文件SHA256。适用于当前非商业原型；没有据此宣称商业发布权已经解决。数据随public进入未来Web/APK资源，打包留待用户要求效果达标。

真实QA：tests/satellite-underlay-browser.html在100E/35N、8级/60度，主影像关闭时本地兜底64ms就绪、2个本地请求、0外网兜底请求、0错误；点击高清影像后看到更清晰影像完整覆盖，错误0。该计时是源就绪而非整屏地形完成。截图underlay-before/underlay-after/underlay-detail-ready.png位于artifacts/screenshots/loading-reuse-20261001。证据.openai/satellite-underlay-browser.json。

独立完整首页预览中satellite-underlay可见、位于detail/sentinel以下，tilesLoaded=true、contextLost=false、sourceErrors为空。用户原标签状态/截图读取超时，未强刷或重设用户相机；该标签视觉效果不作为通过证据。

## 隐藏UI

旧taskControlsActive复用了follow.blocked。useManualTracks.pause只setDrawing(false)，会保留editing=true和草稿；绘制工具因此关闭，但follow.blocked仍true，入口永久被挡。独立浏览器通过画线→工具（暂停绘制）→关闭菜单复现对应状态，修后隐藏UI恢复，而跟随按钮仍按原规则提示编辑中暂停，证明显隐已与跟随限制分离。

新增modules/controls/focusLockVisibility.ts，page显式传入当前面板和实际任务；不再输入tracks.editing/follow.blocked/孤立routeChild。区域编辑要求当前区域存在，rally要求路线存在，记录finished面板已关闭时恢复入口。已锁定优先显示解锁。DOM的data-focus-lock-blockers仅输出活动名称，无坐标、数据ID或私有内容。

用户要求的显隐矩阵与强制退出路径已写入AGENTS.md、docs/ui-standard.md、docs/ui-quality-gate.md。新增阻塞条件须有实际可见任务、入口和退出恢复检查；不得以清草稿、刷新或清存储补救。

## 验证

| 状态 | 390×857 | 360×780 |
|---|---|---|
| 普通浏览 | 入口可见 | 入口可见 |
| 画线→工具暂停→关闭 | 任务/菜单中0个入口，关闭后恢复 | 任务/菜单中0个入口，关闭后恢复 |
| 锁定→解锁 | 解锁入口保留，点击恢复 | 解锁入口保留，点击恢复 |
| 测量关闭 | 测量中0，关闭后1 | 测量中0，关闭后1 |
| 框选退出 | 框选中0，退出后1 | 框选中0，退出后1 |

360入口computed为display:flex/visibility:visible，x约8/y约560/宽高44；390对应x约8/y约637/宽高44，均处于视口内且不遮底栏。截图hide-ui-restored-390.png、hide-ui-restored-360.png。所有验证未添加路线坐标或保存/删除用户对象，保留原测量草稿。

定向检查8/8：focus-lock-visibility（逐任务/面板关闭、解锁优先、page绑定禁止旧条件）、satellite-underlay（完整全球坐标及哈希/本地地址/显隐）、sentinel-provider。Android、GPS/导航/记录真机表现未验证，连续高清/奥维对照仍非本轮完成项。
