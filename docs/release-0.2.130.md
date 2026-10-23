# 山兔 0.2.130：高清、导航与输入法避让

2026-10-23 用户要求打包当前源码。Android 版本为 0.2.130-test / versionCode 137，沿用独立测试包名 com.guanyun.weather.shantu.preview 和原签名；129 归档保留。PC EXE 仍为128。

## 本次纳入

- 自动标准/高清档位与蓝顶白地平线天空；相机缩放不因切换画质改变。
- 导航重规划仍展示原起点；导航数据去重、左侧进度和锁定速度条。
- 记录权限错误红色、定位提示轻量化、画线工具紧凑布局。
- 键盘焦点避让、嵌套滚动、联想框跟随，以及矮屏标记末行可达。

具体文件、根因与前轮完整状态矩阵见 [高清与天空](quality-sky-20261023.md)、[导航起点](reroute-origin-20261015.md)、[界面与输入](ui-feedback-20261023.md)。本轮仅调整 AndroidManifest 的版本字段；既有上述源码改动全部进入新包。照片、轨迹存储格式、签名与用户私有配置保持。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| 定向测试与类型检查 | keyboard-focus、raster-quality、raster-level、map-layer-preferences、guidance-reroute-hook、navigation-card，32/32；tsc PASS |
| fresh 构建 | 私有、公开分别构建，未用旧 mobile/dist 冒充；版本137、包名、原证书、zipalign、ZIP CRC PASS |
| 资源一致性 | 私有1926项、公开1925项与各自stage匹配；497张PNG像素一致 |
| 私有配置 | 自用包保留既有天地图Key和39项图源；公开包无私有seed且敏感值匹配0 |
| 主审实际网页检查 | 9174当前源码的天地图画面/高清菜单/关闭返回；从私有APK解出的资源在390×857内置分类选择天地图、影像显示，在360×780高清菜单与关闭返回，实际截图 PASS |
| 限制 | 网页检查出现部分高程瓦片未加载提示；浏览器定位失败/IP估计不视为真实GPS。没有Android安装、原生输入法、后台、真实触控和帧率验收 |

最终资源截图在 artifacts/screenshots/release-130/。本机完整日志及逐资源验证结果保存在 ignored 的 .openai/release-130/，不提交日志或私有凭据。

## 安装包

| 产物 | 字节 | SHA256 |
| --- | ---: | --- |
| 自用 Shantu-0.2.130-test-private.apk | 70269113 | bb964b4a437e84ed0c9a771820c64cc085d1e4e324a26b4c53af845972682c53 |
| 公开 Shantu-0.2.130-test-public-standalone.apk | 70269029 | aa4a2a65f71486e67471ddfa33b2d57a52bedde387bd0463ed5fe57afd4ba2af |

固定 APK/山兔手机.apk 与自用包哈希一致，不能用无Key公开包覆盖此入口。公开GitHub测试发行只上传公开APK及校验文件：[0.2.130测试版](https://github.com/Siger1989/map/releases/tag/v0.2.130-test-standalone)。源码同步分支 codex/place-address-search-20261011，未合main；远端核对结果另存本机 .openai/release-130/source-sync.json。

Android最低Android8/API26，覆盖安装同包名同签名测试版；真实设备验证仍待用户安装。HarmonyOS6.1原生签名HAP/APP未交付，不能把本APK称为原生鸿蒙包；当前工具链/开发者签名和真机验证条件未齐。见 [鸿蒙安装状态](harmonyos-6.1-install.md)。
