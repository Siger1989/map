# 2026-10-01 本地预览图库恢复与超强出图

用户截图中“我的图源”为空，要求放回以前的图源并确认超强可用性。根因是 defaultSeeds 只允许 Android appassets origin，本地 9174 预览没有加载内置私有清单。此前38项私有配置准备并未等于右侧图库已出现，现补齐该差异。

## 修改

- mobile/vite.config 仅 apk-preview 模式定义显式预览 flag，挂载 apply:serve 的 apkPreviewSeeds；默认/生产构建不开启。
- tools/apk-preview-seeds.mjs 只对固定路径的 GET/HEAD 提供 ignored 私有清单原字节。检查真实 loopback socket、loopback 服务绑定、Host/实际监听端口、无 userinfo、同源 Origin 与非 cross-site；返回 no-store/nosniff。请求不能选择任意本地文件，未复制至 public 或生产构建目录。
- defaultSeeds 允许 Android 原生 origin；本地必须同时具备显式 flag 与严格 loopback origin。普通网页、公网、未启用模式不加载私有 seed。现有幂等迁移/删除保留保持。
- ignored 清单仍为旧37项原顺序加1条原始二维码源，共38；不改变Key/URL/坐标/瓦片声明。不清用户存储或替换已有图源。

## 实测

- PASS：真实9174清单HTTP200、38项，与ignored私有输入逐字节相同、Cache-Control:no-store。
- PASS：右侧真实手机框“我的图源 · 38”，完整旧图源列表可见；选中“谷歌 ·【推荐】超强”后卫星影像实际显示，菜单明确状态“图源影像已加载”。保持原视角及约14级，未通过换视角/伪定位制造成功。
- PASS：证据 artifacts/screenshots/sources-restored-super-20261001.png 包含总数、当前源、选中行、加载状态与实际地图。截图为临时搜索“超强”，验收后已清空筛选、恢复完整列表，保留该源选中。
- PASS：12项seed服务边界、loader与升级迁移定向测试、TypeScript、Android网页构建。生产网页输出不存在 native/default-map-sources.json，明确私有APK仍须打包命令显式注入。
- PASS：Luna网络重跑实际Android MapTileProxy（电脑JDK17）仍返回JPEG 200/23,411字节；本次约8秒，比上次慢，不能承诺网络时延或手机表现。Luna复核服务边界后补上逐字路径、Host userinfo/端口与IPv4映射loopback检查。

## 边界与交付

现已验证本电脑真实浏览器图源协议、坐标Worker和地图渲染链，而非仅下载单瓦片。手机WebView、DNS/VPN和网络表现仍待新APK实测，不能据此宣布手机已修复。没有验证全部37旧源的远端可用性。

本轮未升版本、打APK、提交或推送；0.2.94仍不含上轮性能/原生请求/升级迁移。原任务、标记、测量和用户图库未清理。原tab13连接工具超时，首次browser-use测试tab20出图但没有切到用户当前应用面板；用户再次截图为空后，使用open_in_codex打开应用管理的tab21，并核验该实际应用标签的38项、超强选中、加载成功及地图。新增证据artifacts/screenshots/sources-restored-right-20261001.png；保留应用tab21、关闭测试tab20，原用户标签不关闭。open_in_codex返回queued，面板需该聊天可见时应用请求；不能把browser-use测试标签自行显示等同用户当前面板已切换。
