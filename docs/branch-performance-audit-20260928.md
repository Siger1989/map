# 0.2.80 分叉按钮与普通操作对照

用户反馈点分叉仍明显卡顿；本轮只读诊断，不修改生产行为、不生成新APK。

## 确认的执行差异

- 普通画线候选（modules/tracks/useManualTracks.ts:75）：当前草稿候选 + 可见保存路线的端点/显式nodes。分叉（app/page.tsx:1209）取编辑路线及其他可见路线的全部segments坐标；编辑track每变都会重建数组。
- 分叉按钮 toggleEditBranch（modules/tracks/routeEdit.ts:175）新建/移除单点分支，调用inheritTrackDetails、inheritEdgeColors重扫当前路线元数据；历史快照仅引用旧对象，并非全路线深复制。
- composeTrackOverlay（modules/workbench/trackOverlay.ts:40）改变connecting、snapTargets、movableTrackId；TrackLayer.ts:425/452两个局部更新守卫失效，回退全部可见路线features构建和完整序列化。投影缓存仍可复用未变背景，但当前编辑路线新数组需再投影。
- 开节点吸附后，ProjectedSnapGrid（modules/tracks/snapping.ts:93）首次输入逐候选投影；分支锚点变化会清空DrawingSession网格（TrackDrawing.tsx:66），下一次输入可能重复建表。普通画线也用该网格，但候选规模不同。
- 分叉每次track变化还触发选择有效性检查（app/page.tsx:334）扫描编辑路线顶点。道路/河道吸附属于双方可选的额外路径，不是分叉按钮本身联网请求的证据。

## 验证

PASS：桌面i7-12700H / Node25.2.1真实routeEdit→compose→TrackLayer.sync，Map为计数Mock，5次操作中位数：

| 合成场景 | 普通已渲染节点选择 | 开分叉 | 结束空分叉 |
| --- | ---: | ---: | ---: |
| 10条×24坐标 | 0.044ms | 0.830ms | 1.046ms |
| 10条×6000坐标 | 1.893ms | 168.939ms | 173.529ms |

大场景开分叉约15.170ms在编辑函数、153.750ms在TrackLayer同步；每次6000投影、5次stringify累计2,058,768字符、1次主source完整setData。普通选点0投影、1次updateData。结束分叉虽完整重建/序列化，最后快照比较省掉setData。

候选数实算：每条8显式nodes，普通空草稿候选100；分叉在24坐标场景241，在6000坐标场景60,001（保留重复起点）。使用实际endpoints/draftSnapNodes/session函数，不把普通候选与所有几何点混淆。

脚本/结果：.openai/branch-phase-bench.{mjs,json}、branch-candidate-count.{mjs,json}。单次基准约3秒，无生产文件修改。只测同步JS，不含React提交、真实MapLibre worker、WebGL/GPU和OPPO WebView；小场景不足1ms不能解释手机所有明显停顿，仍需真机trace。当前APP全可见路线数量/总坐标数比屏幕上节点数更有意义。

下一步按证据修复：进入/结束分叉只更新必要交互图层；统一候选语义或按视窗/距离筛候选，避免全路线投影且保留既有可吸附行为；当前单点分支开启不重算未变元数据。还未实施，不宣称已解决。
