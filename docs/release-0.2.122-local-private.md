# 0.2.122 本机私有优化包（2026-10-13）

用户要求完成最终优化结果，不再逐轮安装诊断包。本轮已生成并核验 `0.2.122-test / versionCode129`，保持原独立包名 `com.guanyun.weather.shantu.preview`、原签名和存储格式。APK仅本机交付，使用已有天地图Key和39项图源；私有制品未上传到GitHub或其它服务。PC EXE保持暂停。

## 最终修改

- 普通浏览不再逐点建立仅用于节点预览的反向索引；相同轨迹状态及健康数据源/图层跳过重复全量同步。进入编辑或直接预览时按需建立完整索引，源/层替换可恢复。
- 单段路线不再建立无备选路径的图；无显式边色时直接使用完整原线。多段、闭环、重复点、未知备选、显式颜色、分析颜色、选中与透明度保持。
- 路线遮罩精确匹配签名按source同步失效并按需建立；tile片段投影和marker局部裁剪只在本帧复用。保留每hit的宽度、透明度、虚线与端帽，保留每个标记的精确局部查询。
- 本帧先读取所有标记及目标布局，再写变化的mask CSS；不跨帧缓存尺寸。二维无地形Mercator仅在相机、样式、路线tile或标记变化时更新，地形/倾斜及其它投影保留逐render刷新。
- 已有可靠heading时不再遍历导航整条路径；缺少heading仍按原路线方向计算。

未删除搜索历史、智能附近匹配、离线地点缓存、去这里、第一人称及俯视切换；未降低DPR、简化用户坐标或清除存档。没有修改Android原生定位、相机、后台记录或签名；native dex和地图worker与121一致。

## 检查

49项定向测试、tsc、fresh APK/Web构建PASS。旧overlay-data/route-node-join中6项既有mock/顺序失败在120归档也同样失败，详见 `mobile-performance-20261013.md`，未声称全套通过。

主审真实WebGL复验390×857与360×780：普通二维合成1万点路线，390无标记基线、两尺寸10标记交叠；路线完整显示、mask仅作用于标记、实际点击顶部标记得到合成ID，返回后实际点击未遮挡路线得到TrackLinePoint，返回可达。截图为 `.openai/map-stress-20261013/ui390-*.png`、`ui360-*.png`，仅本机QA。此轮未改布局CSS，矮屏原搜索/导航门禁沿用121记录；真机触控/GPS/后台/性能未验收。

电脑Node基准：10万点单段路线首次TrackLayer同步约941.7→33.0ms；同引用重复同步约0.025ms。真实GPU为GTX1660/ANGLE Direct3D11；高DPR合成压力里几何匹配p95 12.5→约0.5ms，重阻塞显著减少。IAB后台存在约1Hz RAF节流样本，已单独标明，不能把其RAF或Node结果当手机FPS；高密度路线仍存在渲染波动，不宣称恒定60FPS或真机已流畅。

## APK核验与本机入口

- 文件：原工程 `APK/Shantu-0.2.122-test-standalone-private.apk`；固定入口 `APK/山兔手机.apk` 已更新；各自 `.apk.sha256` 同步生成。
- 大小：70,244,537字节；SHA256：`c4e3e4a1430773877ac1f076ec5b60b1087a534b743eb85536a47d4f59022c75`。
- 版本/包名：aapt 122-test/code129及原独立包名PASS；minSdk26/target35。
- 签名：v2/v3 PASS；原证书SHA256 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`；zipalign PASS。
- 1934项ZIP/CRC PASS；473项基础地形构建核验PASS；Key存在、39种子与原输入字节一致；没有.env/jks/keystore文件。
- 原121版本归档hash仍 `cdff8703d96a8860f3e42321308f3d7d275c72a562dd870388081f7c10c89527`；recovery诊断包保留，未改存档、不要求卸载。

活动源码为 `codex/place-address-search-20261011`，基于de2775a加本轮源码差异构建；APK是在本轮源码提交前生成，不把包内基础Git标识称为最终提交SHA。同步仅源码/测试/文档；实际远端SHA由交付后核对。未合main，未发布含Key APK。Codex Dot当前工具没有任意APK上传入口，未声称云端已上传；原生HarmonyOS包仍未交付。
