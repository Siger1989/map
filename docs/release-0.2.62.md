# 山兔 0.2.62 测试版：剖面与路线编辑互斥

修复剖面 A/B 点编辑时，点击地图上的路线会同时弹出路线卡、左侧行程栏，和底部剖面点编辑栏重叠的问题。剖面编辑期间只响应剖面点选；其他路线、区域、照片和标记不会抢走选择或启动拖动。打开剖面会收起已选路线；关闭剖面后仍能选路线。显式从列表打开路线则退出剖面编辑。地图图源和已有轨迹、剖面、照片、收藏及布局的存储格式不变。

## 安装与平台

| 平台 | 产物与安装 | 验证状态 |
| --- | --- | --- |
| Android 8.0及以上 | [Shantu-0.2.62-test-standalone.apk](https://github.com/Siger1989/map/releases/download/v0.2.62-test-standalone/Shantu-0.2.62-test-standalone.apk)，可覆盖同签名“山兔测试版” | 类型、逻辑测试、浏览器交互、构建/签名/资源检查通过；真机覆盖安装与触控待验 |
| HarmonyOS 6.1 原生 | 暂无 HAP/APP 或邀请链接 | 平台适配与安装验证未完成；Android APK 仅在设备支持时可兼容试装 |

包名`com.guanyun.weather.shantu.preview`，版本`0.2.62-test`、versionCode69，沿用既有`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`签名。源码位于`codex/rollback-ui-0235-20260921`分支，尚未合入main。

## 验证与限制

- TypeScript与615项逻辑测试通过。隔离9433浏览器390×857及360×780实测：路线→剖面、剖面中点路线、关闭剖面后再选路线均正常；无横向溢出或页面错误。截图`artifacts/screenshots/20260923-survey-route-exclusive-{390,360}.png`，用户9423标签未操作。
- Android网页、Java、DEX、APK全新构建；APK v2/v3签名、zipalign及473块随包地形瓦片通过。文件`APK/Shantu-0.2.62-test-standalone.apk`，57,826,396字节，SHA256`8d66fdedce361a9cd6cfd3df238a8f524783ed345caa793b28ebb277701f76d7`；同目录`.sha256`可核对。
- 浏览器模拟不能证明手机真机的点击热区、手势及覆盖安装效果；本版尚无Android真机或HarmonyOS原生验收。
