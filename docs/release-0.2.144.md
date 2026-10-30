# 0.2.144-test 私人优化测试包

2026-10-30。用户要求尽快打包，已提供本机手机验证包；**不是“非常流畅”或Find X8内存退出已修复的验收结论**。

- 文件：`APK/Shantu-0.2.144-test-private.apk`，165099680字节。
- SHA256：`c6fd28c6b950aa2f1be4ac63c0dda41eb93e68078bbf67944d1fe4ae1d7cd747`。
- `com.guanyun.weather.shantu.preview` / `0.2.144-test` / code151，原4a94…6f9f证书、原桌面别名和存储兼容，可覆盖安装；重要草稿/记录先保存或导出。
- 原React界面与原生WorldWind地图；私人天地图/39图源、地形及既有资源保留。仅本机交付，不公开上传私人APK。
- 旧固定`APK/山兔手机.apk`仍保留142，原143也保留；用户请按文件名取144，避免装错。

本批修改：最新帧合并、普通浏览与实时任务分级、静置末帧补齐、相机写盘合并、有界后台DEM/吸附JSON编码；陡坡逆投影夹逼回退与DEM采样去临时分配；新增独立R8 optimized构建（非debuggable、不混淆诊断名、不缩资源、沿用原签名）。未实施后续只读审查提出的同帧camera/MVP绑定和touch门限前移，未改UI布局或用户存档。

检查：186项原生源码测试、42项相关Node、TSC、optimized构建通过；2165项ZIP CRC、1925份fresh React、私人配置/Key存在与一致性、原签名、64位ELF16KiB/zipalign通过。实际optimized包的天地图/3D/地形投影逆投影、系统bridge读取、原生320×320分享JPEG通过；没有做清空数据重装。

限制：共享GPU下单轮约30.7FPS，拖动峰值PSS325.9MiB、CPU30.8%，静置约303MiB/CPU0.1%；冷启另有493.3MiB样本。此条件不是公平FPS验收，不得只选择低内存或高帧率报告。debug长拖动曾出现停手CPU24.65%，另轮0.42%，根因仍未确定。optimized双图/绘制/全JNI路径、完整功能矩阵和Find X8真机均未验收。鸿蒙原生包仍未交付。

用户已选择保留Unreal运行、模拟器晚点再开；MuMu保持关闭。后续先按真实手机反馈定位，公平FPS、长时内存和首次联网加载分别复验。详见 `docs/native-android/performance-fix-144-20261030.md` 与 `artifacts/performance/mumu-144-20261030/`。
