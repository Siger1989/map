# 山兔 0.2.79 测试版

本版调整路线分叉绘制输入：每个动画帧只处理最新的触摸/鼠标位置，松手会处理最后一个待处理位置；双指导航、取消和镜头移动会丢弃待处理位置。节点吸附建立屏幕空间网格并缓存当前绘制手势中的候选投影，查找附近节点时不再为候选范围额外执行每次移动都需要的 5 次 CPU 地形反算。

相机摇杆的连续更新共用同一 easeId，合并相机移动结束事件；地图保留原生分辨率并关闭多重采样抗锯齿（MSAA）。

- APK：`Shantu-0.2.79-test-standalone.apk`
- 版本：0.2.79-test，versionCode 86
- 包名：`com.guanyun.weather.shantu.preview`；沿用原独立测试版签名
- Android：8.0（API 26）及以上
- APK 大小：57,859,164 bytes
- SHA256：`48B14C24737A4A4C55ADEC2BE1C95B0239643951F141E49D1FAE8AF6A2FB57B3`
- 签名证书 SHA256：`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`

验证 PASS：695/695 测试与 TypeScript；独立测试版全新 Android 构建；APK v2/v3 签名及 zipalign；包内 543 个网页文件与构建暂存逐项一致，496 张 PNG（含 473 张主地形瓦片）像素与元数据一致。原独立测试证书 SHA256 为 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`。

OPPO Find X8 Ultra 等 Android 真机上的分叉跟手、三维相机旋转/缩放/平移、渲染质量、触控与覆盖安装尚未验收。浏览器或 APK 构建验证不能代替真机性能验收。HarmonyOS 6.1 原生 HAP/APP 尚未生成。
