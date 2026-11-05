# WorldWind 2.1.1 Android 注记修补

本目录仅包含四个小范围 SDK 替换源码、数学用例、构建脚本及 Apache 2.0 许可。原 SDK、编译输出、本地 Maven 仓库都放在当前 checkout 的 `.openai/`，不进入 Git，也不修改全局 Gradle 缓存。

修补沿用 WorldWind 2.1.1 的 MVT 弧长排字算法、GlyphRun 和 Label 渲染，增加可见重复筛选及逐次字串碰撞。它不更换引擎，不改变道路几何、图源、地名文字、中文回退、字号、加载 LOD 或功能开关。

## 修补内容

- 原 Android `Font` 已将 SP 换算为物理像素，但 `LabelSpec.pixelSize` 仍保存逻辑字号。`AndroidMvtLabelMetrics` 按原 Android `TextRenderer` 的字体度量、文字 tight bounds、行数和 halo 计算实际位图宽高，不创建位图，也不修改 `Font/LabelSpec/MvtLabelGroup` 的 ABI。
- 点注记框使用真实 `textOffset/scale`。默认 `bottomCenter` 在 OpenGL 坐标中向上扩展，原框向下扩展。
- 点注记保留原距离/minZoom 筛选，之后使用与实际贴地字形一致的高度投影碰撞位置。曲线采样、最终字形位置也使用当前显示地形 `CLAMP_TO_GROUND`。
- 路名不再以整条线的一个中点水平框代表所有旋转、重复字串。准备阶段保存最终逐字锚点和角度，按与 `Label.makeDrawable` 一致的变换合并每次重复的实际纹理框；绘制直接使用该快照。地名先占位，路名每次重复独立接受或拒绝。同 ID 仅对空间邻近的已接受重复去重，碰撞失败不占去重名额。
- 读取实际 MVP 第四行的齐次 W，将屏幕比例 u 转为 `t = u*w0 / ((1-u)*w1 + u*w0)` 后再插值地理位置。最终贴地重投影与计划位置相差超过 **2 个物理像素**，只拒绝该次字串，不做无界逐字求解。长屏外段从实际屏幕坐标恢复 Double u，避免原 `GlyphPlacement.segU: Float` 的精度损失。
- 保留正确的旋转符号；局部朝左倒置、相邻字切线转角超过 **30°** 或整词角度跨度超过 **60°** 的字串整次跳过。不会逐字翻转或改写文字，其它合格重复及道路本体保留。这些是本补丁的待实景校准阈值，不是对奥维实现的断言。
- 可见重复迭代器复用原中间顶点定位、重复间隔和逐字切线公式，以折线与扩展屏幕的交集直接计算重复索引区间，不先分配大量屏外 glyph。采用 Double 弧长以保护大倾角长屏外段的局部字距。投影失败的顶点断开连续段，不再连接两侧后跨不可见区排字。
- 未被接受的候选只保存数值数组，Label 池只为实际获准的字符增长。碰撞累计数组按重复数扩容并保留已接受的点/线框。缓存仅持有轻量 pass token，不保存 RenderContext/WorldWindow；每次 collider 调用刷新 token，避免双图或同帧不同投影混用布局。
- 点注记优先级、现有远距门槛和点注记预算保留；没有缩小字体或隐藏道路来制造改善。

## 度量缓存为什么是 4096

缓存发生在碰撞筛选之前，200 个最终显示文字不等于只有 200 个候选。当一帧按稳定顺序访问 N 个不同候选且 N 超过 LRU 容量，每帧下一次访问的复用距离都超出容量，512 条缓存可能持续失效。4096 条可覆盖更大的大倾角候选工作集；这是一项容量推导，**不是已经测得当前场景候选数或性能提升**。

每条仅保存文本、Typeface 引用和数值，不保存 Label、TextAttributes、窗口、controller 或回调。超过 256 个 UTF-16 单元的文字正常测量和完整显示，但不进入缓存，也不留在查询 scratch key。缓存字符载荷上限约 2 MiB，加条目对象、数值和哈希表后估计每个 collider 约几 MiB；Typeface 是现有共享引用，其字体资源不计入这个估算。缓存按实际访问增长，不预分配 4096 个条目。双图各自有 collider，内存需分别计量；超过 4096 的候选集仍可能失效，需要实际剖析，不能声称彻底消除了测量成本。

## 统计与开销核验

新增 `MvtCurvedLineLabel.copyLayoutStatistics(LongArray(11))`；SDK 内部 collider 的 `copyLineLayoutStatistics(LongArray(11))` 返回本次碰撞调用的合计。调用方提供数组，不创建窗口引用或统计对象。槽位为：

