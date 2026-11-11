# 离路接入与导航视角反馈 · 2026-11-11

基于已交付的私人 0.2.201-test/code208；本轮仅修改源码和本机预览，没有更新 APK、升版、提交或推送。

## 根因与修改

- 用户室内启动路线，提示“附近道路无法接到当前位置或原路线”。求路层已经生成当前位置到可规划道路的 `access` 分段，接入校验却只接受道路吸附端点靠近原始端点，因此把合法虚线接入误判为断路。`guidance/rejoin.ts` 允许连续且明确标注的 access/road 链，检查真实道路端点、分段连续性及总几何一致性；无分段的远距离跳点、非法坐标、缺口仍拒绝。出发接起点和接回原路线共用校验，保留原路线及未到途经点。
- 主图/双图、原生主图及小地图原本保留 access；Android 悬浮/锁屏 payload 原本丢失分段，显示整条实线。补齐 `app/page.tsx` 重接会话、floatingNavigation/useFloatingNavigation、FloatingNavigationService/View 的分段传递与更新。road 保留原描边，access 单独黄色虚线且没有实线底描；旧无分段数据兼容。纯 road 不重复发送几何，含 access 的极端长路线仍受既有 4 MiB 限制，超限明确失败，不截断。
- 用户反馈“第一人称不明所以”：导航卡未知指令也默认显示大 Navigation 箭头，按钮只有小人图标。改为可见“前视/俯视”及选中变色，44px 点击区不变，辅助提示说明定位就绪后跟随；等待/失败/未知指令不显示伪方向箭头，明确转向才显示对应箭头。相机、真实定位门槛和路线预览功能未改。

## 证据

- 64 项导航接入、hook、路网接入、Web/native 几何和导航卡测试通过；另 1 项 forward-navigation-ui、14 项悬浮 payload/hook 通过。
- 非增量 TypeScript 检查通过。原生 Kotlin/Java 主代码编译通过。
- Robolectric 2 项隔离测试通过：捕获真实 Canvas drawPath，检查 road 三层实线、access 一次虚线且无实线底描，覆盖悬浮/锁屏、元数据变化与无分段回退。常规原生测试编译受已有 NativeCollectionTransformTest.kt 重复声明/语法错误阻断；临时 init script 仅限制本次测试源码后执行，不声称全套通过。
- 390 默认预览和独立 360x780：前视/俯视可点击切换，等待 IP 定位提示常显且无大箭头；实际卡宽约294/264px，高约96px，按钮约44px，无横向溢出。截图在 `artifacts/screenshots/navigation-access-20261111/`。360截图保存时显示俯视状态，前视由点击后 AX/computed 核验；390截图显示前视。保留默认右侧预览，独立窄屏页已关闭。
- 日志：`.openai/access-camera-20261111-tests.log`、`access-camera-forward-test.log`、`access-camera-20261111-tsc.log`、`floating-access-native-isolated-test.log`。

## 限制

未伪造设备位置；浏览器只有 IP 估算，不能验证真实室内道路接入。手机定位、真实道路服务和锁屏画面仍待真机。已交付 201 不包含本轮修复。天地图私人配置、39 种子、照片收藏格式、已有暂停记录及旧 APK 均未变更。

## 同轮追加：测距整条线清不掉

用户明确是整条测距线无法清除。原 clear 只清编辑草稿并解除 currentRecord，保存列表中的原记录马上重新参与 Web/native overlay 绘制，造成旧线复现。

- `useMeasurement/useSavedMeasurements`：清空当前草稿及对应的当前已保存测量；保留其他记录，精确保存删除快照供撤销，存储失败回滚。“新建测量”保留原存档，区别于清空当前测量。列表移除当前项同步清草稿。
- `Measurement/measurement.css`：主操作一排添加、清空、删除、撤销、保存；选点只选择并高亮，重选是明确操作，放完 B 点/替换完成不再持续覆盖当前点。地图点命中圆44px，操作按钮约54×36px。`ProjectionChart/README` 文案同步，拖动调整/更多重选。
- `app/page.tsx`：测量活动时不显示重叠在标题上的通用定位提示；测量退出后恢复原提示条件，定位权限/数据不变。
- 定向测量测试18/18通过，含保存、清空当前记录、撤销、其他记录保护、存储失败回滚及投影。修复旧 measurement-marker-delete 测试的 nodesInBox 导入路径到现有 trackNodeBoxSelection，未改路线框选生产逻辑。
- 实际390预览：放A/B两点→保存→清空后 SVG 端点0/线0/无已保存测量图层；撤销后端点2/线3/已保存记录恢复，数值不变。再次清空本次临时测试测量，不触碰既有记录。
- 390/360主操作无横向溢出，5按钮宽约54高36；360发现通用定位提示挡住标题，已修并重新截图 `measurement-final-360.jpg`。清空/恢复截图 `measurement-cleared-390.jpg`、`measurement-restored-390.jpg`。默认390预览保留在测量空态；窄屏临时页关闭。360未重复完整保存/撤销流程。
- 最终非增量TSC通过，私人native-hybrid网页构建7.87秒通过；本轮共97项JS定向和2项隔离原生检查通过。无新APK/安装/提交推送；手机原生清线与触控仍未验证。
