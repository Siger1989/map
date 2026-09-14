# 区域离线步行路由

入口 `provider.ts`；`tryOfflineRoute(stops, mode, signal, preference?)` 返回 PlannedRoute 或在自动模式返回 null 交给在线提供器。`offlinePlaces`只搜索已下载包内可选道路点。返航可明确传offline，不改变全局偏好。

`osmGraph`编译公开OSM节点/道路；`engine`校验拓扑和成本并执行可取消A*；`snapping`在真实边上拆分保持方向；`storage`原子保存图与SHA256清单；`download`是可替换Overpass传输；`OfflineRoutingPanel`只编排界面。导航与图层只认识PlannedRoute，不访问路网内部。

当前只支持步行，区域请求最多100km²、单包24MB、60000节点/150000边、8包。条件限制、禁行、未知障碍和高难山径保守排除。不支持驾车/骑行离线转向规则。图上接驳虚线是直线距离，未经通行核验。地图瓦片与路网分别保存，缺一不能互相替代。

数据来源 © OpenStreetMap contributors，ODbL1.0；下载保留署名、时间、范围，导出可跨设备。公开服务可能限流，取消或失败保留旧包，不暗中重试。实地道路状况/锁屏定位仍需真机验收。

回滚：移除navigation/provider的离线分支和OfflinePanel中的路网管理，旧在线路由/轨迹格式仍可用；不清除用户数据库。
