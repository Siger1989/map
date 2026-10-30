# 手机原生标记、模型贴地及点击范围修复

2026-10-31。用户已明确问题发生在手机APP的标记图标与模型，表现为悬空、不好点击。本轮只处理原生标记放置与交互链路；保留此前未交付的双图、线条、等高线、缺图回退修改。目标固定包仍为私人146/code153，实际手机安装版本未重新核验。本轮没有升版、打APK、提交推送；不开模拟器，不操作Unreal，不清存档。

## 已确认的源码问题与方法

| 问题 | 证据 | 修复 |
|---|---|---|
| 模型旧地面海拔与当前地形不一致 | controller只在groundElevation缺失时补当前DEM，已有存档值始终优先；即使DEM后来到达，也仍渲染旧海拔 | 渲染副本优先使用本地图当前真实DEM；保留存档原值、用户offset、地下放置和显式centerAltitude。没有实时样本时保留原有已知海拔作为回退，真正无海拔仍保持NEEDS_ELEVATION |
| 关闭地形后模型仍使用山地绝对基准 | 贴地模型以ABSOLUTE几何绘制，原地面高度未随显示平面调整 | 相对贴地模型在地形关闭时以显示平面0为基准；这只是显示状态，不伪造或写回地面海拔。用户显式绝对中心高度继续有效 |
| 地形开关、夸张值变化未重新生成模型 | refreshModelTerrain只比较DEM timestamp | 更新键包括DEM修订、terrainEnabled、verticalExaggeration；高度均传原始米值，SDK负责夸张，避免重复乘倍率 |
| 图标锚点与图案尖端不一致 | WWK PlacemarkAttributes默认中心锚点；64px pin图案尖端在y=62 | 图标以尖端2/64底部偏移为锚点，缩小圆点仍居中；不放大图标视觉尺寸 |
| 点击只检测一个精确屏幕点 | DOWN和tap只调用point GPU pick | 保留精确点优先；无交互物体命中时，补44 CSS px区域的真实GPU矩形拾取，按当前cssScale换算物理像素。地质底层不会阻止此补充检查；照片、路线与现有手势条件保留 |
| 标记编号在点击和拖动判断中格式不一致 | 原生controller兼容旧接口会返回裸ID，React拖动判断使用shantu-object:前缀 | 仅在hybrid触摸边界把已知标记ID标准化，照片/线路/地质delegate保持原格式，避免小幅手指移动时丢失标记捕获 |
| 模型显示与剖面可能采用不同高度 | 剖面输入原先复制原存档模型 | 两处共用controller.modelRenderInput；剖面签名增加放置修订，现有DEM更新流程可重新采样 |

普通pin通过SDK贴地，不为每个图标额外查询DEM；只有模型与有深度的钻孔需要读取地面样本。保存数据、签名、图源/缓存、绝对高度和模型参数均未重写。

## SDK研究依据

核对了项目实际依赖earth.worldwind:worldwind:2.1.1的官方Maven源码包。其Globe地理坐标转换会对ABSOLUTE输入高程应用verticalExaggeration，地形使用相同夸张值；调用方不能先乘。PlacemarkAttributes默认Offset.center()。矩形拾取使用SDK已有GPU接口，保留形状深度测试，没有用二维距离猜测代替地形遮挡。

- [官方2.1.1源码包](https://repo.maven.apache.org/maven2/earth/worldwind/worldwind/2.1.1/worldwind-2.1.1-sources.jar)，SHA256 A3F92C60359223D9B55BDD8FC03ABA574D7B1504794C64D76C9A77B1972627D5。
- [官方Android拾取接口源码](https://github.com/WorldWindEarth/WorldWindKotlin/blob/develop/worldwind/src/androidMain/kotlin/earth/worldwind/WorldWindow.kt)。该链接为develop接口文档，未冒充2.1.1 Android精确源码；项目2.1.1实际编译已通过。

## 文件

- map/NativeModelRenderer.kt：尖端锚点、可见几何与sectionMesh共用原始米中心计算。
- 新增map/NativeModelTerrainInput.kt；NativeMapController.kt：运行时地面副本、放置修订、剖面共用入口。
- hybrid/NativeReactMapHost.kt；新增hybrid/NativePickTouchTarget.kt：触控GPU补充范围、标记ID标准化、剖面输入。
- NativeModelRendererTest、NativeModelTerrainInputTest、NativePickTouchTargetTest及hybrid测试白名单。

## 验证

| 项目 | 结果 |
|---|---|
| 8组原生定向测试 | 34项，0失败/错误/跳过；`.openai/marker-ground-pick-native-final-20261031.log` |
| 最后一处普通pin免额外DEM查询的编译检查 | PASS；`.openai/marker-ground-pick-compile-final-20261031.log` |
| 相关tap/近线点选/局部几何Node检查 | 16项PASS；`.openai/marker-ground-pick-node-20261031.log` |
| 当前DEM替代旧值而不改存档、开关地形、地下/显式中心/offset、晚到DEM、放置修订 | 单元检查PASS |
| 可见mesh底面与sectionMesh在同一新地面高度 | 生产renderer几何检查PASS |
| pin/圆点锚点、CSS/物理点击范围、标记编号标准化与照片/线路格式 | 单元检查PASS |
| 手机实际悬空、触控手感、遮挡、多个密集标记的选择 | 未验证；未开模拟器，也没有新包安装证据 |
| 原生390×857/360×780实际截图及主双图/地形开关组合 | 未验证；构建和数学检查不作为视觉通过 |

矩形区域可能包含多个可见对象，仍沿用业务优先级；没有宣称对密集重叠物体做到最近像素排序。没有改照片优先级、绘制任务拦截、长按时限或手势阈值。

下一步在新测试包中验证：新建pin/方体/球/柱/棱柱，山地俯仰与旋转，地形开关/夸张值切换、晚到DEM、地下模型/显式绝对中心，图标边缘点选/轻微手指移动，以及主双图同场景。当前源码修复不能证明用户手机现象已消失。
