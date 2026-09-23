# 山兔 0.2.64 测试版：框选对象类型筛选

地图框选操作框增加对象类型下拉菜单，可选择全部、地点、模型、区域、剖面、路线、轨迹或测量。新框只命中选定类型；切换到某一类型时，已选结果里的其他类型会移除，避免后续导出、分享或删除混杂。加选、减选和退出后保留选择的现有行为不变。此包也包含0.2.62剖面/路线互斥和0.2.63标记自定义条目中文输入、WPML KMZ导入修复。

## 安装与平台

| 平台 | 产物与安装 | 验证状态 |
| --- | --- | --- |
| Android 8.0及以上 | [Shantu-0.2.64-test-standalone.apk](https://github.com/Siger1989/map/releases/download/v0.2.64-test-standalone/Shantu-0.2.64-test-standalone.apk)，可覆盖同签名“山兔测试版” | 类型、逻辑测试、浏览器交互、构建/签名/资源检查通过；真机待验 |
| HarmonyOS 6.1 原生 | 暂无 HAP/APP 或邀请链接 | 平台适配与安装验证未完成；Android APK 仅在设备支持时可兼容试装 |

包名`com.guanyun.weather.shantu.preview`，版本`0.2.64-test`、versionCode71，沿用既有`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`签名。源码位于`codex/rollback-ui-0235-20260921`分支，尚未合入main。

## 验证与限制

- TypeScript、618项逻辑测试、网页构建、Android打包网页启动检查通过。隔离9433浏览器390×857、360×780实际打开框选类型下拉并选择“地点”；操作框高度小于200px，无横向溢出。截图`artifacts/screenshots/20260923-box-type-filter-{390,360}.png`。未操作用户9423标签。
- Android网页、Java、DEX、APK从本轮源码重新构建；APK签名、zipalign及473块随包地形瓦片通过。文件`APK/Shantu-0.2.64-test-standalone.apk`，57,826,396字节，SHA256`41fab1fb6f0c49860597b115a53e6ff5026e5560acf7a9219ed7000a048972b6`；同目录`.sha256`可核对。
- 浏览器模拟无法代替真实手机触控、中文输入法、微信文件关联与覆盖安装测试。标记Excel导入/回填条目尚未实现，本版现有XLSX导出不变。
