# 山兔·优化 0.2.198 私人测试版

包名 `com.shantu.oldengine`，`0.2.198-test / code205`，沿用原签名与本人天地图/39种子；197和历史包独立保留。此版仅修原生地图两点吸附的模式判断，保留197其余功能、存储和私人配置。

## 反馈与确证机制

用户已明确“远”指两个点相隔较远，且预览阶段就偏线；不是单纯拉远地图。吸附依据真实道路/河流水系矢量线，底图只是背景，不能靠换底图解决此处模式错误。

原生 `NativeTerrainMap.tsx` 对同一feature直接调用 `roadSection`：超过128个中间点，或累计屏幕路长超过两端直距4倍+32px时拒绝。这是手绘防突然绕行的保护，却也被套到逐点模式。失败后道路的既有断路跨越功能可能生成两端直线预览、偏离弯曲原线；河流严格模式则阻止接续。这是可重现的源码机制，未读取手机版本/截图，不能保证它是手机偏移的唯一原因。

## 最小改动

- `RoadSnapper` 增加可选mode参数；`DrawingSession` 显式传points/freehand，主图/双图的app适配透传。旧调用不传mode仍用原保护，编辑节点无from时逻辑保持。
- 新增 `modules/map/native/roadContinuation.ts`：两点模式走原有受限真实路网求解 `roadPathDetailed`，保留中间矢量顶点；手绘同feature保留128点/防误跳保护。道路与河流复用此入口，不扩大抓取/CPU预算，不增加猜测平移或伪造连接。
- `NativeTerrainMap.tsx`接入共享入口，原局部两路真实连接fallback保持；未改原生Kotlin地图/投影、MVT解码、GPS、照片与既有文件。
- 新增 `tests/native-road-continuation.test.mjs`，4项覆盖200条合成feature边逐点接续、绕行与手绘保护区分、道路/河流实际DrawingSession预览和提交保留全部200边、freehand显式mode。

## 验证及边界

59项定向Node全过，TSC通过。测试先复现旧 `roadSection` 拒绝200边，再验证新points模式与真实 `DrawingSession` 预览不走crossing、释放后section/vertex一致，河流同过；手绘原hairpin拒绝保持。日志 `.openai/snap-distance-20261110-node.log`、`snap-distance-20261110-tsc.log`。未用网页测试代替Android或OPPO验收。

本次没有修改6000点解码、3000点建图/150000 endpoint checks/4000扩展预算。跨多个feature的复杂网络仍可能受限；当前路网是已加载视口数据，不是任意长距离全图寻路，起点/连接区域无数据时不能保证成功。失效输入/预算失败不得声称沿路成功。

另发现的天空角落使视口无效、以及上游原生Path插值差异均未纳入此包：用户澄清不把这两项冒充本次根因，临时viewport helper/test已移到 `.openai/snap-horizon-separate-20261110`，没有改Host或打入包。预览偏移其它可能性仍待真机复测，不宣称整套吸附全部通过。

## 交付

最终包正在构建核验。安装前保存草稿并结束记录，覆盖安装“山兔·优化”，不要卸载清数据。Android8及以上；账号好友仍暂缓，HarmonyOS6.1原生包未交付。手机自定义“增强”未读取/重置，实际升级保留未验。