| 槽位 | 内容 |
|---|---|
| 0 | 与扩展屏幕相交的连续块内，按完整弧长计划的重复总数 |
| 1 | 通过方向、重投影、可见性检查的重复数 |
| 2 | 碰撞和去重后接受的重复数 |
| 3 | 原始地理顶点投影次数 |
| 4 | 最终 glyph 贴地重投影次数 |
| 5 | 投影/远距/2 px 残差门槛拒绝的重复数 |
| 6 | 倒向或曲率门槛拒绝的重复数 |
| 7 | 按索引直接跳过或随后判定离屏的重复数 |
| 8 | 准备布局耗时，纳秒；不含碰撞扫描、Label 提交或 GPU 时间 |
| 9 | 原始顶点中连续有效的投影块数，含早期离屏块 |
| 10 | 单字度量查询次数，含缓存命中 |

候选布局比旧中点代理需要更多几何工作，因此仅凭编译不能承诺更快。重点测槽位 4、5、8：不得把大量山地路名拒绝后取得的速度当优化成功。旧算法可能为屏外部分先构造几百万次重复；宿主数学用例验证新迭代器只构造可见的几次，并保持局部字距。这不是手机性能结果。

## 已保留的限制

- 每次字串使用旋转单字四角的保守 AABB，弯曲字串框内包含空白区域，可能多拒绝一次名字；没有逐多边形精确碰撞。
- 透视修正对空间直线精确，但地球曲面、线性经纬度插值和非线性地形并不严格等价。2 px 门槛可能在复杂山地少显示名字，实际拒绝率尚未验证；需要时应按证据增加有界段细分，不能宣称已解决所有曲面。
- 方向/曲率门槛会拒绝某些弯道名字，不改道路本身。同 ID 从整条路线去重改为空间重复去重；跨瓦片的重复相位没有建立全路网一致性。原 SDK 瓦片构建阶段 `streetSeen` 按文字去重仍保留，因此某些片段本来就没有候选。
- 可见重复算法保留原公式，但 Double 与原 Float 累加可能产生微小相位差；没有增加字体塑形或 Unicode 字素算法。SDK 逐 UTF-16 单元排字的限制仍在。
- 点注记距离/minZoom/地平线早期筛选仍保持海拔 0 近似；修补的是后续真实屏幕位置。
- 山兔当前 MVT 点注记没有自定义旋转。本补丁未扩展旋转点注记的包围框算法。
- 不修改深度测试或地形遮挡；半字等深度问题要独立判断。
- 不解决不同 MVT 图层之间各有碰撞池的问题；主工程合并注记层另行处理。
- 天地图 WMTS 的文字已经在瓦片中，不受此 MVT 补丁影响。
- 此覆盖层仅供 Android，包含 Android Paint 调用，不能直接当作上游全部平台的 commonMain 补丁。

## 可复现构建

需要 Python 3、JDK（本轮验证用 JDK 21）、Android SDK API 35，以及本机已经缓存的 Kotlin 2.4.10 编译器依赖。脚本不调用 Gradle，不启动设备，不自动下载编译器依赖。

```powershell
python -B mobile-native/worldwind-labels/build.py --verify-reproducible
```

路径解析顺序：

1. JDK：`--jdk` → `JAVA_HOME` → PATH 中的 javac。
2. Android SDK：`--android-sdk` → `ANDROID_SDK_ROOT/ANDROID_HOME` → 当前项目 `mobile-native/local.properties` 的 `sdk.dir`。不会复制或打印该文件其它配置。
3. Gradle 缓存：`--gradle-cache` 指定 `caches/modules-2/files-2.1`，否则按 `GRADLE_USER_HOME` 或用户默认 `.gradle` 位置读取。

`--upstream-aar` 和 `--sources-archive` 可指定已下载的**原始**发行文件。否则优先读取本机精确 2.1.1 缓存；缺失时只从 Maven Central 下载到 `.openai/` 并按内置 SHA-256 校验。已存在但不匹配的缓存会报错，绝不覆盖它。

默认输出：

```text
.openai/worldwind-label-maven/earth/worldwind/worldwind-android/2.1.1/
  worldwind-android-2.1.1.aar
  worldwind-android-2.1.1.pom
  worldwind-android-2.1.1.module
  worldwind-android-2.1.1-sources.jar
  *.sha512 / *.sha256 / *.sha1 / *.md5
  LICENSE / NOTICE / build-manifest.json
```

Module 中保留原 `name: worldwind.aar` 与原下载 URL `worldwind-android-2.1.1.aar`，只更新 API/runtime 两个 AAR 记录的 size/hash。POM 和 sources classifier 按原发行内容保留；该 sources JAR 是**未修改的上游源码**，本地补丁源码及 fingerprint 在此目录与 manifest 中明确列出。

`--output-repository`、`--work-root` 可指定当前 checkout `.openai/` 下的其它位置。工作目录默认位于输出仓库的 `.build/` 下。每次构建创建新的工作目录，保留原文件、编译日志、ABI 对比和完整生成仓库；只在全部验证成功后发布本地 Maven 目录。不要与正在使用同一生成仓库的 Gradle 构建同时运行本脚本。

