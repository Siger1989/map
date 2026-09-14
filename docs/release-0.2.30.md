# 山兔0.2.30-test：路线颜色与高程采样修正

修复“已有坡度数值，地图颜色仍不变”：编辑状态现在也应用选中的路线着色；缺高程的稀疏路线保留中间DEM采样，海拔模式沿高差渐变。原先两点线只得到一个平均颜色，中间地形起伏也被丢弃。现在分析、剖面、海拔图例与地图使用相同的高程剖面。

在左下角“海拔显示”选择路线和“海拔”或“坡度”；路线详情→速度与坡度分析也可直接切换并回到地图。海拔按本路线最低至最高渐变，坡度按小于10%、10%至20%、20%以上三档着色。同档坡度保持同色，平坦海拔保持同色；缺测灰色。信息图例、统计、剖面和陡坡提示继续独立选择显示。

原始路线坐标、时间和实测高程不变。新增DEM点仅用于显示和坡度分析，没有虚构时间戳；选线、节点、吸附及编辑存档仍使用原数据。拖动期间不用旧的派生线覆盖当前预览。地形估算的来源与缺测提示保留。

本包同时包含0.2.29的左右控件避让、绿色定位/海拔入口和详情DEM接入，及0.2.28的区域离线步行导航、地图缓存、原路返航/返回点、批量导入、照片混排。步行路网和地图包需分别下载；未知奥维坐标系不猜测；队伍实时位置、SOS送达和PTT因没有通信服务暂缓。

## 安装与验证

- Android独立测试包`Shantu-0.2.30-test-standalone.apk`，版本0.2.30-test/code37；包名`com.guanyun.weather.shantu.preview`，沿用原独立测试版证书。
- 457项检查通过（453应用逻辑+4布局模型/实际HTTP保存）、TypeScript和结构检查通过。新增检查实际TrackLayer收到分色几何，同时原始节点拾取、选线里程、拖动预览保持正确；验证中间山峰、缺测/断段、两点渐变、日期变更线和6000边细分预算。
- 最终网页资源与APK构建通过；原证书SHA256以`4a941b9d`开头，v2/v3签名、zipalign、541项ZIP CRC、473项地形资源、新着色JS标识和开发编辑器未混入APK均核对通过。APK为57710867字节，SHA256：`4b265942e1fe32bac3f0b6883478a964f72fb302eb8dc4183226c652b84ccccc`。
- **本轮GUI未完成复验**：Computer Use因无法可靠确认Windows浏览器当前URL而停止。新着色截图、新增快捷入口多尺寸、布局拖动/缩放/保存重开流程待工具恢复；已有0.2.27～0.2.29真实截图不能代替此次GUI验收。Android真机安装、GPS、后台锁屏、触控仍待验收。
- HarmonyOS6.1原生HAP/APP尚未交付，此APK不作为鸿蒙原生包；本轮未更新Windows/Mac安装ZIP。

## 图示与布局窗口

`Shantu-0.2.30-feature-guide.zip`含18项既有功能实际截图和离线可打开的`index.html`，每项保留版本、测试数据与验证范围标注。本轮颜色修正没有新增截图，不以旧图充当新效果。

布局工具已按“先功能包、后布局窗口”的顺序在0.2.28功能打包后实现，独立于APK。`npm run dev:layout`启动后打开`http://127.0.0.1:9241/__layout`；支持组件/单控件位置、尺寸、比例、字号、隐藏、撤销及保存JSON草稿。草稿路径`config/ui-layout-draft.json`，仅预览应用，后续正式UI依据用户草稿统一对齐。目前保留空草稿，没有预填测试布局。最终GUI操作验收仍有上文限制。

## 修改范围与同步

- routeAnalysis新增`terrainProfileTrack.ts`、`elevationLineParts.ts`；更新`metrics.ts`、`useTrackElevation.ts`、`RouteAnalysisSummary.tsx`和README。
- routeDisplay更新`useRouteDisplay.ts`、`RouteDisplayControl.tsx`、README；TrackLayer通过`analysisParts`接口接收显示派生线。
- tracks更新`TrackLayer.ts`、`RouteViews.tsx`，提取`useDockClearance.ts`占位hook；`app/page.tsx`仅组合着色回调。删除编辑状态屏蔽色线的条件和旧内嵌占位hook，未删除用户功能或数据。
- 新增两组回归测试并更新`route-display.test.mjs`；更新版本配置、Android manifest、功能图示说明与CURRENT_STATE。
- 测量/勘探几何、3D精调、地图手势、照片与轨迹存储格式、签名及Logo未更改。回滚可移除`analysisParts`传参与详情回调，不需要存储迁移。
- 源码推送`origin/codex/huawei-webview-touch`（本地`codex/sync-20260910`），不声称已合入main。0.2.29仍保留为未发布草稿，本次发布0.2.30最终包。
