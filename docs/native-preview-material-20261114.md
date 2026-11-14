# 安卓真实预览、共用材质和锁定标记（2026-11-14）

> 后续用户反馈“完全点不了、卡”：此截图方案未通过可用性验收，已撤出主预览，停止后台截图服务。当前右侧恢复明确标注的网页调色；原生页默认手动截图，未接通调色时显示说明而非禁用编辑器。新追加当前界面对象列表及尺寸调节见 `ui-context-inspector-20261114.md`。下文原先“接入”仅指能看到真实PNG，不代表实时交互或热调色完成。

## 范围与当前边界

用户批准：先把安卓模拟器真实画面接到右侧，再接共用参数，修标记退出跟随/方向、坐标背景过长及调色分类；保留当前配色，暂不打包。

实际工程 `D:/ShantuEngineResearch/old-engine-20261105`，分支 `codex/old-engine-tilt-dual-20261105`，开工 HEAD `b66c3bd`。`D:/天气系统` 是较旧源码，不能拿它代替最新工程。开工既有 Kotlin session 删除、吉林文件、图标研究等保持原样。

**实际画面已接入；当前 APK 的实时调色尚未接通。** 未生成任何新 APK（也未打包新测试助手），未升版、提交、推送。专用 MuMu3 原为 173，本轮覆盖安装本机既有私人203，保留数据；实际查询为 `0.2.203-test / code210 / com.shantu.oldengine`。用户手机安装版本本轮未读取。

## 已实现

1. `mobile/native-preview.html` / `nativePreview.js` 与 `scripts/android/native-preview-server.py` 提供实际安卓屏幕 PNG、点击、松手执行拖动、返回、暂停刷新、手动截图和重新连接。只监听127.0.0.1；输入带会话token和Origin检查，子进程参数不经过shell。
2. 右侧地址为 `http://127.0.0.1:9174/native-preview.html`，Vite把 `/native-preview-api` 转发到19374。没有在该页面加载网页地图；隐藏iframe只承载材质token以复用编辑器。截图保留1256×2760原始PNG，外部缩放显示。刷新周期含采集耗时，完成后再等待1.2秒；隐藏页面及暂停时停止后续采集，不是视频/设备FPS，也不支持连续实时多指回传。
3. `modules/appearance/materialRuntime.js` 定义 `shantu.material.v1`、36个允许的外观token和递增revision。App的AppearanceProvider安装同一运行时；临时修改使用可撤销style，不写用户业务存储或改个人预设。支持读取、应用、过期拒绝、CSS值校验、恢复；预览等App确认后才显示“已生效”，可以导出实际读回参数。
4. 测试助手新增受限 `material-read` / `material-apply` / `material-restore`，仅允许隔离包，固定token白名单，不接受任意脚本。助手和App必须都更新到本轮代码后，才能在设备端实际热调色。现有203/旧助手无此通道，页面显示保存基线并禁用调色，不能当成已同步。后续允许更新开发组件时再完成设备链路验收。
5. `app/page.tsx` 的锁定且记录中中心标记改为快速保存，不解锁、不切自由方向、不暂停跟随，不打开锁定CSS下不可见的编辑面板；提示3秒后清除，解锁后可编辑。非此场景保留原编辑流程。记录器本身未改。
6. `homeMap.css` 的坐标条撤销right约束，使用内容宽度、屏幕最大宽度及border-box，保留4px内边距。
7. 调色器次要按钮、输入底板、轻按钮分别可选；外框描边和内部分隔线分别可选。形状区域分成外框、内部按钮与输入、表面效果三组，固定8px输入圆角明确显示。保留既有7个上层类别和收藏/窗口联动；原session草稿键兼容，安卓参数宿主使用独立前缀。

## 配色与数据

`modules/appearance/savedMaterialPreset.json` 与开工HEAD一致，35个已保存token未改；读回外框23px、内部20px、固定输入8px。没有重新配色、清空手机/模拟器数据或改私人天地图配置。网页QA是独立Playwright会话；合成定位样本仅在该测试浏览器中使用，不是系统GPS、真机或模拟器GPS，不能作为定位精度证据。

