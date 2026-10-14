> 127最终交付追加：用户取消底部行程摘要，提示仅第一人称且缩小；普通导航默认俯视。本文前轮快速预览状态及“保留摘要”不代表最终127。详见[127交付记录](release-0.2.127.md)。

# 第一人称导航、旁侧位置接入与搜索简化 · 2026-10-14

活动源码：`.openai/worktrees/place-address-search-48c80e0`，分支 `codex/place-address-search-20261011`，HEAD `99978244f44d8a9b3dc81f8dfe524793dc7645a3` 加未提交改动。快速视觉阶段：未升版、出安装包、提交或推送。原APK125/code132、EXE124保持；两者未包含本轮修改。原私有Key和内置天地图保留，真实存档未读写或清空。

## 实现

- `GuidanceCard.tsx`、`guidance.css`、`outdoorSurfaces.css`：仅前视采用蓝色转向卡、44px距离（矮屏36px）、实际行程摘要。俯视保持普通卡。摘要只根据现有行程估算，不造速度、交通和车道信息。
- `PositionLayer.ts`、`TerrainMap.tsx`、`forwardCamera.ts`：前视白蓝定位圆盘，俯视原定位图标；前视避让摘要且为圆盘保留32px空间。缩放手机框的DOM屏幕坐标换算到地图CSS坐标，模式切换在新卡片渲染后测量避让。
- `navigationCueGeometry.ts`、`NavigationCueLayer.ts`、`overlayData.ts`：删除用户拒绝的宽Polygon边带，保留单条近景绿带14/18px。旁侧位置超过max(12m, accuracy+5m)、不超过100m时，32采样曲线接到原路线前方最多12m；黄线与绿线同轮廓（前视14/18px，俯视4/8px），末端与路线方向相切。俯视也显示黄线，不显示近景绿带和大型指引。道路线位于地名下，定位图标在上。
- `app/page.tsx`：黄色接入进度只用于RouteOverlay显示；绿线从同一接入点开始，后面原路线变灰。真实session.progress、里程、保存几何不变。已确认偏航仍沿用原接回规划；黄色明确注明仅作方向参考，无法据此识别实际辅道或生成可行驶道路。
- `useNavigation.ts`、新增 `useSearchQuickNavigation.ts`、`RoutePanel.tsx`：搜索选点“去这里”自动保留原出行方式/起点/途经点并规划，随后显示“开始导航”。缺起点时等待可信当前位置，或手动补起点后自动规划；不把IP定位冒充GPS。取消/换点后旧定位回调不复活请求。
- `NearbyMarker.ts`：双指缩放/旋转期间保留已挂载标记至硬30km范围，普通单指拖动及手势结束恢复正常附近范围。新近处标记仍能出现，远处不挂载；DEM重复setLngLat不绕过保留范围。不改变遮挡透明度和地形逻辑。

## 证据与限制

导航截图位于 `artifacts/screenshots/nav-first-person-20261014/`，最终文件以 `final-` 开头；旧截图包含已经拒绝的中间效果，不能作为最终验收。参考图与实际前视截图同轮并列复核：黄色接入与绿带一致、接入后方灰化、无额外绿色宽边。390×857/360×780/390×480测computed；手机框禁止全屏。模拟位置和路线明确标记，不调用真实GPS或存档。

搜索独立命名空间预览的实际天地图搜索截图：`artifacts/screenshots/search-nav-20261014/05-new-waiting-real-position.png`、`06-auto-planned-summary.png`、`07-go-here-direct-summary.png`。浏览器不允许真实GPS，显示等待；手动补春熙路起点后天府广场步行自动规划1.7km并出现开始导航；重复“去这里”直接自动规划。真实可信GPS自动起点由挂载hook测试覆盖，Android真机待验收。

标记夹具使用真实MapLibre触控处理器、真实标记图标和NearbyMarker，合成TouchEvent与位置：范围由292m缩至约187m，260m边界图标DOM始终add1/remove0；40km图标add0。普通平移离开后近点/边界各remove1。`final-marker-stability.png`及`marker-gesture-evidence.txt`记录本轮计数。无地形的合成浏览器手势无法验收Android实机闪动或地形遮挡。

64项定向测试、TypeScript与Android网页资源构建PASS（日志 `.openai/nav-first-person-20261014/final-*`）；这是网页资源构建，不是APK。独立API开发服务有请求超时/Cloudflare开发错误，后端完整能力未恢复验收；本轮实际搜索与路线网页调用成功。原生GPS、锁屏恢复、后台记录、分享、Android/PC真机和鸿蒙未验证。未重跑完整记录/绘制显隐矩阵。

## 再次测试条件

改接入曲线、进度分段、相机避让、地图frame缩放或图层排序后，复测前视/俯视旁侧20m、回到规划线、定位中断恢复、已确认偏航、终点与停止；接入点和绿灰边界必须相同，真实进度不跳变。改NearbyMarker范围/DEM更新/手势监听后，复测边界重复缩放旋转、相同坐标更新、新近点加入、普通离开及监听清理。改搜索定位回调后，复测缺起点、现有起点/途经点/方式、换目的地、关闭与取消。
