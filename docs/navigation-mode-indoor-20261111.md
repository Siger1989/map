> 后续交付：用户同日明确要求打包，已转入0.2.201-test/code208私人测试版；结果以[201交付记录](release-0.2.201.md)为准。以下“未打包”保留为预览阶段历史。

# 导航方式一级直选与室内规划定位 · 2026-11-11

当前源码基于私人200/code207。用户反馈汽车/步行不应藏在二级、二级尽量一屏显示，随后报告“请等待有效定位后重新规划”并询问起点/终点两操作。此轮是源码和预览修改，未升版、打包、安装、提交或推送。已交付200不包含本轮修改。

## 已改

- RouteResultSummary/routeResultSummary.css：一级直接显示驾车、摩托车（离线）、骑行、步行；选中黄绿，规划中不可重复切换，沿用原setMode求路契约。更多改三列操作网格，颜色/粗细占末行两格；路线详情替换操作网格，逐级返回。普通操作约181px；详情按可用视口展开，不再硬锁200px而迫使滚动。矮屏和展开长篇来源说明保留真实滚动，不裁内容。
- GuidanceCard：把两操作命名为“先去路线起点”和“从当前位置重算”，说明后者保留未到途经点与终点；前者只在出发接起点时出现，重试原连接流程。返回原路线允许合规规划位置，不再单靠quality禁用。
- 新增 position/planningFix：真实设备定位（排除IP），30秒内、精度<=1000米，可作规划起点；合法坐标、时间及精度均检查。异步完成再次核验当前位置新鲜、来源、移动距离和请求状态。
- guidance session/reroute/useGuidance/networkSession：手动重算/返回/接起点允许估算；自动偏航重算及精确行进仍需可靠GPS（20秒/50米）。粗定位不更新进度、里程、到达/偏航确认和可信运动状态；GPS恢复继续。手动请求不被自动effect取消；取消/换路线/前后台、旧响应与错误保留有针对性检查。网络无位置不制造位置，精度不足明确原因。
- navigation useSearchQuickNavigation/useNavigation/RoutePanel、workbench useGuidanceWorkflow、app当前位置回调：统一规划门槛，异步无效结果保留原路线和表单；估算来源/精度在结果页保留，绑定实际采用的起点或成功路线，不用后来的GPS倒写旧起点精度。
- 原始起点/原路线、未到途经点保留；原生定位订阅、地图引擎、天地图/39种子、照片和收藏格式未改。未操作真机或个人记录数据；已有暂停记录不变。

## 验证

47项定向测试PASS：guidance、guidance-reroute、guidance-reroute-hook、search-quick-navigation-hook、search-quick-route、navigation-card、forward-navigation-ui。最终非增量TSC PASS；私人native-hybrid网页构建19.44秒PASS；diff-check PASS。日志在本机 .openai/navigation-indoor-20261111-{final-tests,tsc,web}.log。

实际浏览器用已有“验证手绘路线”：390/360宽一级、更多、默认海拔详情与返回已检查；更多 client/scroll=92/92，详情378/378，无内容滚动。一级选中颜色 rgb(208,247,107) 对未选 rgb(242,245,237)。截图与computed记录 artifacts/screenshots/navigation-first-level-20261111/。估算提示新增分支用组件/异步hook测试，浏览器没有真实系统网络定位，未伪造真实GPS。手机原生触控、室内网络定位获取、后台恢复、真实GPS交接仍未验证。

不能保证所有室内环境都能取得位置；修正的是已有系统网络位置被规划入口无条件拒绝。缺设备位置、只有IP、过期或精度超1公里仍不能作为设备起点，可手动选点。当前未生成新APK。
