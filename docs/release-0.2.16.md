# 山兔 0.2.16 独立测试版（2026-09-09）

导航地址可以直接采用已有地图标记，选点时面板持续可见；普通地点图标增加指向实际坐标的箭头。修复地址搜索下拉框被通用毛玻璃样式覆盖、地图透出导致看不清的问题。

## 使用变化

- 起点、终点和途经点右侧显示“选点”。点击后高亮当前地址，直接点已有标记即可填入其名称与坐标；也支持地图空白处自由选点。
- 平移地图不会关闭选点面板。取消或Escape保留原地址，关闭面板退出选点；最多8个途经点时可滚动切换，当前地址和取消入口保持可达。
- 普通地点标记下方新增同色箭头，尖端对准真实坐标。保留原图标、颜色、名称和模型高度投影；选点结束后仍可正常打开标记摘要与编辑。
- 顶部及路线地址搜索结果改为不透明浅色背景，强化文字与分隔线。顶部下拉框不再套用透明玻璃滤镜。

## 平台与安装

| 平台 | 产物与安装方式 | 验证状态 |
| --- | --- | --- |
| Android 8.0及以上 | 下载`Shantu-0.2.16-test-standalone.apk`，从系统文件管理器安装 | 构建、签名、资源及浏览器验证通过；真机待验 |
| 兼容Android的HarmonyOS 4.2 | 可尝试上述APK，安装结果需设备实际反馈 | 未在P70 Pro真机验收，不宣称此前安装问题已修复 |
| HarmonyOS 6.1原生 | 本轮无HAP/APP或原生邀请测试链接 | 缺完整原生工程、工具链、账号签名和分发验证，仍未交付；APK不能替代原生包 |

包名`com.guanyun.weather.shantu.preview`，安装名“山兔测试版”，版本`0.2.16-test / versionCode23`。沿用本机已有4a94独立系列签名，可覆盖同签名0.2.15及此前独立版。与原系列0.2.14（`com.guanyun.weather.preview`、a3aa签名）并行安装，数据独立，不能直接覆盖；需要迁移时使用原应用备份/导入，不先卸载旧应用。

源码保留原系列包名/签名约束，本次通过`-StandaloneTest`构建，无新增密钥或签名变更。

## 文件与验证

修改`navigation/RoutePanel`、`useNavigation`与导航样式，`controls/ControlDock`与搜索样式，`map/TerrainMap`、`annotations/AnnotationLayer`与标记样式，首页接线和Android版本；新增[模块说明](navigation-map-picking.md)及发行说明。未删除业务模块，未改照片、GPS记录、存档/备份格式、路线计算、模型高度算法及用户指定Logo。

类型检查、341项逻辑测试、网页/Android网页/Java/APK构建通过。390×844和360×780检查通过，涵盖已有标记/空白地图选点、地图拖动、起终点/途经点切换、取消/Escape、10行地址滚动、退出后编辑和实色搜索结果。浏览器模拟不等于真机触控/GPS/性能验收。

- APK：57,607,900字节；SHA256：`2df7a5ca599d11650b585eaeda1a5a377491d5e9af96c8e6069776d53d637862`。
- 证书SHA256：`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`；v2/v3签名、zipalign及ZIP CRC通过。
- 526项网页资源逐项核对；470个经重压缩PNG解码相同，473个FABDEM地形瓦片齐全，Android图标与用户原Logo像素一致。无QA入口或私密构建文件。

[下载APK](https://github.com/Siger1989/map/releases/download/v0.2.16-test-standalone/Shantu-0.2.16-test-standalone.apk) · [测试Release](https://github.com/Siger1989/map/releases/tag/v0.2.16-test-standalone)
