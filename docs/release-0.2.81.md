# 山兔 0.2.81 测试版

本版优化轨迹点绘制时的吸附候选搜索：普通点绘制与分叉绘制共用视口地理预筛和节点投影缓存，候选范围在屏幕边缘额外留 14 CSS px。高俯仰或视口估算不可靠时，回退到原有完整候选集和精确屏幕投影。该版本没有修复 TrackLayer 分叉按钮的全量切换问题，该项仍待处理。

- APK：`Shantu-0.2.81-test-standalone.apk`
- 版本：0.2.81-test，versionCode 88
- 包名：`com.guanyun.weather.shantu.preview`；沿用原独立测试版签名
- Android：8.0（API 26）及以上
- APK 大小：57,863,260 bytes
- APK SHA256：`5d110838e6060ba7071fd0e113e95d29efda66bda7c48327f6cc908e697b6d07`
- 签名证书 SHA256：`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`

验证 PASS：全量 719/719 测试、TypeScript `tsc --noEmit`、独立测试版 Android 构建、APK 签名和 zipalign；APK 内 543 个网页文件逐项匹配本次新 staging，496 张 terrain PNG（含 473 张 FABDEM 主地形瓦片）像素与元数据一致。包名、versionCode 与签名证书均已核对。

浏览器390×857地形40°视野范围生效，旋转45°更新范围/版本，分叉新增/撤销/不保存退出PASS；精确吸附由单元回归覆盖，OPPO真机吸附跟手及性能未验。高俯仰回退不代表所有地形或视角下性能均已验证。详见[性能证据与限制](performance-0.2.81.md)。HarmonyOS 6.1 原生 HAP/APP 尚未生成。
