# 山兔 0.2.25-test：100条路线、分色分享与剖面钻井

## 本次更新

- 手绘/导入路线存档上限统一为100条，含节点编辑后另存。修复“完成”失败却无提示：成功后打开已保存路线卡片，容量或存储失败明确提示且保留当前草稿。
- 画线外侧加入紧凑的颜色、线宽和当前颜色路况备注。中途换色保留之前色段，新边使用当前颜色；原整条路线样式入口仍可主动统一改色。
- 连接保留原路线颜色和路况；“合并相接线路”将来源与连接副本的重复边去重，端点连续时成为一个连续存档。真实分岔或缺口仍明确拒绝。原绑定标记重新绑定合并路线，照片来源关联保留。
- 路线详情、统计和分享图片按颜色区分各段长度、海拔区域及路况。点色块突出对应高度区；同色路段共用备注，合并前不同备注会合并保留，合并后仍可编辑。
- 分享图片和二维码、完整路线包JSON均携带分段颜色和备注。二维码保护颜色分界点，容量不够时明确提示使用完整包。GPX/KML写入山兔扩展并可在山兔还原；其他软件识别扩展的情况取决于其支持。
- 选中剖面A/B/C等点后，“添加标记”在该点打开常规类型选择，可加地点、长方体、圆柱、球体、轮廓模型或钻井；绑定标记随对应测点移动，不再另选错误位置。
- 钻井独立选项和深度字段，剖面主图按深度向下画箭头、标注米数。未填深度或地形缺测时明确显示未知，不生成虚假深度。岩层分段编辑继续暂停。
- 横版平剖图设置可选水平比例尺，主图列出所有测点WGS84坐标，保留方向角（真北起顺时针）、等高线、图签和附表。固定比例按完整图宽420mm打印，纵向比例单独标注，不能容纳全线的比例禁选。
- 顶部可直接删除整条剖面及图纸，地图标记和模型保留并解绑；标记摘要、编辑和详情均有删除入口，确认后清理编辑状态。
- 左上角原山兔头像进入版本信息、构建号和8类使用教程，为后续设置独立留出模块。
- 收藏“地区”下取消多余的“未分组”层，内容直接列在对应地区，自定义组与原存储数据保留。

## 模块与接口

新增 tracks/mergeArchives、colorSections、ColorElevation、TrackColorProfile、TrackDrawingStyle、styleExchange；annotations/AnnotationTypeOptions；section/surveyScale；help/AboutPanel、tutorials和样式。业务接线在 app/page、TrackPanel/RouteViews/SharedTrackDetails、JourneyPanel、SurveySectionPanel/Sheet、AnnotationWorkspace/Fields；交换通过outdoor/exchange与routeShare各适配器，事务复用saveWorkbench。

扩展可选字段 colorConditions、borehole、SectionAnchor.stationId、survey.printScale，兼容旧数据。移除原20条手绘/导入容量门槛及地区视图多余层级，没有删除存档格式或照片。测量计算/手势、导航算法、定位天气、相机流程、原Logo未改；签名和包名沿用独立测试系列。跨模块回退应整体回退本版本业务提交，先导出JSON保留新增元数据。

## 验证

类型检查、420/420全量逻辑、网页与最终Android构建通过；v2/v3签名、zipalign、540项ZIP CRC、473地形资源和包内新增功能通过。APK 57686205字节；SHA256：786be8ac49127d7ca990d1fe3ed1c9ef93dab1c38451b0b6bf63c366a813df0d。

浏览器390×844、360×780实操：第21条正常完成；100条上限错误有提示，删除一条后同草稿重试成功；红绿原线与连接副本3存档合为1条连续线（795m红段、527m绿段）；修改备注重开页面仍保留。分享图生成、GPX/KML真实导入还原色段与备注、地区扁平化通过。

C点添加100m钻井及长方体坐标一致、无额外测点；主图1:10000、35.48°、各点坐标和100m箭头已核对，浏览器图片下载成功。整剖面删除保留标记，模型编辑中确认删除后窗口和模型清除。绘制工具360宽时222×112px，无页面横溢；剖面菜单与地图分离；头像教程可滚动查看。截图 artifacts/screenshots/ui-0225。

## 安装与验证边界

Android产物：Shantu-0.2.25-test-standalone.apk，版本0.2.25-test / code32，包名com.guanyun.weather.shantu.preview，Android8.0+，沿用4a94独立测试签名。可覆盖同包名同签名独立测试版；与原com.guanyun.weather.preview并存，数据不自动迁移，换系列请先导出JSON。

本机没有ADB手机，Android安装、手指拖动、输入法、系统文件选择器落盘及原生分享未真机验收。Android保存平剖图仍须在系统文件窗口选择位置后再点“保存”。HarmonyOS6.1原生HAP/APP未交付，本APK不是原生鸿蒙包。

同步分支codex/huawei-webview-touch，未合入main；测试标签v0.2.25-test-standalone。
