# 标记整体缩放隔离修复 · 2026-11-02

状态：源码候选；未合并、未出包，真实原生视觉与触控尚未验收。双图性能问题不由本项证明已解决。

## 目标与边界

地图逐级拉远时，标记图标、名称框和文字整体缩小；文字不独立显示，视觉尺寸与点击区域分开。保留近景、选中/取消、对象数据和已有交互。不改路线宽度、悬浮窗、iOS、结束导航、网络调度、MVT 解码或 GC 实验。

- 基线：`020866166ea9795520253a0b6d8fc0086b23a945`。
- 独立分支：`codex/marker-zoom-20261102`。隔离工作树：`C:\Users\bodean\.codex\worktrees\marker-zoom-20261102\天气系统`。
- 主树未提交的性能诊断变更未复制。总控负责最终集成、冲突处理和设备回归；此分支不自动合并或发布。
- 原创建操作 `f0937619-4e54-47d0-a11d-8b8dff89f02d` 曾长期停在 creating，后续只读查询确认为 completed/revision96、registrationError=null，当前聊天附件和工作目录均已登记此路径，才开始写入。
- 先前 attach 操作 `dc7013e1-fe4a-4d31-b55e-89ce8377d71b` 仍为 failed，原文：`Cannot verify that this ownerless worktree belongs to this task.` 未修改所有权元数据、绕过校验或重建工作树。

## 根因与实现

原生旧策略在原始 zoom 9/8 附近切换名称框、图标和圆点；同一档位内尺寸固定。既有 `markerBadgeImage` 已把图标、名称框和文字画在同一张图片中，本项复用这张完整图片，统一保留 label 模式，缩放只更新 `imageScale`。旧的 icon/dot 提示不再使名称框消失；不增加独立 WorldWind 文字 drawable。

沿用现有 TypeScript 通用 markerScale 数值曲线：有限 zoom 的倍率为 `clamp(0.35 + (zoom - 4) * 0.65 / 12, 0.35, 1)`，非有限 zoom 保留默认完整尺寸。完整位图逻辑高度64，标称近景高度40 CSS px；原始 zoom≥16 为40px、12为31.33px、8为22.67px、≤4为14px。该值包含指针，不是字号；具体远景文字清晰度和遮挡仍需设备验收。

缩放不改变纹理 key、地理锚点、名称、可见性、用户保存值和选中语义。密度 bucket 变化仍通过原有异步纹理兜底更新，待加载的新旧整张图片一起使用当前缩放。现有 GPU 精确命中优先及44 CSS px矩形补充拾取保留；多候选歧义不按保存顺序任意选中。

独立复核补修：尺寸状态只在实际发出 resize 更新时记下新尺寸，让连续低于单次阈值的微小 zoom 变化可以累积，避免缓慢缩放始终被跳过。加入20步微小变化的定向回归；相同输入及最小/最大尺寸仍跳过冗余更新。

## 文件 owner 与验证

| 文件 | 范围 |
| --- | --- |
| `NativeMarkerPresentation.kt` | 整体模式、连续尺寸曲线 |
| `NativeMarkerPresentationState.kt` | 比较上次实际应用尺寸，累积微小缩放；密度逻辑保留 |
| `NativeMarkerPresentationTest.kt` | 数值锚点、安全输入、模式不丢名称框 |
| `NativeMarkerPresentationStateTest.kt` | 双向缩放、旧临界点、纹理不重建、双图状态独立 |
| `NativePickTouchTargetTest.kt` | 独立44 CSS px命中范围 |
| `NativeModelRendererTest.kt` | 实际渲染对象、纹理复用、锚点/数据保持及异步兜底 |
| 本文、CURRENT_STATE、agent-handoff、ui-quality-gate | 本分支交接与待验范围 |

实现与测试按文件分工，主 agent 复核实际 diff、断言及执行结果。原生测试使用本工作树专用 buildStage、project cache、单 worker 和有限堆；不复用总控构建目录，不生成 APK。纯 JVM/Robolectric 测试排除私人图源、React 资产和 CAD 打包准备任务；此测试输出不是交付包，不能作为私人天地图/签名/资源审计证据。

过程记录：首次中文 buildStage 下生产/测试编译完成，但五个测试类全部 ClassNotFoundException，尚未执行断言。仅把专用测试输出切到 ASCII 临时目录后，类加载成功；没有更换源码工作树或执行器。该轮35项中两项失败：新微小缩放用例捕获了修正前已编译的状态类（javap确认旧无条件赋值），另一项旧断言仍期待远景圆点的居中锚点。源码状态修正与名称框指针锚点断言核对后冻结代码，禁用增量编译重跑最终35项。前两轮日志分别保留于`.openai/marker-zoom-kotlin.log`、`.openai/marker-zoom-kotlin-ascii.log`；不得将失败轮冒充最终证据。

定向命令为 `:hybrid:testDebugUnitTest`，只筛选 `NativeMarkerPresentationTest`、`NativeMarkerPresentationStateTest`、`NativeModelRendererTest`、`NativePickTouchTargetTest`、`NativeRenderedPickResultsTest`。参数包含专用`-PbuildStage`和`--project-cache-dir`，`--max-workers=1 --offline --no-daemon`、`-Pkotlin.compiler.execution.strategy=in-process -Pkotlin.incremental=false`；排除`:hybrid:prepareHybridAssets`、`:hybrid:prepareSharedCadJni`、`:app:preparePrivateAssets`、`:app:terrainAssets`。Node命令为`node --experimental-strip-types --test tests/native-map-tap-semantics.test.mjs tests/native-map-interaction.test.mjs`。

| 验证项 | 结果与证据 |
| --- | --- |
| 点击/取消/手势过期与精确命中语义 | PASS：27项 Node 定向测试，`.openai/marker-zoom-node.log` |
| 原生尺寸/状态、渲染与拾取 | PASS：5套35项 JVM/Robolectric，0失败/错误/跳过；最终源码重新编译，`.openai/marker-zoom-kotlin-final.log` |
| 实际 Android 逐级缩小/放大及文字框绑定 | 未验证；未操作模拟器或手机 |
| 390×857、360×780小屏、密集标记可点选性、选中/取消/空白及连续操作 | 未验证；须在最终集成 APK 上由总控安排设备空档 |
| 旧8/9临界点闪烁/残留、异步加载、斜视地形遮挡 | 未验证；单测不能替代真实帧 |
| 主双图性能与近景外观 | 未验证；总控安排同条件回归 |

## 集成后验收

最终代码与测试的6项SHA256、5套JUnit计数、日志摘要指纹和待验项见[`artifacts/verification/marker-zoom-20261102.json`](../../artifacts/verification/marker-zoom-20261102.json)。原始JUnit XML留在本机`.openai/marker-zoom-junit/`。测试通过只证明上述代码行为；独立代码复核发现的微小缩放问题已修正，真实视觉仍未验收。

证据绑定最终 commit 或工作树指纹、实际 APK SHA256、设备/系统、真实视口和操作路径。主图与副图分别逐级跨原始 zoom 16/12/9/8/4，确认整张图片平滑变化，名称框及文字无独立残留；往返临界点、密度变化、重选/取消、空白点击和密集标记精确/邻近点击均留截图及交互结果。最小尺寸与远景名称可读程度需用户视觉确认，不能只验证数学缩放。

设备当前独占权归总控；本项未安装、未录屏、未采集性能，无本项 APK hash 可提供。源码或候选变化后对应证据必须重验。未验项目不得标为 PASS，也不得据此宣称整体视觉通过或直接交付。
