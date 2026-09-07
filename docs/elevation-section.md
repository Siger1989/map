# 矩形交线剖面与对象 Gizmo

当前入口：地图右侧 **剖面**。模型保持完整，只叠加有限矩形面、交线和所选点；不裁掉山体或标记。

## 使用

- 剖面和选中的长方体、圆柱、球体共用对象中心 Gizmo。三种操作同时可用：拖红/绿/蓝箭头沿对应局部轴移动，拖圆环旋转，拖轴上方块拉伸；中心黄色方块等比缩放，灰色外圈绕屏幕方向转动，灰色角箭头沿屏幕平面移动。剖面的 X/Y 对应宽/高，Z 为法向，没有厚度缩放。地点标记只提供位置操作。
- 操控器随对象的位置和姿态投影。拖动时仅预览，松手保存一次；取消、Esc、失焦、丢失触摸或第二指介入时还原。操作栏可撤销；方向键可微调选中的手柄，Shift 旋转按 5° 对齐。右下角绿色相机控制器继续控制地图视角。
- 点矩形面，或操作栏的“详情”，打开轮廓窗口。每条不相连的交线单独选择，底部横向滑杆沿所选交线移动；地图白点、轮廓白点与坐标/海拔读数来自同一份数据。详情内可精确输入中心、海拔、宽高、方向、倾角及面内转角。
- “保存图片”生成 1600px 宽 JPEG。上方为轮廓图，下面包含选点经纬度/海拔/沿线距离、交线长度与最高最低值、中心坐标、面尺寸和姿态、采样覆盖/步长、来源、时间与署名。网页直接下载，安卓调用现有系统图片保存选择器；取消系统选择器不会被说成已保存。
- 图的 U/V 轴是剖面内坐标，旋转或倾斜之后 V 不等于绝对海拔。海拔由所选点单独显示；长度是局部三维米制近似值。显示的小数位不代表测量精度。

操作参考 [Maxon Gizmo 3D Basic Operations](https://help.maxon.net/zbr/en-us/Content/html/user-guide/3d-modeling/modeling-basics/gizmo-3d/basic-operations/basic-operations.html)。本项目实现基础对象变换，不包含 ZBrush 的雕刻、挤出、遮罩或变形器。

## 模块与接口

- `objectTransform/math.ts`：标记/剖面与统一 Pose 之间的兼容转换。
- `objectTransform/projection.ts`：MapLibre 自定义图层投影快照、世界坐标投影与射线变换。`gizmoHandles.ts` 负责箭头/圆环/方块及最近手柄命中；`ObjectGizmo.tsx` 管理输入、预览、提交、取消，通过 props 通知宿主。
- `annotations/modelGeometry.ts`：渲染与剖面求交使用同一网格与姿态。`AnnotationLayer` 拖动中保留网格，只更新变换；`useAnnotations.transform` 松手原子写入、保留撤销。可选 `centerAltitude` 固定模型中心海拔，旧存档继续随地面放置；位置页可恢复随地形模式。
- `section/contours.ts`：三角形求交、有限矩形裁边、端点串线、按弧长插值及坐标/海拔。模型与地形分开求交，不桥接无数据区域或无关模型。
- `section/loadedTerrain.ts`：隔离 MapLibre 6.7 已绘制地形覆盖索引适配。其默认高程查询会在 DEM 未加载时返回占位 0，这里只接纳确实加载的采样器；未加载/未覆盖返回空，真实海平面 0 仍有效。
- `SectionSurfaceLayer`：透明面、边框、交线、选点及平面点击拾取；按 80×40 网格对同源已加载地形采样，每约 140ms 合并更新。`SectionProfile` 和 `profileExport` 共用轮廓快照与元数据；导出复用照片模块公开的图片交付接口。
- `TerrainMap` 通过 props 和 `watchObjectProjection` 接线。开启剖面时使用真实地形倍率 1，退出恢复用户图层设置。从俯视进入时临时倾斜到 55°，退出恢复原俯视。安卓返回先关闭详情/取消变换，再结束剖面。

## 边界与验证

地形交线为当前已加载 DEM 表面的采样近似，受数据分辨率、视野 LOD 和步长限制，未进行独立测量或垂直基准转换；未知高程留空。模型交线来自可见标记网格，曲面使用与渲染一致的离散三角形。共面重叠区域没有唯一交线，不把整片重叠区域虚构成轮廓。尚不支持导入任意外部三维网格求交。

剖面会话与撤销保留在本次页面中；标记变换写入原标记存档。关闭剖面不修改地形、路线、收藏、照片或 GPS 记录。

验证命令：`npx tsc --noEmit`、`node --experimental-strip-types --test tests/*.test.mjs`、`npm run build`。`node scripts/verify-section-profile.mjs` 在隔离浏览器中以 390×844 / 360×780 检查真实 DOM 拖动、取消/撤销、模型保持完整、选点联动、JPEG 下载与布局；使用已知 1000m 测试 DEM，另行检查真实地形。截图在 `artifacts/screenshots/`，日志在 `.openai/`，均不进入 Git。浏览器模拟不等于手机真机验收。

旧 `PlaneSectionLayer`、`TerrainClip`、`SectionLayer` 与裁切数学测试保留为历史研究，产品入口已断开。旧 `verify-plane-browser.mjs` / `verify-section-browser.mjs` 针对历史裁切，不是当前功能验收入口。未添加新依赖、未修改第三方包或 DEM 源。