编译固定为 Kotlin 2.4.10 / JVM target 17，关键 flags 为：

```text
-no-stdlib -no-reflect -jvm-target 17
-module-name earth.worldwind_worldwind
-Xfriend-paths=<verified original classes.jar>
```

编译 classpath 使用原 classes.jar、android-35/android.jar、kotlin-stdlib 2.4.10 和 annotations 26.1.0。编译器运行依赖及具体 hash/路径写入 manifest。`-Xfriend-paths` 允许编译期访问已核对的 SDK internal 元数据；没有反射或访问抑制。原 module name 保留既有 JVM internal 方法后缀。

## 完整性与替换边界

锁定的原始 SHA-256：

| 输入 | SHA-256 |
|---|---|
| AAR | `7d1312f400016e9a746c5736944b9205d0c834458f0e978c88e7753ec5fa6c01` |
| classes.jar | `8b6ea302913e35d247b1a95012ebc24da7914f25dd9f5b072445bdf8cb8b9e30` |
| sources.jar | `0c97de300c578bd73956ca498f4eed8b5d582f3715bc22d7360863247ce9dbdc` |

脚本编译后必须得到以下 12 个类，全部位于 `earth/worldwind/layer/mvt/`；否则拒绝发布。

替换 7 个原类：`LabelDedup`、`LabelGeoDedup`、`Math`、`MvtCurvedLineLabel`、`MvtLabelCollider`、`MvtLabelCollider$Companion`、`MvtLabelColliderKt`。其中去重辅助类、Math 和 top-level 配置类随原文件一同编译，没有改其逻辑。

新增 5 个类：`AndroidMvtLabelMetrics`、`AndroidMvtLabelMetrics$cache$1`、`AndroidMvtLabelMetrics$Extent`、`AndroidMvtLabelMetrics$Key`、`MvtLabelCollisionMath`。

每次构建核验：

- 7 个原类的既有非 private JVM 签名全部保留，仅允许下文精确列出的 5 个新增方法；class header 和其它字段/方法不得变化。所有候选 classfile 为 Java 17。
- classes.jar 无删除，只有上述 7 个既有类可变化、5 个类可新增；原完整 `META-INF/earth.worldwind_worldwind.kotlin_module` 字节不变。
- AAR 仅 `classes.jar` 条目内容变化，其余资源、manifest、R.txt、assets 等全部字节不变。
- 原 POM 字节不变；module dependencies、attributes、variants、component 和 sources 记录不变，仅两处 AAR 文件 size/hash 更新。
- 20 项数学及实际原排字器用例通过，包括与原公式的常规输出对比、独立重复碰撞和超长屏外段的可见重复筛选。测试直接读取校验过的原 SDK classes.jar，不创建 Android 窗口。
- 加 `--verify-reproducible` 时，第二次全新 CLI 编译的全部类和重新打包 AAR 必须字节一致。

`source_fingerprint_sha256` 是按路径排序的四个生产源码 SHA-256 列表的摘要；另有包含脚本、测试、许可的 `build_fingerprint_sha256`。新 AAR SHA、原始 SHA、编译工具 hash、精确类清单及 ZIP 差异全部写在 `build-manifest.json`。

精确新增 JVM 方法（原构造器、属性 getter/setter、doRender 等签名不变）：

```text
MvtCurvedLineLabel.copyLayoutStatistics(long[]) : void
MvtCurvedLineLabel.prepareCollision$earth_worldwind_worldwind(RenderContext, AndroidMvtLabelMetrics, Object) : int
MvtCurvedLineLabel.copyRunBounds$earth_worldwind_worldwind(int, float[]) : void
MvtCurvedLineLabel.acceptCollisionRun$earth_worldwind_worldwind(int) : void
MvtLabelCollider.copyLineLayoutStatistics(long[]) : void
```

三个带 `$earth_worldwind_worldwind` 后缀的布局操作为 Kotlin internal，仅供 SDK 内部碰撞流程。构建脚本逐一比对上述完整声明和 JVM descriptor，不使用“允许任意新增方法”的宽泛规则。新增辅助类集合仍为原来 5 个，没有增加新的 glyph/窗口包装类。

## 主工程接入与验证边界

此目录不修改任何 app/settings/Gradle 文件。主工程只应在 `isolatedOldEngine` 构建中对 `earth.worldwind:worldwind-android` 使用这个本地 Maven 仓库的 `exclusiveContent`，保留正常版本和其它依赖解析。不要将覆盖类 JAR 与原 SDK 并列添加，否则会重复定义类。

本地 AAR 编译、ABI 和数学通过，不等于 Android 字体度量、截图或性能验收。接入后需比较同场景同倾角、字体缩放、山地贴地、路名旋转/重复残余冲突、注记开关和双图；并测量度量缓存开销。许可与修改声明应随最终分发保留。本补丁没有奥维代码，也没有私有图源凭据。
