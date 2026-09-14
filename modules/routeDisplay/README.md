# 地图路线显示

入口useRouteDisplay与RouteDisplayControl。输入既有TrackOverlay/RouteOverlay，输出只供渲染的副本；不修改原轨迹几何、逐点时间、海拔、暂停段和收藏。PositionDock通过MapActions插槽组合控件，位置逻辑仍在position。

preferences独立持久化显示开关。海拔色阶共用routeAnalysis/elevationColors；无实测海拔时仅对选中路线调用既有DEM采样器（192点/三并发/24瓦片缓存），请求可取消。缺测/断段不插补。统计/剖面/陡坡/坐标分别可选，缺测灰色，估算明确标注。

RouteWarnings只管理自己的MapLibre源和两图层；采样陡坡提示不是危险识别服务。测量/勘探/编辑时暂停派生显示。回滚可恢复页面原overlay传参并移除控件插槽，存储格式不受影响。
