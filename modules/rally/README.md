# 拉力风格导航视图

- 入口：`RallyNavigation.tsx`。通过 props 接收 PlannedRoute、GuidanceState、PositionFix 与地图/导航动作；不读写收藏或记录存储。
- 上部连续提示、速度/时间；下部复用主 MapLibre 地图，CSS 分区而非创建第二张地图。进入时通过 onOverview 适配路线范围。
- `roadbook.ts` 负责下一指令距离、方向图标分类、连续定位速度估算；不从路线弯曲猜测赛事弯道等级。
- `RallyElevation.tsx` 复用地形高程模块和 RouteElevationProfile；定位无效时不画当前位置、不显示当前海拔及已行升降。
- `rally.css` 只作用于拉力模式。打开底部其他面板或退出时恢复普通地图。
- FIA 比赛 Road Book 与领航员实地勘路笔记并非此视图。这是地图导航提示，未实现/认证赛事标准；参考 FIA 2026 WRC Sporting Regulations Appendix II §5：https://api.fia.com/system/files/documents/wrc_2026_sr_version_13_january_2026.pdf
- 接入段用位置图标并注明方向待核实；未知方向用问号。不得用泛用曲线路线图标暗示连续转弯，也不得把示意图中的左/右急弯移植成实际指令。
- 限制：当前测试路线只有出发和道路出口信息；没有实地勘路笔记、弯道等级或语音播报。速度为连续定位估算，均速含停留，断点时不显示；剩余时间按规划时长比例估算。真机定位与导航跟随仍待验收。

- 2026-09-21后续：速度/时间统一由guidance/useNavigationTelemetry提供，NavigationTelemetry将同一数据和RallyElevation接入普通导航。routeDisplay剖面支持compact尺寸，原调用默认不变。常用功能色见rally.css中data-kind，未知方向保持灰色问号。普通导航进度带仍使用RouteWeatherRail的原路线天气预览接口，不更改导航进度。

- NavigationElevationDisplay通过公开props传入profile/statistics/legend偏好、地图路线mode与scale。三个开关分别控制曲线、右侧数据和地图路线色标，全关隐藏底栏；不改变原route-display存储格式。统计列在64px底栏全高居中。普通导航收起只一行、遥测在展开时显示。
