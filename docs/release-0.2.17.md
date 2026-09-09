# 山兔0.2.17独立测试版

本次修复HarmonyOS4.2.0.189手机打开后被“需要更新系统网页组件”页面挡住的问题，以及画线时先落下一根手指导致双指缩放失效或留下误画的问题。

- 移除按WebView厂商包版本首段小于120就禁止启动的判断。应用先补齐旧组件缺少的接口，按真实WebGL2和Worker能力加载地图，不要求升级手机系统或安装谷歌组件。
- 手机网页和地图后台worker按Chrome99编译；兼容网络请求取消、面板高度、旧选择器及收藏颜色。真实图形启动失败可重试并查看兼容信息，不隐藏故障或伪造地图可用状态。
- 单指落下保留120ms手势识别窗口，期间移动采样会完整回放。第二指在窗口内或之后加入都可交还地图缩放/旋转，取消当前未提交笔画；已松手提交的路线保留。双指减为单指不会意外继续画线，全部抬起后才恢复。

## 平台与安装

| 平台 | 安装方式 | 状态 |
| --- | --- | --- |
| Android8.0及以上、具备可用WebGL2 | 下载本发行的APK，从手机文件管理器安装 | 构建与验证结果见下方；未进行真机验收 |
| 截图所示HarmonyOS4.2.0.189 | 使用同一个APK，保留当前系统 | 已针对截图中的应用拦截修复；朋友手机安装后地图/触摸仍需反馈 |
| HarmonyOS6.1原生 | 本轮无原生HAP/APP或邀请测试链接 | 此前原生适配、工具链、签名分发任务仍未交付，不能用APK代替 |

版本`0.2.17-test / versionCode24`，安装名“山兔测试版”，包名`com.guanyun.weather.shantu.preview`。沿用4a94独立系列证书，可覆盖同签名0.2.16等独立测试版。与原系列`com.guanyun.weather.preview`并存、数据独立；不先卸载旧版，迁移数据使用原应用备份和新版导入。

源码从0.2.16交付后的76b57ba建立`codex/huawei-webview-touch`修复分支，只包含兼容性和手势修复。用户尚未确认的收藏工作台预览、其他导航/标记草稿和六个鸿蒙草稿留在原工作区，不混入本APK。

## 模块、验证和产物

新增`modules/compatibility`、手机启动/布局适配、CSS和worker构建适配、兼容与手势回归及浏览器测试夹具；修改`MainActivity`、APK版本、手机入口/Vite配置、`DrawingGestureBridge`和依赖锁文件。删除旧的版本号拦截，没有删除业务或用户数据；定位/GPS记录、导航服务、存储与备份、Logo、签名接口保持不变。

351项逻辑、类型、网页/Android网页/Java/APK构建通过。使用最终APK构建目录的网页资源，在真实Chromium99.0.4812.0和当前Chrome上验证390×844、360×780：地图正常显示，收藏/路线面板可打开、无横向溢出；旧内核的关系选择器、视口和网络取消适配生效，原生DOM选择器接口保持完整。

使用同一手势模块的独立真实MapLibre夹具发送触摸事件：两指相隔40ms和220ms落下，zoom从12变为约12.82，未提交误画线段；全部抬起后的新单指点按恢复。精确120ms边界、移动采样回放、取消及已提交几何保留有逻辑回归。浏览器注入触摸不能代替朋友手机的手感、驱动、GPS或性能验收；ADB未发现设备。浏览器预览部分API未连接，只把底图/布局/手势验证作为通过项，不宣称全数据源在线通过。

- APK：`Shantu-0.2.17-test-standalone.apk`，57,620,669字节。
- SHA256：`46f956d89cd558d10f76af5cdea0531d2adbfab8dd74b502edf86bde411ca3f2`。
- 证书SHA256：`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`；v2/v3签名、zipalign与ZIP CRC通过。
- 532项网页资源：62项字节相同，470个优化PNG解码像素相同；473个FABDEM瓦片及原Logo保留。最终APK无QA入口、密钥或环境文件。

[下载APK](https://github.com/Siger1989/map/releases/download/v0.2.17-test-standalone/Shantu-0.2.17-test-standalone.apk) · [测试Release](https://github.com/Siger1989/map/releases/tag/v0.2.17-test-standalone) · [源码修复分支](https://github.com/Siger1989/map/tree/codex/huawei-webview-touch)。本次源码推送该分支，未声称合入main。
