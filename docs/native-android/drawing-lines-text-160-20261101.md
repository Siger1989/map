# 原生地图路线线宽、注记细节与绘制响应（160，2026-11-01）

## 路线类stroke缩放

160把路线类视觉宽度统一为用户基础宽度乘共享zoom因子：

| Raw zoom | 因子 | 解释 |
| ---: | ---: | --- |
| ≤6 | 0.25 | 远景保持较细 |
| 10 | 0.50 | 连续过渡 |
| 14 | 0.80 | 接近近景 |
| ≥16 | 1.00 | 保留用户基础宽度 |

中间按线性插值。网页MapLibre表达式将zoom置于顶层`interpolate`输入，stop输出为`baseWidth × factor`，符合样式表达式结构要求。原生在适当的camera zoom变化时更新路线、轨迹、导航提示及描边的宽度样式；不因每帧缩放重新发送路线几何。主线、access描边、保存轨迹/selected edge、导航线和cue ribbon使用同一因子。选中颜色识别保留，视觉halo/描边不再用固定增量；点选仍走独立12 CSS像素命中容差。

160原生fixture在已使用的QA地面上7个pose均精确匹配请求camera并通过各线层宽度断言，包含重复rotated zoom14/pitch55/bearing48、top zoom14、bearing0/90、zoom16/pitch62和zoom6/pitch50。独立合成origin冷启动pose在同为zoom14/pitch55/bearing48时曾立即读回zoom12.859/pitch21.868并FAIL；未将expected按读回值重算、未放宽断言。helper10在同一合成origin、地形DEM已就绪后，同姿态请求2/2 PASS；只记录约-4.8km anchor和eye高于地面约2.7km，不写测试坐标。没有证据确认SDK地形clamp或竞态为根因，旧冷启动FAIL仍保留。camera状态恢复PASS。合成fixture只验证输入几何到原生renderer，不证明完整导航UI、主双图或真实定位流程。

## 天地图高质量栅格注记

`NativeCartographyRasterQuality.detailControl`在HIGH为0.5，普通质量为1.0。影像和CIA/CVA/CTA栅格注记均沿用同一quality detailControl。baseline 159实际运行已确认影像detailControl=0.5而CIA为1.0；160对齐该配置，目的是避免两张栅格表面使用不同细节层级/取样比例。160运行时HIGH注记0.5数值PASS。最初约2.5秒截图仍呈现大号粗父级标签，记录为未稳定早期画面FAIL；相同zoom14/pitch44静置约1分钟后的lossless截图呈现更小、更多细节的标签。这个结果说明该时点完成了父子LOD替换，不证明字体大小/密度恒定或普遍加载速度提升。LOD调整会改变源标签密度和表观大小，也可能增加瓦片请求。供应商原始注记内容、透明度、默认图源与用户图层选择未改变；不会重绘注记图片内道路。

## 相机gizmo orbit/倾斜拖动位移整形

本轮修改的是相机gizmo的orbit/倾斜拖动路径：`shapeOrbitDisplacement`对SVG坐标位移使用`ORBIT_DEADZONE=1.5`，死区内输出零位移；之后在`ORBIT_EASE_RANGE=10`范围内由`ORBIT_LOW_GAIN=0.45`平滑增加到`ORBIT_FULL_GAIN=1.35`，超过缓动范围沿用完整增益。这样过滤近静止手指噪声并让小幅拖动更细腻，同时保留有意大幅拖动的响应。

环形方位拖动的`RING_DEADZONE=0.55`（按椭圆环归一化半径）是既有逻辑，本轮没有改动它。上述gizmo位移整形与地图渲染帧率无关。

## 道路吸附数据和显示开关

原生snap数据层有空样式，只服务有界道路/河流吸附缓存。普通道路、道路名称、地形等可见MVT层已经请求同源数据时复用其瓦片，避免重复启用snap层或重复绘制道路；道路显示关闭不应自动关闭独立的roadSnapping能力。道路/河流吸附启用且无其他可见MVT读取者时，才启用snap数据层。吸附能力与画面是否显示道路是两个状态，不能从道路层开关推断用户是否需要吸附。

159 baseline实测为empty draft、roads OFF、snapping ON、`hiddenSnapLayer=false`，界面提示要求开启道路。160 roads OFF + snap ON + node ON的实际runtime中，从914顶点真实缓存道路首点开始，沿路生成65点；held hint=`along-road`，结束提示不是crossing。路线相对首尾直连线的最大横向差约566.54m，root检查lossless截图确认为约3.1km长曲线。node-close另生成67点且终点精确匹配；用户own undo后draft=0、saved=0，状态恢复。旧第二轮同target曾得到3点但画面仍是864m直线，记FAIL；点数本身不作为视觉/吸附通过依据。

后续React路网修复保留同一snap revision下已经就绪的几何：当`sameSnapRevision === previous === frame`且旧READY数组非空时，incoming `loading`沿用原数组identity；revision变化、hidden、missing或blocked时仍清除。路径结果另以`roadPathDetailed`区分`ready`、真实`disconnected`和预算受限`limited`。预算仍为graph 3000 input边及`readRoad` 6000边，不通过增大预算掩盖问题。limited只有在snap快照ID相同且完整路线坐标与该line完全相同时，才使用match index/fraction在真实polyline上裁切，支持正反向并去重端点；否则提示放大地图并令`match=null`，不生成跨越连线。正常预算最短路、真正断路的显式跨越及strictRiver不跨越继续保留。第二轮虽返回3个点，实图仍显示直线跨越，属于FAIL；道路几何点数本身不能作为画面/吸附PASS。第三轮最终runtime已按上一段实际画面验收。该修复只改React路网逻辑，原生Java/Kotlin未改。

