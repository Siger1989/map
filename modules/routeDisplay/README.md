# 地图路线显示

0.2.35陡坡标记修正：`warningMarkers.ts`接收轨迹分段与既有`RouteMetrics.slopes`，返回`RouteWarning[]`，不持有业务状态、不读取存储。取消最前12处截断，每段上坡/下坡分别提示，跨缺测或分段不合并；长连续坡按约200米窗口选代表峰值。`config.ts`集中设置间距与极长单段的512处预算；超过预算时全段均匀分布，不丢后半段。阈值继续使用routeAnalysis/config的20%（约11.3°），与路线色带/所选点的派生坡度一致。

所有标记圆点进入地图，远景文字使用MapLibre避让，放大可看分散标签；不再通过丢弃后面的提示控制密度。长坡重复标记次数不等于详情中连续50米窗口统计的段数。回滚只需将useRouteDisplay改回旧标记生成、恢复文字布局设置；没有数据/偏好迁移。

入口useRouteDisplay与RouteDisplayControl。输入既有TrackOverlay/RouteOverlay，输出只供渲染的副本；不修改原轨迹几何、逐点时间、海拔、暂停段和收藏。PositionDock通过MapActions插槽组合控件，位置逻辑仍在position。

preferences独立持久化显示开关。海拔色阶共用routeAnalysis/elevationColors；无实测海拔时仅对选中路线调用既有DEM采样器（目标192点，每个独立段保留端点；三并发/24瓦片缓存），请求可取消。缺测/断段不插补。统计/剖面/陡坡/坐标分别可选，缺测灰色，估算明确标注。

RouteWarnings只管理自己的MapLibre源和两图层；采样陡坡提示不是危险识别服务。测量/勘探/编辑时隐藏信息浮框和提示点，路线颜色与显示设置继续生效。回滚可恢复页面原overlay传参并移除控件插槽，存储格式不受影响。

0.2.30候选列表包含当前绘制草稿；选中路线通过TrackOverlay.analysisParts传递显示专用色线，saved/draft原几何与samples不替换，避免派生高程改变节点拾取和吸附对象识别。规划路线继续使用RouteOverlay.displayParts，接驳虚线保持独立。海拔色阶范围和剖面使用同一profile；速度只使用原逐点时间。
