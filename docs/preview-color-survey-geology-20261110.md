# 画线选色、平剖图比例与地质投射（2026-11-10预览增量）

当前源码目录 `D:/ShantuEngineResearch/old-engine-20261105`，分支 `codex/old-engine-tilt-dual-20261105`，基于196/code203，未升版、未出新APK、未提交推送。不能把以下源码和网页检查写成已安装手机验收。已交196及历史包、用户存档、私人天地图与39图源种子保留；社交功能仍暂缓。

## 统一画线与选中对象颜色入口

根因：`TrackColorPicker` 的实际颜色输入为透明控件，原生地图触控收集器按透明度过滤了它；可见的 `label.track-color-picker` 外壳未被收集，触控可能落到原生地图。画线、路线样式与 `RouteSelectionFields` 的点/相连线段备注复用此控件。

修改 `mobile/native-ui-regions.ts`，仅对存在可编辑颜色输入的可见外壳收集整行命中区域。保留滚动裁剪、隐藏、inert、禁用、readonly与透明孤立输入过滤。原来的共用色板、预设色、自定义HEX、颜色即时回写与备注“应用”语义不变。没有重做业务或修改已保存线条。

验证：

| 检查 | 结果与证据 |
| --- | --- |
| 实际DOM命中区域 | Node回归覆盖整行、滚动裁剪、隐藏/禁用/只读/缺input与透明孤立input排除，PASS |
| 真实React颜色组件 | `TrackDrawingStyle` 与 `RouteSelectionFields` 单线段打开共享色板、HEX/预设写回、互不串色，PASS |
| 390宽网页画线 | 打开色板→红色→自定义 `#123abc`，保留宽度1.5，PASS；`artifacts/screenshots/color-hit-20261110/drawing-hex.jpg` |
| 390宽网页单点备注 | 蓝色与备注→应用→返回→重开，显示 `#377eb8` 和原备注，PASS |
| 390宽网页线段备注 | 框选3相邻点形成相连2段，红色与备注→应用→返回→重开，显示 `#e41a1c` 和原备注；重开色板红色选中，PASS；`segment-palette.jpg` |
| Android/OPPO触控转发 | 未连接手机，未生成新包，未验证；网页不能复现或证明原生触控转发成功 |

网页路线检查使用已有 `feedback-qa.html` 的真实组件/routeEdit回调和隔离合成数据，未改用户存档。该页面的地图是投影夹具，未当主双图地图引擎或完整布局验收。测试页已关闭，右侧保留私人390手机地图预览。

## 平剖图横纵工程比例

修改 `SurveySheet.tsx`、`surveyLine.ts`、`surveyScale.ts`、`surveyDrawing.ts`、`surveyRecords.ts`、`survey.css`。新增可保存的 `verticalPrintScale`，旧数据缺省时跟随实际横向比例；固定纵向比例保持真实像素/米关系，图纸高度随高差改变，文字字号不压扁。显示横/纵比例与纵向夸大倍数。比例更改不清地形采样，测线key不变。

“容不下全线”指当前水平比例下，含延长段的全线不能装入单页绘图区；选更大的比例尺分母或自动铺满。导出比例基于完整1800单位图纸按420mm总宽打印；打印时再适合纸张会改变实际比例。原来JPEG的“100%即正确”暗示已移除。

为避免高差很小时曲线被人为放大，最小绘图区280单位通过扩大Y轴显示高程范围达成。总图高超过8192时明确报错，禁导出并提供“调整比例尺”，不截断、不静默改比例。设置内容实际滚动，标题固定，说明折叠。

| 检查 | 结果与证据 |
| --- | --- |
| 几何与兼容逻辑 | 实际横纵比例、固定纵向高差/轴高、相同字体、旧数据与存储回读、过高错误的定向Node，PASS |
| 390×857合成组件 | 默认横纵均约1:6302.54/夸大1；选纵向1:1000后夸大6.3；恢复跟随并横向1:10000后纵向同步，PASS |
| 设置尺寸/滚动 | 实测260×200，外8px/控件4px；scrollHeight250，固定标题、返回关闭可点，PASS |
| 360×780极端高差 | 3500m高差与纵向1:500触发过高错误、无图且导出禁用；调整比例尺可打开设置，改1:10000恢复图与导出，PASS |
| 360×780说明展开 | 可滚到底约230px，标题保留、无横向溢出、关闭可达，PASS |
| 手机及实际打印 | 未验证；合成DEM不代表真实地形精度或手机操作 |