首轮160构建中的放大镜子模块40次MOVE对照中，159返回52个960×2048全图JPEG但只drawImage 2次；首轮160返回23个约310×309 ROI PNG、drawImage 22次且样本图像含723种不同颜色。最后一次capture为103ms。两种模式的样本data URL字符串长度记录为227862和674551，仍只是字符串长度，不是压缩后网络字节或可推广的吞吐倍率。整段运行9.7秒vs40秒受old R8与并行host条件混杂，不能解释为FPS或普遍响应时间改进。baseline 159只观测到2次绘制且有纹理像素，不能称其一直黑屏。最终包不是40次MOVE长序列复测；另有3次短手势测试、9/9 capture reply/render且有纹理。

## 点位放大镜的性能参数与代价

| 参数/代码位置 | 设置 | 作用与代价 |
| --- | --- | --- |
| `modules/map/native/magnifierCapture.ts` | single-flight；最小间隔125ms；错误重试750ms | 防止捕获、桥接和图像解码请求积压；连续移动时只保留最新点。125ms上限约8次/秒，不是FPS保证。失败会延迟重试，UI显示错误提示而不生成假图。 |
| `modules/map/native/NativeTerrainMap.tsx` | 以指针为中心的96×96 CSS ROI | 每次仅捕获小区域，降低整幅surface复制/PNG桥接负担；ROI按surface边界裁剪，换取边缘处源图可用范围变小。 |
| `NativeMagnifierRoiPolicy` (`mobile-native/.../hybrid/NativeMagnifierRoi.kt`) | CSS矩形乘当前`cssScale`并向外取整 | 生成PixelCopy物理像素范围及精确CSS映射，避免DPI缩放造成错位；高DPI下物理像素面积随cssScale平方增长。 |
| `modules/map/native/magnifierCrop.ts` / `PointMagnifier.tsx` | 32×32 CSS邻域绘到96×96 CSS显示画布 | 视觉放大3×；只放大捕获ROI内区域。显示canvas为192×192 backing pixels，CSS显示96×96。 |

因此成本由“更频繁抓取整幅地图”改为“限频抓取小ROI并解码/绘制局部图块”。在cssScale为S时，原始捕获矩形约为`(96S)²`物理像素，而不是整个地图surface；仍有PixelCopy、PNG编码/传输、图像解码及canvas绘制开销。4倍CSS scale时约147,456个源像素/次；125ms限频时理论上约1.18MPixel/s（不含压缩和额外拷贝）。设备上的实际耗时与功耗需实机测量。

helper-only input→SVG p95 3.3ms不包含完整React事件、bridge、PixelCopy、PNG、解码、Android渲染和合成，所以不能当作FPS或端到端延迟结论。设备/模拟器样本的103ms capture时间也不能代表端到端UI延迟。

## 160定向原生状态与UI验证

- 最终优化APK `Shantu-0.2.160-test-private.apk`为165171888 bytes，SHA256 `d2ce77c9bff7092631b70a78aaeece7173510f1321f8228962cacfa4a19f38b5`。177/177 Node、TSC、fresh React、optimized构建及包审计PASS。归档目标`山兔-0.2.160-test-2026-11-01/01-Android-APK`与固定APK/山兔手机.apk更新160；root已完成版本化、归档与固定入口逐份摘要核对。APK只用于本机私人试修，不公开；159/158/157版本化归档保留。
- 相机gizmo实际UI MotionEvent对照中，.5/4/6 CSS位移yaw分别0/3.765/7.553°，159为1.168/9.348/14.022°；释放后.1/.4/.8秒姿态稳定、yaw cleanup一致、pitch44保留。该结果不替代手机触控验收。
- 最终包放大镜短手势子模块测试为3次短手势、9个capture reply/9次绘制且有纹理。40次MOVE与159的长序列对照属于首轮160构建中的magnifier子模块，不是最终包的40次MOVE复测；首轮160 23个ROI PNG回复、22次绘制及103ms样本耗时见本机旧诊断。该耗时不等于端到端延迟或FPS。
- offline app真实受限fetch的car/moto车辆路网回归，两者均59.0825m、6个合成路径点PASS且cleanup恢复。首次cleanup错误来自QA等待静止SDK产生持续第二帧，helper改为requestRedraw等待实际帧后重跑通过，不是产品App冻结。详见本机`.openai/native160-offline-vehicles2.log`。
- 主双图/完整导航跟随及真实手机验收仍未完成。Library四图像素未在本执行环境读取，手机版本未知；不能声称已解决手机卡顿/闪烁。固定APK入口目标已指向160，最终复制和落盘核对完成。

## 验收边界

本执行器未读取用户4张Library截图的像素，不能指认照片中线条的层类型或声称已经逐图修复。用户手机当前版本未知；手机端卡顿/闪烁未验收，不能保证本轮已解决。最终APK复制到归档及固定入口后的核对完成。最终APK原生7姿态/133路径回归及相机、revision恢复PASS。主双图与完整导航UI未验收。当前私包不公开、不覆盖或删除159/158/157。

## 参考与核验记录

采用前核对官方接口：[Android PixelCopy区域捕获](https://developer.android.com/reference/android/view/PixelCopy)、[MapLibre相机表达式约束](https://maplibre.org/maplibre-style-spec/expressions/)、[WorldWind Path源码](https://github.com/WorldWindEarth/WorldWindKotlin/blob/develop/worldwind/src/commonMain/kotlin/earth/worldwind/shape/Path.kt)。已装SDK 2.1.1以本机AAR/字节码和真实APK核对，develop分支不冒充已装版本。最终脱敏结果见[summary.json](../../artifacts/performance/native160-drawing-lines-20261101/summary.json)。
