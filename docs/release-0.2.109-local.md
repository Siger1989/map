# 0.2.109-test 私有 APK（2026-10-06）

本版包含天气整组移除，并修复画线返回露出“新建轨迹”旧管理面板的问题，减少地图设置和布局变化时的重复工作。

## 产物

- `APK/Shantu-0.2.109-test-standalone.apk`；versionCode 116，包名 `com.guanyun.weather.shantu.preview`。
- 大小 66,081,340 字节；SHA-256 `30c034b43d831160dab8cc1253135af971bcb5ca91f5c24ff964c3c9401d7428`。
- 最终 stage `mobile/.build/apk-20261006-112230`；完整网页构建 8.72 秒，Android 构建 PASS。
- 构建基准 HEAD `1e9054ce8636de423669f51b718609ba99d62ed1`，功能分支 `codex/rollback-ui-0235-20260921`；本记录所在提交为本版交付源码，未合入main。私有APK仅本机交付，不公开上传含用户图源配置的包。

## 返回修复

旧逻辑并非双层UI残留：Android系统返回派发 `shantu-app-back`，经 `requestAppBack` 向页面派发 Escape；正在画线时页面调用 finish 并主动打开 TrackPanel，其首项就是“新建轨迹”。现在仅在实际 drawing 状态消费返回，暂停并回到地图，不打开该管理面板。

草稿及其长度保留，再点画线继续原草稿。非空草稿暂停后仍可显示正常路线草稿卡；再次返回关闭这张卡。暂停后 drawing=false，editing保留不会无限吞掉返回。正规轨迹管理功能和已保存轨迹编辑流程保留，未清除用户数据。浏览器以Escape覆盖相同页面处理器；手机系统边缘手势仍需真机验收。

## 性能优化

地图设置刷新此前重复同步整条路线、轨迹、区域、位置和剖面，而这些数据已有独立属性更新逻辑。现在初始加载仍完整同步，后续设置刷新复用各自更新路径；标记外观随设置变化的同步保留。

ResizeObserver的连续尺寸报告合并到一帧一次，采用最终尺寸；与已应用尺寸相同则跳过resize，卸载时取消排队任务。定向调度测试中三个连续报告只执行一次，之后相同尺寸不再执行。相机、像素比、底图质量和数据精度没有降低。现有相机100ms发布节流及轨迹增量更新已具备，不重复加入全局memo。未做量化浏览器FPS或手机基准，不能将减少重复工作写成实测帧率提升。

## 验证与证据

- 主代理最终 TypeScript PASS，14/14定向检查 PASS：原生返回桥接、尺寸调度/取消、收藏相机resize、相机发布与轨迹拖动。日志 `.openai/02109-final-tsc.log`、`.openai/02109-final-focused-tests.log`。
- 源码预览390×857及360×780：空草稿返回无旧管理面板；两点草稿566米/509米返回后长度不变，再次返回关闭草稿卡，继续绘制累计长度仍一致。只在隔离9176创建测试草稿，用户9174标记、轨迹和资料保留。
- 390源码预览地图拖动、放大/缩小、双图拖动与缩放、对比图层和退出通过；360图层道路开关往返后线条仍可见。两尺寸关闭当前草稿卡后隐藏界面/锁定/解锁可达；卡片可见时隐藏入口按规则不显示。
- 最终APK stage两尺寸画线→返回无旧面板、无横向溢出；360查看版本109/code116、双图上下地图canvas均360×320，设置下图图层并关闭退出通过。用户9174关于面板确认109/code116，内置图源配置与APK一致；保留其高德底图及原有数据，部分高程瓦片未加载仍有提示，不宣称网络地形全部通过。
- 截图 `artifacts/screenshots/draw-back-20261006/`：`before-360.png`为108旧返回问题；`paused-draft-390.png`、`paused-draft-360.png`为新草稿保留；`final-stage-back-390.png`、`final-stage-back-360.png`、`final-stage-dual-360.png`为最终109资源；`main-layers-109.png`为用户预览。机器可读记录 `.openai/02109-browser-qa.json`。
- 签名证书兼容、v2/v3、CRC、zipalign PASS；1907项stage/APK资源一致（1411项逐字节、496张地形PNG像素与非IDAT元数据），38私有图源种子、1365概览瓦片及预览/生产/包内Key一致性布尔核验PASS，未输出凭据。证据 `.openai/package-02109-verify.json`。
- 天气图层/雷达/云图/沿途天气/天气时间轴客户端标记继续缺席，地图MCP及109版本存在；`.openai/package-02109-feature-content.json` PASS。保留旧照片天气字段及通用兼容接口，详见 [108移除范围](release-0.2.108-local.md)。
- diff检查PASS；全仓architecture仍有10个历史超行数文件，无新增违规文件，新helper未违规，日志 `.openai/02109-architecture.log`。不能称全仓所有检查通过。

## 尚未验证

本轮adb无设备：真机安装、滑动返回、触控、GPS、朝向、后台与真机性能未验。旧删点/拖点后线条要缩放才更新的报告仍未定位修复，与本轮返回层级修复分开。此前MutationObserver启动异常来源尚未确定，不宣称所有页面零异常。HarmonyOS原生包未交付。

保留用户PDF、地质资料、私有配置、签名和所有旧APK。构建日志 `.openai/apk-02109-final-build-20261006.log`、验包日志 `.openai/package-02109-verify.log`。
