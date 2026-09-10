# 山兔 0.2.23-test 独立测试版

## 本轮变化

- 新建剖面替换为 A/B 勘探线：手点或已有标记定方向，后续点共线，支持延长线；A/B 转向保持其他点距 A 的里程，编辑可选沿线滑动。支持后期沿线标记、点位资料、图纸信息、上剖面/下等高线图及完整附表、逐页图片保存和分享。
- 测量和剖面加入收藏；顶部分类可拖动排序并保存，备份包含测量与关联数据。
- 不同颜色路线相接后保留原分段颜色；节点编辑、续画、撤销、反向和 JSON 存档同步保留。
- 竖井/井深/岩层功能暂停，未纳入本版本。原测量计算、导航/天气、相机和品牌图标未改。

主要文件及接口见 [勘探线模块说明](exploration-lines.md)。新增独立 section/survey*、Survey*、collections/CollectionTabs/tabOrder、tracks/edgeColors 与 2 个测试文件；原模块仅增加存储和界面适配，无删除原存档功能。

## 验证

- 类型检查、全部 400 项逻辑测试通过；工程图排版和从收藏定位收尾后再次通过类型和剖面定向检查。
- 390×844 与 360×780 浏览器：选 A/B、C 共线、B 转向后 C 的 1423.5 m 里程不变、后期 D 标记约束、图纸信息保存/附表/JPEG 导出、测量从收藏恢复、分类拖动并刷新保留、红蓝相接后地图保色通过；无页面横向溢出。
- 最终网页和 Android 从新暂存目录构建，签名 v2/v3、zipalign、版本/包名、473 地形瓦片与资源检查通过。当前电脑没有连接用户手机；未完成 OPPO 实机手势、相机/分享和安装验收。
- APK 57,669,821 字节，540 项 ZIP CRC 全部通过，SHA256：`3e1ec1c2dd15402443efe2eb26e0ee6487723eed134ea5970802c0fda0a95ae7`。
- 截图和实际导出图保存在 `artifacts/screenshots/ui-0223/`（本地，不提交二进制）。构建/测试日志保存在 `.openai/*0223*.log`。

## 安装

- Android 8.0+：`Shantu-0.2.23-test-standalone.apk`，versionCode 30，包名 `com.guanyun.weather.shantu.preview`，桌面名“山兔测试版”。
- 本机仅有独立测试系列签名 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`。原系列 `com.guanyun.weather.preview` 的 a3aa 签名私钥不在本机，因此本包与原系列并存，不覆盖安装、不自动迁移数据。独立 0.2.19 系列可按同包名同签名更新。
- 保留原版，在原版“行程 → 数据 → 存档备份”导出 JSON，再到本版对应入口导入。照片媒体按原备份范围处理，不宣称 JSON 包含所有本机照片文件。
- HarmonyOS 6.1 原生 HAP/APP 仍未交付；Android APK 不能作为原生鸿蒙安装包。现有资料见 [鸿蒙安装边界](harmonyos-6.1-install.md)。

本版为测试发行，现有地形许可与地图服务授权边界保持不变。[GitHub 测试发行](https://github.com/Siger1989/map/releases/tag/v0.2.23-test-standalone)已公开，三项资产的服务器摘要与本地一致。业务提交 `942a3d0a938ff07aed8b837c2146cd3d688a9bed` 已同步功能分支 `codex/huawei-webview-touch`，未合入 main。
