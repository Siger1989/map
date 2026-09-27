# 手机3D地图性能调查（2026-09-27）

当前修复仅在源码预览中，未生成新APK。浏览器结果不代表Android GPU/触控验收。

## 已证实的代码问题与修复

- 路线点拖动的每个pointermove都计算投影/吸附并触发React与整组GeoJSON更新。FeatureDragBridge现按RAF合并，松手同步最终坐标；取消清理待执行帧。
- 原相机move每帧发布整页状态，纯平移也重复发布相同角度/缩放。cameraUpdates将周边控件更新限制为10Hz、跳过相同值、结束立即同步；地图本身仍由MapLibre原生渲染。快速标记的收起改到movestart，保留原行为。
- 无模型遮罩时，每个地形draw仍读取GL状态、切换纹理，且每帧上传矩阵。遮罩关闭现直接透传，只在切换关闭时清零程序计数；保留图集以供上下文恢复。模拟GL测试100次关闭绘制为0次状态读取/绑定。
- route-access、guidance-access及坡度警告遗漏统一排序。现随路线统一排序，后续无变化更新不重复moveLayer。
- 安装的MapLibre6.7源码明确不会自动恢复custom layers。旧恢复事件只提示；模拟GPU上下文丢失后，restore中的resize触发moveend，AreaLayer在未加载style上addSource报错，中断恢复。现lost标记未就绪、屏蔽业务图层同步，restored后仅重建地图组件的渲染资源，父组件保留当前路线编辑与存储数据。

## 尚未确认为朋友闪烁原因

路线和手绘轨迹是原生GeoJSON line/circle/symbol，贴地过程交给MapLibre；没有证据支持直接改路线深度测试或抬高路线。山脊遮挡与整图上下文丢失需区分。

当前完整设备DPR与强制抗锯齿可能增加高分屏开销；多块磨砂背景也增加合成成本。此轮保留清晰度、图源、地形256px及界面风格，没有据桌面结果设置手机降画质阈值。新增诊断记录最近120个相机运动render间隔，排除空闲和恢复间隔；这是渲染事件间距，并非GPU执行时间。

官方选项参考：[pixelRatio与canvasContextAttributes](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/MapOptions/)。上下文恢复行为按本项目node_modules/maplibre-gl/src/ui/map.ts的_contextLost/_contextRestored核对。

## 验证与下一步

48项拖动、图层顺序、相机发布、模型遮罩/地形、诊断定向测试通过；类型检查及移动网页构建通过。日志：.openai/mobile-perf-{tests,tsc,build}-20260927.log。

独立360×780页面真实WEBGL_lose_context模拟：恢复后画布重建，路线编辑面板保留，DEM和地图瓦片完成、contextLost=false、路线各图层可见；恢复后可继续拖地图。截图artifacts/screenshots/mobile-render-recovery-360-20260927.png。QA页mobile/render-recovery-qa.html不进入APK构建入口。

需要朋友手机型号/系统/WebView版本和具体闪烁表现，复测平移、俯仰、路线节点拖动、导航各场景。尚未测试真实低内存上下文丢失、长路线持续编辑、大量模型或Android恢复过程；不宣称真机问题已经全部解决。
