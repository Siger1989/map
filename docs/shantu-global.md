# 山兔更名与全球地图入口

用户于2026-09-07将产品定位改为全球使用，显示名称改为“山兔”。网页标题、页头、手机应用名、记录通知、照片分享和导出文案已更新。左上角固定“成都 · 川西”地区区块已移除，保留读屏可用的地图加载状态。

没有坐标链接时，地图初始中心为经度0°/纬度20°，缩放1、俯仰0°、朝向0°；最低缩放从3降到0，可浏览世界地图。“查看世界地图”按钮返回此视角，替代强制回川西。手机竖屏可继续拖动浏览世界其他部分。带坐标的URL优先恢复原位置；用户可使用已有定位、搜索和地图操作进入目标地区，不自动请求定位权限。

现有Photon搜索仅使用查询词和当前视图附近排序，没有国家/省份过滤；路线、天气和地形按给定坐标请求。面向全球是产品和入口定位，不代表所有地区都有同等精度或离线数据：成都局部FABDEM增强瓦片及其真实署名/许可保留，其他地区走原Mapzen/SRTM路径；中国地质云等地区性图层保持覆盖和授权说明。

## 兼容与文件

- `config/product.ts`集中网页产品名/简介/照片导出前缀；`app/page.tsx`、`app/layout.tsx`、`mobile/index.html`和`modules/controls/workspace.css`更新名称/页头。
- `modules/map/types.ts`和`TerrainMap.tsx`更新初始视角、最小缩放与地图无障碍标签，不改变地形、路线、天气算法。
- 安卓Manifest/RecordingService/MainActivity/NativeBridge/PhotoShareProvider更新显示文案。`com.guanyun.weather.preview`包名、provider authority、`GuanyunNative`桥、User-Agent兼容标识与原公开签名指纹保持。
- `modules/photos/export.ts`、`outdoor/OutdoorPanel.tsx`、`outdoor/exchange.ts`、`annotations/AnnotationPanel.tsx`更新导出文件名或显示提示。数据库、本机存储键和`guanyun-backup`格式保持，旧轨迹、照片与备份可继续读取。
- `scripts/build-android.ps1`新产物名为`Shantu-<版本>.apk`；历史Release链接与旧安装包保持原名，不重新上传旧包充当新版。AGENTS、README、mobile/README、CURRENT_STATE和LOG记录新名称及验证状态。

移除了固定地区页头和相应样式，没有删除业务文件或已有本机数据，没有新增依赖或改服务凭证。回滚本轮源码可恢复旧显示，已有数据库无需迁移。

验证：类型检查、既有逻辑测试、390×844/360×780界面检查；世界地图初始视角、海外坐标显示与URL重载、世界视角重置、140项既有回归；网页与完整安卓未签名构建。最终结果见CURRENT_STATE.md。

同一0.2.5待签名源码，仍缺0.2.4原签名，未发布可覆盖新APK。安卓系统显示名称以Manifest构建结果为准，未连接真机验收。