截图 `artifacts/screenshots/survey-scale-20261110/vertical-1000-390.jpg`、`help-scroll-360.jpg`。临时QA入口已移出mobile到 `.openai/survey-scale-qa-20261110`，避免进入正式Web构建。

## 地质图投射

用户已确认故障对象为图层菜单的地质图投射，手机存在崩溃与缩放时消失重现。当前混合地图强制WORLD公开地质MVT；本轮围绕原生WORLD生命周期修复，不把无崩溃日志的源码推断写成已确定的手机崩溃原因。

源码中原来每750ms视口更新会先删除旧级别图形，网络数据尚未到达就留白；离开视口的请求没有及时失效，旧结果还可能短暂添加。请求缺少总并发控制，MVT解码在Main执行。改动 `NativeGeology.kt`，新增 `NativeGeologyWorldRequests.kt` 和 `NativeGeologyViewport.kt`：

- 维持最多2个活跃WORLD请求，排队去重、视口/图源变化取消；取消任务到finally前仍占槽，旧finally不能误删同key的新任务。
- 保留上次完整显示的scene，新视口所有所需瓦片齐全后在Main同一轮替换；新旧级别不重叠叠色。失败或预算超限仍保留旧scene，错误可重试，自动重试间隔3秒。
- 已完成pending瓦片不重复抓取，scene身份未变化不重复remove/add和重绘。父级审查发现并补回这两项，已加回归；反复传相同enabled也不清图。
- 解码移到Default并定期检查取消；WorldWind对象创建和layer操作保留Main，几何构建分段yield响应取消。显示/准备各至多9瓦片，地质单位目录随实际scene重建。
- WORLD独立预算：4MiB、8192features、100000vertices、16384paths、每feature16384vertices。超过预算整瓦片报错，不静默截断后冒充EMPTY；原通用decode与悬浮图精简decoder不变，未改地质云WMTS流程。

23项Native定向检查通过：原decoder10项、WORLD预算5项、请求与scene身份5项、视口2项、本机公开样本1项。首次编译发现helper错误导入 `kotlin.math.toRadians`，改为Java静态方法后完整重跑通过（1分4秒）；`feedback-unified-20261110-native.log` 与Gradle XML保留结果，未跑无关全套/JNI，也未生成APK。

实际公开Macrostrat三瓦片的WORLD新decoder与原decoder逐元素完全相等，非仅计数：

| 瓦片 | Bytes | Features | Vertices | Paths |
| --- | ---: | ---: | ---: | ---: |
| 0/0/0 | 240232 | 2561 | 26659 | 3393 |
| 3/6/3 | 79550 | 655 | 12396 | 739 |
| 5/25/13 | 13586 | 66 | 2208 | 77 |

样本URL来自产品已有 `https://tiles.macrostrat.org/carto/{z}/{x}/{y}.mvt`，均为公共合成测试位置、不含用户GPS或凭据。临时样本测试与XML已移到 `.openai/geology-stability-20261110`，未把绝对路径或样本二进制加入源码。正式新增3个Native回归文件位于 `hybrid/src/test/java/com/shantu/nativeapp/geology`。

ADB未连接设备、未启动模拟器，未获取手机崩溃堆栈。此结果证明对应原生源码可编译、策略与解析检查通过，不证明OPPO崩溃已解决或实际连续缩放画面已验收。新版APK/真机仍未完成；不得报告完整视觉通过。

## 合并检查

43项定向Node全部通过，TSC通过。日志 `.openai/feedback-unified-20261110-node.log`、`feedback-unified-20261110-tsc.log`。临时比例QA移出mobile后隔离私人Web构建通过（8.93秒，既有chunk/plugin耗时警告），日志 `feedback-unified-20261110-web.log`。构建输出仅放 `.openai/feedback-final-web-20261110`，未覆盖196安装包。核对私人天地图Key存在且纳入JS（仅输出布尔，不打印Key）；Vite构建不自动复制serve-only种子，随后只在隔离私有输出的native目录复制既有39种子并核对字节一致，临时survey QA未入包。检查摘要 `feedback-unified-20261110-private-check.json`。不因此宣称手机包或系统桥接已验。

照片20–32px下限及导入自动查看本批位置一起保留；GPS未读的个别原片未取得，不宣称新增GPS修复。详见 `preview-photo-autofocus-20261110.md` 与 `preview-photo-min-gps-20261110.md`。矢量导入能力与真实入口见 `vector-import-support-20261110.md`，没有增加SHP/GPKG支持。
