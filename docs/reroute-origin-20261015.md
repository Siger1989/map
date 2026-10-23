# 重规划原始起点与锁定速度卡

2026-10-15，用户129真机反馈，当前分支 codex/place-address-search-20261011，基线40dc00a；本轮为快速修复预览，无新APK/EXE。

## 根因与修改

- app/page.tsx 地图起点读取 session.route.stops[0]，重规划后它是“当前位置”。会话 originalRoute 并未丢失。新增 modules/guidance/routeStart.ts，仅从原路线/原规划起点选择标记；终点、剩余途经点、求路起点和导航几何保持现有语义。原始路线与存档不被改写。
- homeMap.css 的 navigation-live-strip 外框已经使用 ui-surface，但内部 telemetry.css 紧凑速度面板又画了一层 ui-raised 灰底和边框。加入只针对锁定宿主的内部透明变量，保留普通导航卡默认外观；实时值使用 ui-accent。

## 定向验收

|状态|结果|证据|
|---|---|---|
|自动重规划成功，求路从最新GPS开始、标记保持原起点|PASS|guidance-reroute-hook.test.mjs|
|连续两次手动重规划，原起点/终点/原数据保持|PASS|同上|
|旧路线没有stops，保留原规划起点或原几何首点|PASS|同上|
|390×857模拟重规划后的地图原起点可见|PASS|artifacts/screenshots/reroute-origin-20261015/origin-390.png|
|390×857和360×780锁定速度卡|PASS|locked-speed-390.png、locked-speed-360.png；实际宽239.99高37.94，外底rgb(24,32,31)，内底/边框透明，内宽236=scrollWidth，实时rgb(208,247,107)，外圆角8px|
|锁定/解锁恢复普通导航卡|PASS|两种尺寸实际点击|
|360缺定位文字|PASS|locked-waiting-360.png，等待定位完整无省略溢出|

19项定向测试通过（重规划Hook/逻辑、定位端点、速度、导航卡），TypeScript和diff检查通过。

手机安装、真实GPS连续重规划未验证。模拟页面明确标识非真实GPS；未清空用户数据。私有天地图预览配置保留。APK129/PC128未更新，本轮未提交推送。
