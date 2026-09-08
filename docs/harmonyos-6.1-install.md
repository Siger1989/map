# 山兔 HarmonyOS 6.1 适配与安装

用户已确认目标是朋友的 HarmonyOS 6.1 手机，希望直接分享安装，并明确要求原生鸿蒙包；具体机型未知，不以连接开发电脑调试为前提。以下状态核实于 2026-09-08。

## 当前状态

当前仓库只有 Android Java/WebView 外壳，没有 HarmonyOS 或 uni-app 工程，没有生成 HAP/APP 原生包。本机 PATH 和常见安装、用户配置目录未发现 DevEco Studio、HarmonyOS SDK、ohpm/hvigor/hdc。华为官方下载中心已跳转登录页；用户表示暂时无法登录，也没有或不确定是否已有实名认证的华为开发者账号。

本轮完成平台路线核查和说明，未完成原生代码适配、编译、签名或真机验证。不能把现有 Android 包视作本次原生交付。

## uni-app / uvue 能否直接转

用户提到的工具可能是 uni-app、uni-app x 或 HBuilderX。DCloud 官方确认，uni-app x 的 uvue/UTS 可以编译为鸿蒙原生应用；HBuilderX 能自动生成鸿蒙工程并调用工具链构建。

山兔的移动入口 `mobile/main.tsx` 使用 React，地图使用 MapLibre，并非现成的 uni-app/uvue 项目，因此仍需适配。基于官方 web-view 支持本地网页的能力，可优先验证一个独立 uni-app 容器，装入现有网页产物，保留地图和业务代码；这一方向尚未实现或验证，不等于所有功能已经兼容。地图页面仍由网页内核渲染，若要求全部界面改为 ArkUI 原生组件则需另行迁移。

HBuilderX 仍依赖 DevEco 提供的鸿蒙工具链。官方 uni-app x 鸿蒙指南明确没有提供鸿蒙云打包，证书自动申请也仍需华为账号授权。因此这条路线能减少工程搭建工作，不能消除当前工具下载及签名的阻碍。原生真机签名使用华为证书和 Profile，Android 签名不能代替。

参考：[uni-app x 鸿蒙开发指南](https://doc.dcloud.net.cn/uni-app-x/app-harmony/)、[HBuilderX 鸿蒙运行、构建与签名](https://uniapp.dcloud.net.cn/tutorial/harmony/runbuild)、[web-view 本地网页与鸿蒙支持](https://uniapp.dcloud.net.cn/component/web-view.html)。

## 适配顺序与验收

1. 取得官方工具链后，在独立平台目录验证本地页面入口、JS/CSS、WebGL、WASM/Worker、地图请求和地形资源；保留现有 React 和 Android 工程。
2. 为 `/api/terrain` 等本地网关和资源地址提供鸿蒙适配。现有 Android HTTPS 本地资源源不能直接假定在鸿蒙容器中存在。
3. 接入定位和后台记录、文件/照片、权限、分享与返回操作。沿用现有 `GuanyunNative` 的业务接口边界；它存在时记录模块会切换到原生轮询，故不能提前挂载只有部分方法的假桥接对象。
4. 核对打包配置、合法签名和产物，再完成 HarmonyOS 6.1 安装、地图/导航、文件导入导出、锁屏记录验证。成功打包不能代替真机验收，道路闪烁也需独立复测。

Windows 注意：鸿蒙生成工程路径应使用短的英文路径。仓库当前路径含中文；HBuilderX 4.61+ 可在本机 `.hbuilderx/launch.json` 配置 `distPathDev` / `distPathBuild` 指向专用构建目录。工具可能重建该目录，不能指向源码或用户资料目录；机器路径与签名材料不提交 Git。

## 给朋友分发原生包

朋友不连接开发电脑也有官方路线：开发者通过 AppGallery Connect 创建 HarmonyOS 邀请测试，朋友使用分享链接/邀请码参与安装。需要开发者账号及实名认证、可发布测试的原生应用包，并完成签名和测试发布流程；当前尚未配置这些条件，也未创建或发送测试邀请。

HBuilderX 的发行流程可生成签名 `.app` 包；调试流程可生成 `.hap` 包。产物能否直接安装仍取决于签名类型、设备范围及分发渠道，不能把签名发布包视为任意朋友都能双击安装的通用附件。

参考：[华为分发准备](https://developer.huawei.com/consumer/cn/appgallery/devstart/)、[邀请测试如何创建邀请码并使用](https://developer.huawei.com/consumer/cn/doc/doccenter-dev-faq/faqs-appgallery-22)、[发布证书的渠道安装限制](https://developer.huawei.com/consumer/cn/doc/doccenter-dev-faq/faqs-package-structure-65)。

## 备选：现有 APK 的兼容试装

[下载现有 0.2.7 APK](https://github.com/Siger1989/map/releases/download/v0.2.7-test/Shantu-0.2.7-test.apk) · [Release 与 SHA-256](https://github.com/Siger1989/map/releases/tag/v0.2.7-test)

1. 在朋友的手机浏览器下载 APK，保存后用系统文件管理打开。
2. 按手机实际提示通过卓易通支持的方式安装；能否安装以卓易通对该 APK 的实际支持为准。
3. 如果通过微信/QQ发送后扩展名变成 `.apk.1`，在文件管理里重命名，去掉最后的 `.1`，恢复原有 `.apk` 后再打开。
4. 安装后先确认地图能显示和缩放，再允许定位并检查路线导航、照片选择和文件保存。后台记录需要另测锁屏状态，不能由安装成功推断。

依据：[华为官方 HarmonyOS 5及以上应用下载安装介绍](https://consumer.huawei.com/cn/support/content/zh-cn16061787/)。官方明确支持分享 APK 的路径，也明确通过互联网/分享获得的 APK 是否能安装取决于卓易通实际支持。

本次提供的是已发布 Android APK 的**兼容试装路径**，未新增或重新构建安装包；不是原生鸿蒙 HAP，也没有完成 HarmonyOS 6.1 真机验证。0.2.7 不包含之后新增的记录颜色/线宽选择与道路诊断，地图闪烁仍待复现。

下一步需要取得官方工具链并完成独立容器验证，再办理签名/分发；当前原生包未交付。
