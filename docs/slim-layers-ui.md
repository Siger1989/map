# 更细的图层列表与参考

2026-09-07。用户指出图层控件仍太宽、太厚，本轮在已有磨砂样式上继续压缩。

## 已实现

- 图层浮窗最大宽度从 304px 改为 248px，圆角从 22px 改为 14px。
- “内置地图”改为和图层对齐的单行入口，去掉大胶囊底色，用细分隔线组织列表。
- 常用标签 12px，图标 16px、1.65px 描边；开关可见轨道由 36×22px 缩至 28×16px，圆点 12px。
- 以鼠标为主要输入且支持悬停的设备使用 32px 行高。触控为主要输入的设备保留 44px 开关点击区域，开关外观仍是细款。
- 保留图源返回、关闭、图层切换、展开参数、磨砂背景与原绿色 3D 控制器。变更仅在 `modules/controls/modern.css`，没有调整地图服务、存储或渲染逻辑。

## 网上参考

1. [Mapbox Studio](https://www.mapbox.com/mapbox-studio)：可借鉴紧凑的地图编辑面板与小控件；[官方图层说明](https://docs.mapbox.com/console-tools/studio/studio-interface/)介绍图层列表、显示隐藏、分组等操作。适合本应用的高密度工具页。
2. [Glare — AR Mountain Navigation](https://dribbble.com/shots/26827934-Glare-AR-Mountain-Navigation-App-UI)：作者介绍的户外磨砂概念方向，可供透明浮层和户外视觉参考；属于设计概念。本机浏览器触发 Human Verification，未完成整页视觉检查，保留原文供用户查看。
3. [CalTopo 图层菜单新旧对照](https://blog.caltopo.com/2026/01/07/updated-feature-improved-map-layers-ui-and-the-new-layer-catalog/)：官方展示常用菜单与完整图层目录分离，可按需要隐藏菜单项，适合图层继续增多后的组织方式；本轮没有引入新的目录设置。

建议后续以 Mapbox 的列表密度结合现有磨砂质感，保持地图优先。参考产品仅用于界面研究，不代表更换底图服务或获得图源授权。

## 验证

- PASS：TypeScript，网页与安卓网页构建。纯 CSS 范围未新增逻辑测试。
- PASS：598×628 同视口前后截图对照，浮窗 304→248px、行约45→32px。开关真实点击开/关、图源进入/返回、关闭均正常。
- PASS：390×844、360×780 窄屏 DOM 无横向溢出、所有图层名称完整；海拔着色展开后的滑杆未产生内容溢出。
- 截图：`artifacts/screenshots/layers-slim-before.png`、`layers-slim-after.png`、`layers-slim-390.png`、`layers-slim-360.png`；日志 `.openai/*slim-layers*.log`。
- 窄屏检查仍使用桌面鼠标输入，未模拟真实触屏硬件；手机截图存在既有缩放捕获异常，精确手机视觉与真机触控待验收。未生成 APK，现有安装包不包含本次改动。
