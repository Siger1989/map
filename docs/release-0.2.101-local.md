# 0.2.101 私有测试 APK：分叉松手后的连线交接

0.2.100交付后，用户反馈分叉拖动松手仍有停顿，新线没有立刻显示。本轮围绕松手提交到正式轨迹显示处理，保持原签名、包名、图源和用户存储标识，继续私有 APK 复测交付；没有独立核验用户手机当前安装版本。

## 定位与修改

松手路径不存在人为延时；DrawingGestureBridge 先同步处理最后一次待处理 move，再提交 end。DrawingSession 返回已确定的地理端点，TrackDrawing 原先随即清掉 SVG 预览，正式线还需经历 React 更新和 MapLibre worker/瓦片渲染，存在视觉交接空档。此外，每落一个分叉点都会重新对未变化的主线做地图投影。

- `TrackDrawing`、`app/page.tsx`、`TerrainMap` 与新增 `trackRenderHandoff.ts`：只对成功接受的分叉提交保留真实端点/section 的 SVG 实线，两图分别投影。等待已同步的同一份 geometry 到达轨迹源且发生 render 后，分别移除临时线。连续松手合并待交接线；旧回调不能误删新线；撤销/退出/移动/resize/卸载清理，错误路径最多保留2秒。没有等待网络后才接受坐标，也没有伪造保存结果。
- 新增 `SegmentHandleCache.ts`，TrackLayer 按每个地图的投影 epoch 与不可变 segment 身份缓存采样。分叉只重算发生变化的段，24px显示间距、显式节点、端点顺序与全部原始几何保持。视角/DEM/尺寸变化或地图移动时失效，不使用旧视角投影。
- `selectionDetails.ts`：空选择不扫描整条路线；没有边颜色数组时跳过逐边颜色循环，点详情颜色仍应用。

## 证据

139/139定向测试和 `tsc --noEmit --incremental false` PASS，包括真实 TrackDrawing React DOM/ref 与两图 worker 交接、过期回调、撤销、退出、连续提交、地图取消/超时，以及250组随机segment与原nodeHandles对照。日志 `.openai/branch-release-final-{tests,tsc}.log`。

5800点原线、双图20次追加的计数地图基准：投影调用 **232380→420**（约减少99.82%），提交字节659314/线顶点460不变；5轮中位图层同步+序列化 **442.00→402.76ms**。这是20次双图更新总计，且投影为Node mock函数，不是一次手势延迟或Android帧率。脚本/结果 `.openai/branch-segment-handles-bench-20261002.{mjs,json}`。

主agent在独立9291合成存档使用5800点副本实测：390×约857上图分叉815米、撤销0米、移动编辑窗口、下图分叉755米，两图一致；360×780分叉878米，两图一致，退出触发未保存保护、继续编辑、两次撤销再正常退出。交接结束后DOM临时线数量0，360 body/client/scroll宽均360。截图 `artifacts/screenshots/branch-performance-20261002/release-handoff-{390,360}.jpg`。没有将工具操作耗时或截图当作手机逐帧证据。测试草稿已撤销，预览恢复默认390比例；原9174存档保留。

## APK

- `APK/Shantu-0.2.101-test-standalone.apk`，0.2.101-test/code108，包名 `com.guanyun.weather.shantu.preview`。
- 66,081,584字节，SHA256 `fe6d96a55c9d2f7df43ef55ed461d22fd30d72a11b9a255a41e4aa51db2709d6`。
- 最终构建暂存 `mobile/.build/apk-20261002-191436`；完整重新构建网页/Android，日志 `.openai/build-0.2.101-local.log`。
- 独立核验原v2/v3证书、包名/版本、zipalign、CRC、1910资源与暂存匹配、496地形PNG像素、38私有种子、1365概览及预览/production天地图Key一致性PASS；只输出配置布尔值。证书SHA256 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`。
- 报告 `.openai/package-02101-integrity.json`、`.openai/package-02101-config-check.json` 与 `.openai/02101-{aapt,apksigner,zipalign,config}.log`。临时手机链接及整包外网核验见CURRENT_STATE最新顶部。

## 限制与后续

真实Android松手延迟、p95帧间隔、温升、覆盖安装与GPS/后台仍未验证，需同一手机/路线复测。剩余CPU热点包括新geometry的全路线颜色键与替代路线计算，候选快照也仍会随落点变化，本轮没有宣布全软件流畅度已解决。HarmonyOS6.1原生包未交付，既有架构行数预算失败仍单列。

工作目录 `D:\天气地图`，分支 `codex/rollback-ui-0235-20260921`，HEAD仍 `ec47ec0aa5f23cba6dfa2dd576197a82b6f34efe`。所有先前本地工作保留，没有新增提交/推送/合入main或公开含Key的Release。
