# 山兔 0.2.75 测试版

本版纳入当前已授权的紧凑地图界面、路线编辑和天地图搜索修改：面板透明度统一，记录与照片入口压缩为紧凑页面，工具位于下方；剖面合并为底部卡，退出、切换目标和移动坐标显示简化；路线编辑按钮布局稳定，增加道路/河道吸附、修复同路线节点拖动吸附，路线详情可调粗细。收藏支持连续滑动选择/显示切换，折叠屏工具保持展开。

地图拖动时合并拖点更新，减少相机状态与遮罩的重复工作，补充 WebGL 恢复和图层顺序处理。国内地点搜索优先天地图，可切换全球 OSM；路线计算仍沿用现有服务。没有新增 Google 图源。

- APK：Shantu-0.2.75-test-standalone.apk
- 版本：0.2.75-test，versionCode 82
- 包名：com.guanyun.weather.shantu.preview；原独立测试版签名，可覆盖同包名旧版
- Android：8.0（API 26）及以上
- 大小：57,855,068 bytes
- SHA-256：4A18F85ED0691184D782FFE5152BC489AB6E9CEE89F545DC8E029C9AC2599495
- 签名证书 SHA-256：4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f

验证 PASS：TypeScript、678/678 测试、全新网页/Android 构建、v2/v3 签名、zipalign、473 张本地地形及修补资源、34 个网页 HTML/JS/CSS 资产与 APK 内容逐字节匹配。打包网页启动显示 0.2.75-test / 82，搜索入口默认天地图。

完整测试使用本机实际 JDK 和长路径 TEMP/TMP；桌面服务在 Windows 8.3 TEMP 别名下的目录检查问题未在本轮修改。打包网页 QA 静态服务器未接入 Android LocalGateway，网络高程缺块提示不能用作 Android 设备验收。

Android 真机触控、GPS、相机、覆盖安装、性能和闪烁仍待实测，浏览器验证不能保证真机帧率。HarmonyOS 6.1 原生 HAP/APP 未生成，不宣称 APK 可直接用于纯鸿蒙系统。

更新时选择安装/更新，不要先卸载原独立测试版。源码同步至 codex/rollback-ui-0235-20260921，未合入 main；精确源码提交与公开下载见本版本 GitHub Release 标签。