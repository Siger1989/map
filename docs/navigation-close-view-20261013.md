# 近景导航、定位恢复和偏航虚线 · 2026-10-13

> 2026-10-14交付更新：用户明确要求手机可下载APK，本页已验证源码进入125/code132私有包，原签名/天地图保留，Google Drive私有链接已交付。本页下方“未出包/未提交”均为10月13日预览时状态；最新文件、验证和源码同步见[125交付记录](release-0.2.125-private.md)。真实Android恢复/GPS仍待复测。

## 范围与状态

用户确认地图内近距离3D指引，并要求偏航接回路线为虚线；补充定位故障发生在锁屏或切应用返回。手机与PC共享源码更新，仍是快速视觉预览阶段。工作树 `.openai/worktrees/place-address-search-48c80e0`，分支 `codex/place-address-search-20261011`，基线 `7107a0b5deba47188951f35dc028a1a711810213`。没有升版、打包、安装、提交或推送。现有固定APK123/code130、EXE124/code131均不含本次修改；截图中已安装版本没有核实，不断言其版本。

9174依然是读取本机已有Key的APK预览，3108为独立API；内置天地图与本机39图源资产保留。只输出Key存在性。未清除用户存档、改变记录、覆盖路线或伪造用户GPS。测试使用独立浏览器profile及标为“模拟导航 · 非真实GPS”的隔离夹具。右侧原390×约857手机框、视角与存档保留。

## 设计依据

参考[Mapbox导航相机](https://docs.mapbox.com/android/navigation/guides/ui-components/camera/)中跟随位置、路线前方和视口避让的设计，以及[高德矢量路口指引](https://lbs.amap.com/faq/android/navi-sdk/navi-mode/43095)。本实现沿已有真实规划几何绘制箭头，不生成未知车道，也不使用摄像头AR。

## 修改与根因

- `GuidanceCard.tsx`、`outdoorSurfaces.css`：旧第一人称入口没有选中反馈且只能开启。现在图标、文字和边框点亮，近景/俯视可双向切换，等待定位时灰色“等待”；偏航卡显示“沿橙色虚线接回原路线”。
- `forwardCamera.ts`、`app/page.tsx`：原模式只倾斜不放大。现在60°，定位置于可用视口下方72%；显式进入/恢复与首个可靠fix才设近景级别（驾车17.4、骑行17.8、步行18.2），随后定位更新保留手动缩放。信号失效点击模式会请求准确定位，不跳回路线起点。
- 新增 `NavigationCueLayer.ts`、`navigationCueGeometry.ts`：沿当前路线/接回路线前方最多5组箭头，限定约20–172米、zoom14以上；可靠定位且前视跟随才显示，定位中断或俯视清除。路线预览仍明确属于非定位预览。缓存累计路径并用二分定位近段；10万点路线已初始化后的更新读取少于1000次坐标，不对整条路线重复采样。
- `GuidanceLayer.ts`：橙色接回主线与外描边统一15px线段/10px透明缺口，butt端帽；只改临时接回源，原路线不变。道路外描边的dash必须按9px线宽折算，与5px主线同周期，避免填平虚线间隙。
- `overlayData.ts`、`PositionLayer.ts`、`RouteLayer.ts`：旧路线最终图层盖住定位符号。增加导航箭头与当前位置的顶层例外，准确度圆仍在路线下；导航定位符号采用蓝白箭头；仅导航时40米内重叠的起点标识隐藏，离开/结束后恢复，原始路线与端点数据不变。
- `session.ts`：外部定位错误消失后，同时间戳的有效fix被当成重复更新直接返回，残留quality导致cameraFix始终为null。新增明确的错误来源标记；同时间戳、同坐标且仍新鲜的已接受fix可清除外部错误，不重复计里程，也不清掉精度不足/跳点/过期错误。
- 新增 `navigationCamera.ts` 并接入 `TerrainMap.tsx`：浏览器复现近景动画完成后地形高度仍冻结在0、投影落在屏幕外，导致黑图。按已安装MapLibre的实际行为，先读取真实DEM高度并传递程序移动标记，再以`freezeElevation:true`确保动画结束/被新fix打断时释放冻结。冷DEM使用立即定位，避免DEM在海平面动画中途到达导致近景钻入地下；热DEM保留动画。[MapLibre公开相机API](https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/)与[动画选项](https://maplibre.org/maplibre-gl-js/docs/API/type-aliases/AnimationOptions/)作为接口依据。

`TerrainMap`的新props由双图宿主克隆传递，PC复用同一实现。未改Android权限/后台服务、记录数据、输入法、远处标记剔除、图源配置及地名清晰选项。

## 验证记录

|检查|结果与证据|
|---|---|
|手机390×857、360×780、390×480，PC1366×900|每尺寸近景/俯视/偏航/中断/恢复共20态；真实TerrainMap与GuidanceCard、天地图影像、公开演示路线，PASS（模拟）|
|近景与状态反馈|60°、步行约18.2级；近景黄绿rgb(208,247,107)，俯视浅色，等待灰色；真实点击命中、无横向溢出，PASS|
|定位与箭头层级|定位在路线和虚拟箭头上；正常最多5箭头，接回样例3个；中断/俯视为0；起点重叠隐藏与离开/停止恢复，PASS|
|偏航虚线|透明缺口匹配实际线宽，真实截图显示橙色断续线、蓝色原路线完整，PASS|
|手机展开/收起|三尺寸外框8px、border-box、正文约216px；关闭/收起可达，实际点击返回，PASS|
|逻辑与类型|57项定向、全项目tsc、客户端Web构建PASS；另定位源14项、导航恢复35项为部分重叠审查，不累计宣称总数|
|旧测试修正|HEAD隔离复现overlay-data原5/6 FAIL，因mock缺layer.type并仍按旧层序断言；按真实MapLibre类型和现有层序补正后全部PASS|
|锁屏/切应用后返回|源码核对MainActivity pause/resume、native轮询、session质量恢复；发现并修复JS残留错误，未找到可证明的原生watch故障。Android设备复测未验证|
|设备与双图|真机GPS/后台/触控/帧率、完整双图状态和Windows原生壳未验证；不以模拟定位或桌面浏览器替代设备验收|

主审证据 `.openai/nav-close-20261013/visual-evidence.json`、`expanded-evidence.json`、`tests.log`、`tsc.log`、`web-build.log`。截图 `artifacts/screenshots/nav-close-20261013/`：`390x857-near.png`、`390x857-rejoin.png`、`360x780-lost.png`、`390x480-near.png`、`1366x900-rejoin.png`等。该目录的first/second图片为相机根因修复前FAIL，不作最终证据；`terrain-camera-check.png`为隔离验证，不冒充最终主界面。

## 再次测试条件与下一步

用户确认预览效果后再按明确交付要求构建新APK/EXE。真实手机使用新包时需分别测：正常导航→锁屏约30秒→返回；切其它应用→返回；信号暂时失效→恢复；偏航→虚线接回→回到原线；第一人称/俯视切换和主动拖动后恢复跟随。记录系统版本/应用版本、定位权限及错误文案，不用浏览器IP估计代替GPS。新代码尚未进入安装包或GitHub，既有7107a0b远端提交仍是上一轮成果。
