# 原生栅格缝隙羽化候选（2026-11-13）

## 当前实现与候选定义

当前 Android owning source 位于 `mobile-native/app/src/main/java/com/shantu/nativeapp/map/NativeRasterFeather*`。Mercator 瓦片路径在相邻可见叶片确认存在粗级别边界，且 child 自身纹理与同源已缓存 parent 纹理都可用时，才提交一个 parent/child pair；无已知边界或 parent 不可用时继续使用原纹理路径。普通瓦片不会因此增加请求、纹理或 pair。

原带宽由 `BAND_FRACTION = 1/16` 限制在 child tile 边长的 6.25%，shader 又以 `fwidth × 6 CSS px × pixelRatio` 作更窄的一层上限。因此它的有效宽度是两者中的较小值，并不接近半张瓦片。

本候选把“50%”定义为：从某一条已确认接缝沿 child tile 向内，到该 child 在此方向中心线的 tile-local 半宽；仅该接缝一侧的 mask 使用这段 smoothstep。边界处 child 混合权重为0（显示 parent），半宽处权重为1（显示 child）；地图整体 alpha 不变，只开启的边缘参与渐变。保留同源 parent/child premultiplied RGBA 混合与原纹理坐标。移除固定 CSS 屏幕像素上限，避免它继续把 50% tile-local 带宽压回几个像素。没有新增纹理采样之外的资源、瓦片请求、pair 数或调度工作；已有边界 pair 本来就采 parent 和 child，因此现在会在更大范围显示二者的混合，过渡区本身会比原图更柔软。

## 适用范围

- 普通及锁定最大级别的 Mercator raster base 使用同一 owning renderer；锁定上限不改变边界检测。只有实际显示的 child 边界和有效同源 parent 满足条件才渐变。
- 单独的固定级别细节覆盖层 `NativeRasterDetailLayer` 当前直接创建普通 `SurfaceImage`，没有调用 `NativeRasterFeatherSurfaceImage`，也没有已接入的父纹理 pair。因此此改动不会声称或改变该独立覆盖层的固定图块缝羽化。实验目录中的 `fixedEdges` helper 不等于生产调用链。
- pick 绘制、透明图层、没有 parent backing、未知邻接状态继续走原分支。没有更改 LOD 请求/选择策略、图源地址、瓦片内容或缓存预算。

## 风险与验证边界

半瓦片渐变会让较大区域同时混入低清 parent，降低边界附近细节；在多条邻边同时开启时，叠乘 mask 会扩大柔化区域，但两边/四边都打开时tile中心仍回到child权重1。shader复用原来的 parent/child UV变换，不改采样坐标，因而此次逻辑没有引入纹理拉伸；但171候选曾出现大块拉伸，不能以源码检查或Kotlin单测证明历史问题已消失。没有新增CPU处理、瓦片工作或texture pair；shader保留每个候选pair原有的两次采样和mix，只扩大渐变区，实际GPU片元成本/手机性能仍需设备验证。

本轮只做源码候选、定向 Kotlin 单测/编译和实际 WorldWind SDK shader-source 生成检查，不打包或安装。Kotlin侧检查的是策略和生成的shader文本，不是GPU执行/渲染证据。没有浏览器、模拟器或真机视觉证据；不报告羽化观感通过，也不报告性能无影响。需在相同镜头、图源、窗口尺寸下检查接缝连续性、无中心模糊/纹理拉伸，并比较主图与双图的真实帧和运行时 pair 计数后再决定是否交付。

定向命令：`mobile-native/gradlew.bat -PbuildStage=D:/ShantuEngineResearch/feather-build-20261113 -x :hybrid:prepareSharedCadJni :hybrid:testDebugUnitTest --tests com.shantu.nativeapp.map.NativeRasterFeatherPolicyTest`（JDK17）。结果：15/15 PASS，0失败、0错误、0跳过；真实项目 Kotlin 与测试类编译通过，WorldWind SDK shader-source 生成断言通过。报告：`D:/ShantuEngineResearch/feather-build-20261113/hybrid/test-results/testDebugUnitTest/TEST-com.shantu.nativeapp.map.NativeRasterFeatherPolicyTest.xml`。跳过 `prepareSharedCadJni` 仅为避免此单测无关的全ABI CMake任务，不影响Kotlin测试；没有执行APK任务。

2026-11-14交付追加：用户已明确转入私人测试APK打包，候选纳入203；本次Gradle定向检查成功（测试任务UP-TO-DATE），原生观感/性能仍未验证。具体交付与限制见release-0.2.203.md。
