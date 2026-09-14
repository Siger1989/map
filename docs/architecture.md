# 山兔结构与迭代规则

## 2026-09-14 结论

项目已有按功能分目录的基础，主要负担来自组合层过大、职责混放和过程记录过长。不能据代码行数直接断言运行慢或承诺提速倍数。本轮先处理可验证的重复计算和高频修改入口，保留原数据与稳定几何实现。

```text
app/page.tsx                 页面组合、工具切换（仍有待拆出的历史流程）
  ├─ workbench              跨模块数据组合；不持有业务存档
  ├─ outdoor                记录状态机、采样偏好、平台适配、缓存
  ├─ dataTransfer           格式适配 → 验证 → 预览 → 存档事务 → 导出
  ├─ routeAnalysis          纯分析、颜色/坡度阈值
  ├─ tracks / navigation    手绘编辑 / 道路规划
  ├─ guidance / journey     实地导航 / 里程与沿途信息
  ├─ map                    MapLibre渲染与手势桥
  └─ 其他既有模块           照片、标记、收藏、测量、剖面、地形、天气

Android RecordingService → SamplingPolicy → RecordingStore
页面 → 受限原生桥           平台请求与业务采样分开
```

## 本轮结构变化

1. `outdoor/exchange.ts` 从610非空行收为兼容出口，解析、校验、存储、导出有独立文件。旧消费者和存储键不变。详见 [数据交换接口](../modules/dataTransfer/README.md)。
2. 行程的记录、数据、离线、照片分开；新增功能不会继续堆进 `OutdoorPanel`。临时预览只保存在所属面板，未确认切换标签不会写入数据。
3. `workbench/trackOverlay.ts` 统一编辑来源过滤与实时记录追加，删除两份重复的拼装逻辑。
4. 记录拒绝采样时不复制分段，接受时只复制末段；质量提示变化复用原几何；后台页面停止轮询，原生记录服务继续。没有修改原子落盘时机来换取表面速度。
5. 速度/坡度计算在 `routeAnalysis`，样式选项仅通过 `TrackStyle.colorMode` 传递；地图和分享使用同一纯渲染数据。原始轨迹改线仍另存手绘副本，并退出依赖原始样本的着色。
6. `CURRENT_STATE.md` 只留当前目标、状态、验证与下一步；此前过程原样归档 [0.2.26之前的历史](history/progress-through-0.2.26.md)。

## 后续改哪里

| 修改需求 | 修改入口 | 不需要修改 |
| --- | --- | --- |
| 省电/标准/高频默认采样值 | `outdoor/samplingPolicy.ts` | 主页面、地图、轨迹存档格式 |
| 新平台记录能力 | `useSamplingPolicy`/`useRecording`的平台适配与平台服务 | routeAnalysis、文件格式 |
| 速度色阶、坡度阈值 | `routeAnalysis/config.ts` | 地图交互、照片、导航状态机 |
| 分析方法 | `routeAnalysis/metrics.ts` | 页面存储、Android服务 |
| 新文件格式 | dataTransfer 的独立格式适配器 | 收藏与存档事务 |
| 批量数量/总大小 | `dataTransfer/batchImport.ts` | XML解析器、主页面 |
| 地图交互浮窗 | 对应功能的组件/CSS | 公共样式文件的全局覆盖 |
| 队伍功能 | 后续独立 `team` 模块及传输接口 | 记录存档、地图内部变量 |

## 检查与剩余结构债务

- `npm run check:architecture`：扫描app/modules，限制新增文件500非空行，冻结既有超限文件额度，禁止业务模块反向依赖工作台/页面，禁止dataTransfer依赖兼容入口。额度是现状约束，不是“全部大文件合理”的认可。
- `npm test`：完整逻辑回归；日常先对本次变更的测试文件运行Node测试，再在交付前完整检查。`npx tsc --noEmit` 和网页/Android构建继续保留。
- 主页面与 `TerrainMap` 仍大。下一次触及导航启动、剖面工作区、标记操作时，分别提取完整流程控制器与明确的输入/输出，不机械剪成多个无边界大文件；不要新增巨型全局Context。
- 不因行数大就删除稳定算法，不改原模型精确调整、路线删除不补线、原始记录来源/时间、测量与勘探几何等既有约定。

## 回滚

本轮是可独立回退的提交；回退该提交可恢复旧入口和界面。新采样偏好使用独立键，旧版忽略；`colorMode`是可选样式字段，旧版归一化时忽略。历史进度在归档文件和Git中均保留。没有删用户存档，没有换包名/签名/Logo。

## 0.2.28扩展接口

- routeDisplay负责选定路线的海拔/速度/坡度派生显示、图例/统计/剖面开关，阈值在routeAnalysis，原始轨迹不改写。
- offlineRouting提供区域道路图、A*和包管理。navigation/provider先调用公开适配接口，strict模式无在线算路回退。地图瓦片缓存和可计算路网分开管理。
- returnHome只输入轨迹/定位/标记和回调；返回点复用annotations的name/icon创建参数，兼容原3参数调用。
- routeShare/photoLayout为纯版式，photoCollage复用photos/export，最多8张、重点照片独行。
- useOfflineMapMode统一开启缓存底图和重启恢复；tileCache供地图协议、路线DEM、点高程和分享地图共用。并发下载预留容量、250ms进度节流，避免每张瓦片重复落盘完整索引。
- app/page最终约2862非空行，仍是历史组合层；新增功能未增加TerrainMap规模，RoutePanel说明提取到独立组件。测量/剖面几何、模型精调、地图手势、原生记录机制未改。
- 回滚可按新增模块撤销接口接入，新增偏好和路网数据库独立，不删除用户旧存档。
