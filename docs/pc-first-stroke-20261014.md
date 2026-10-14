# PC 首笔落点停顿修复（2026-10-14）

## 范围和根因

用户确认停顿发生在落下第一笔时。本轮活动目录 `.openai/worktrees/place-address-search-48c80e0`，分支 `codex/place-address-search-20261011`，基线 `99978244`；延续快速预览，不出新安装包或上传源码。

真实桌面 shell + Home 组件、1366×900、已注册天地图影像和 3D 地形下，采用现有存档的内存副本（9条线、887顶点）复现。鼠标按下 DrawingSession 为1.1ms；松手到下一帧287ms，出现286ms长任务。首个点触发 `continueAtVisibleTrack → pickTrackContinuation → pickLinePoint`，所有非隐藏保存线逐边投影，屏外线路也进入精算；观察窗口内 project 1753次、累计262.9ms。放大镜和首笔吸附不是该场景的主要停顿来源。

## 实现

- `modules/tracks/TrackLayer.ts`：新增局部续画命中方法，先向 MapLibre 查询落点周围12 CSS px的已渲染线路，去重ID，再按存档原顺序精算；隐藏线、草稿、实时记录排除。空命中或图层未就绪不全量回扫，继续正常落新点。精算保留原始坐标/链距和地形投影，并复用现有地形投影作用域。
- `modules/map/TerrainMap.tsx`：通过 MapHandle 暴露续画查询。
- `app/page.tsx`：空草稿首点改用地图查询，确认命中仍在已保存列表后沿用原续画逻辑。
- `tests/track-continuation.test.mjs`：补充大量远线/空命中零投影、重复ID、隐藏/实时/草稿过滤、重叠顺序、链距、图层暂不可用等回归。

没有修改吸附、放大镜、样式、原存档格式或导航功能；此前未提交的导航和灰色已走路线改动保留。新增本记录，无删除源文件。

## 验证

| 项目 | 结果与证据 |
| --- | --- |
| 同场景首点性能 | PASS：松手到下一帧287→25.3ms；观察窗口project 1753→5，续画查询本身1.6ms，未出现原286ms长任务 |
| 3D已有线续画 | PASS：临时跨屏长线中段被正确识别，原3点线转为4点含分支草稿；续画查询3ms，下一帧26.6ms |
| 2D已有线续画 | PASS：pitch0/terrain关闭下仍命中同一临时跨屏长线，续画查询0.7ms，下一帧29.1ms |
| 后续点、撤销和完成 | PASS：真实浏览器点击第二点累计590m，撤销回0m；完成进入所选路线详情；测试保存只在内存 |
| 定向逻辑 | PASS：31项（续画11项，线点/地形投影/绘制提交交接/绘制长度20项） |
| 类型和资源构建 | PASS：tsc；私有PC地图运行资源构建至 `.openai/pc-draw-init-20261014/desktop-runtime`，1926网页文件、39图源种子、Key存在性和种子一致性通过 |
| 安装包和设备 | 未验证：现有APK125/EXE124未重打包或替换；浏览器数据不等同PC原生EXE/真机性能验收 |

截图和JSON：`artifacts/screenshots/pc-draw-init-20261014/`（before/after-timings、before/after-first-point、near-line-3d/2d）。诊断夹具 `.openai/pc-draw-init-20261014/` 用副本 localStorage，并将全部写入限制在该页面内存；测试线不会进入用户存档。按住0.8秒的首点为夹具发出的鼠标事件，经过实际 MapLibre → DrawingGestureBridge → TrackDrawing；第二点和撤销/完成为浏览器真实点击。

性能数字为上述单个固定相机/存档场景的前后实测，不是普遍帧率保证。若后续仍报告停顿，按实际长线路、相机和地形重新检查命中后的精算耗时；本轮没有把可能相交的跨屏线按端点距离排除，也没有重写通用线条选择功能。下一步由用户体验预览；明确转交付时再用相同私有配置生成新APK/EXE。
