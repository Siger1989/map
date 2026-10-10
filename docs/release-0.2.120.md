# 0.2.120-test / code127 构建与GitHub发布记录

**0.2.120-test/code127两份APK已构建核验。** 导航记录入口与路线遮罩修复已纳入本版。发行入口为固定tag `v0.2.120-test-standalone`，源码与公开资产的实际发布结果由远端tag及本机 `.openai/release-120-github.json` 核验。

## 目标版本与改动范围

- 实际 aapt：versionName `0.2.120-test`、versionCode `127`、package `com.guanyun.weather.shantu.preview`。
- 纳入发布后修复：导航记录快捷入口底部位置、海拔 dock clearance 状态，以及1×1 overflow marker 路线遮罩改为作用于可见子节点。
- EXE 保持现有 `0.2.118`，本轮不构建或替换 EXE。
- Android GPS、后台、触控和原生 HarmonyOS 仍未设备验收。

## 目标产物

私有用户包：

- `APK/Shantu-0.2.120-test-standalone-private.apk`
- 固定入口：`APK/山兔手机.apk`
- 两个私有路径不作为 GitHub 公开附件。

公开测试包：

- `.openai/release-120-public/Shantu-0.2.120-test-standalone.apk`
- 目标发行标签：`v0.2.120-test-standalone`
- 公共源码和资产不得包含私有 APK、Key 或私有默认图源种子。

发行入口：[v0.2.120-test-standalone](https://github.com/Siger1989/map/releases/tag/v0.2.120-test-standalone)。源码与公开资产的实际发行结果以远端tag及本机 `.openai/release-120-github.json` 核验。

## 已完成的源码与预览 QA

- 390×857 与360×780的导航布局实测来自先前原9174同origin源码编译预览：公开步行规划、开始导航、设置中关闭/开启海拔曲线及返回/收起；记录入口 `left=8px`。曲线打开时 `bottom=166px`、图表间距 `16.054px`、`--nav-info-clearance=110px`；曲线关闭时 `bottom=116px`，图表节点消失。单色模式下legend保留勾选时，profile关闭后重开可准确重挂曲线。此QA是源码预览结果，不作为120 APK完整导航布局复验。
- 真实 `RouteLayer` 隔离夹具pitch60°、bearing35°、缩放和平移：路线连续穿过3个DOM marker；helper对子节点遮罩，root/descendant统计 `0/3`，无 A/B fixture override。点击、清路线、清除/恢复 marker、切换样式及2D通过。
- 21项路线遮罩定向检查、全量 TypeScript 和 Web 构建通过；新增324/200行未超架构长度限制。10项历史架构预算超限仍为既有FAIL。
- 证据：`.openai/nav-record-layout-20261010.json`；`artifacts/screenshots/nav-icons-20261010/`；详情见[导航接续记录](navigation-follow-source-20261010.md)和[UI质量门禁](ui-quality-gate.md)。
- 120 fresh phone preview：[`nav-built-120-fresh-phone.html`](http://127.0.0.1:9174/@fs/D:/天气地图/.openai/nav-built-120-fresh-phone.html)，完成HTTP/MIME、页面`0.2.120-test/code127`、地图加载保留存档及关于面板检查；未在此页面重跑390/360完整导航布局。

## 产物与发行核验

|检查项|状态/实测值|
|---|---|
|公开APK|70,223,973 bytes；SHA256 `19e16d155e0f9c4b2154d6c2a7f3e204c16d4700041c47084808789d3de5711b`|
|私有APK与固定入口|两文件一致，70,224,057 bytes；SHA256 `f35e19eb6f2aa8eb40fd3d3541a8bba0c436e7fb4807a4cf69f110a952f728a2`|
|aapt版本、code、package|通过：`0.2.120-test` / `127` / `com.guanyun.weather.shantu.preview`|
|签名证书与0.2.119连续性|通过：私有/公开APK v2/v3签名均与0.2.119原证书一致|
|zipalign、ZIP完整性、应用资源/terrain|通过：zipalign；公开/私有ZIP项1933/1934；473项terrain|
|公开包不含Key/私有seed，私有包seed状态|布尔核验：public Key=false、seed=false；private seed match=true、Key presence=true|
|新鲜构建与源码检查|26项定向（21路线遮罩+5 APK配置）、full tsc、两次 fresh Web/Android构建通过；强化正/负控通过：`targetsByMarker` helper及新CSS只在120出现；119负控仍含旧record CSS，确认120已移除`home-recording bottom+94px`及left共享selector|
|GitHub tag与公开资产核验|固定tag为 `v0.2.120-test-standalone`；源码与公开资产实际发行结果由远端tag及本机 `.openai/release-120-github.json` 核验，不回写自引用source SHA|
|真实Android GPS/后台/触控及HarmonyOS原生包|未验证；HarmonyOS原生包未交付|

10项历史架构预算超限仍为既有FAIL；本轮新增324/200行未超限。EXE仍为0.2.118，未重建。公开APK绝不包含私有APK、Key或私有默认图源种子。设备连接计数为0，不将浏览器/构建结果写成真机验收。