## 验证表

| 项目 | 结果与证据 |
|---|---|
| 右侧真实设备画面 | PASS：CUA实际观察到本聊天IAB中安卓地图；标题标注203及源码差异。`artifacts/screenshots/native-preview-20261114.png` |
| 设备触控 | PASS（有限）：浏览器画面点击图层按钮后真实App图层面板出现，再执行返回；不是全部手势验收。 |
| 源码锁定标记 | PASS（网页测试）：390×约857与360×780实际操作保存标记、保持锁定/正北；390观察到跟随继续，后续样本后recording且点数3→4。`locked-marker-390-final-20261114.png`、`locked-marker-360-final-20261114.png` |
| 坐标宽度 | PASS（网页）：360视口实测173.156px，4px padding；390文本宽163.156px、框173.156px，差10px（内边距与边框）。长提示受最大宽度限制可换行，不裁字。 |
| 调色分类 | PASS（网页）：独立部位选择与三类形状fieldset可见，23/20原数值保留；`material-categories-20261114.png`。 |
| 共用运行时 | PASS（网页）：36token读取，外框临时改21px、过期revision拒绝、恢复后36token逐项相同。不是203设备通道验收。 |
| Node定向检查 | 22 PASS：material-runtime、preview-material-groups/contrast、focus-lock-visibility、center-marker-ground、follow-intent-hook。 |
| TSC | PASS。 |
| Android测试助手 | Java源码整体javac通过（已有弃用/Java8警告）；仅生成本地class，未d8/打包/安装新助手。 |
| Python/JS | Python AST与JS语法检查通过。 |
| 实时调色设备链路 | **未接通**：现有203/助手没有新协议，需后续更新开发组件，不可用网页通过替代。 |
| 本轮修复安卓效果 | **未验证**：没有新APK，本轮修复不在模拟器203或用户手机中。 |
| 运动/手机朝向模式、双图完整矩阵、OPPO真实后台记录 | **未验证**。 |

测试中两次等待快速合成位置更新超时：一轮受Vite热重载影响；后续一轮仍未在期限内更新到目标坐标，不能归为通过。之后独立更新新样本实际观察到4点、跟随/正北/锁定及recording均保持；不据此宣称所有运动采样已通过。

## 卡顿调查边界

用户反馈模拟器卡顿时，尚未启动连续预览。专用实例4核/4GB、1256×2760；当时Windows空闲约8.23GB，Android空闲约2.4GB，单次CPU快照大部分空闲。启动期gfxinfo有较长窗口帧耗时；模拟器该计数包含不可信GPU百分位，不能当原生地图FPS或唯一根因。未降低分辨率/清数据/改其它应用。当前采用低频PNG以限制额外采集负担，卡顿根因仍未闭环。

## 启动与继续

确认MuMu3身份并启动后查询实际ADB地址；本轮是 `127.0.0.1:16480`。不要把此地址硬套到其它设备。

```powershell
adb connect 127.0.0.1:16480
python scripts/android/native-preview-server.py --serial 127.0.0.1:16480
# 另一个终端运行项目既有私人预览（端口9174），API仍独立3108
npm run dev:apk-preview
```

后台启动用PowerShell `Start-Process -WindowStyle Hidden`，日志放 `.openai/`。19374不能被其它服务占用。当前网页预览为 `/phone-preview.html`，不得称为原生引擎画面；原生截图桥已停止，不再作为右侧默认入口。新参数通道使用测试助手时需ADB转发23458并启动其interactive-preview；现有旧助手不能因此自动获得新动作。

下一步：用户允许更新开发组件后，以当前源码更新测试App和助手，核对版本/私人配置/实际参数读回，再验证设备端热调色、三种非自由方向、持续记录及主双图。此前保持清晰的“源码已修/设备未更新”边界。
