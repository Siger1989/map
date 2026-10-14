# 0.2.125 私有APK交付（2026-10-14）

用户明确要求“发我APK”，并补充正在手机上，需要下载链接。本轮从活动搜索工作树最终源码全新构建 `0.2.125-test / versionCode132`；包名 `com.guanyun.weather.shantu.preview`、原签名与存储格式保持兼容。

## 本轮内容

- 包含[近景导航改动](navigation-close-view-20261013.md)：显式进入放大、60°近景、沿路线的近端方向箭头、模式图标/文字选中反馈。
- 偏航接回段使用橙色虚线；定位箭头在路线之上，靠近起点时隐藏重叠的起点标识。
- 修正定位临时错误清除后仍停留等待的JS状态，以及冷地形加载时近景相机高度冻结问题。锁屏/切应用后的真实Android定位恢复尚待手机复测。
- 纳入APK123之后已完成的远点提前剔除、最大30km范围、清晰矢量地名默认及原注记切换、路线输入法布局等改动。
- 共享手机/PC源码已同步；本轮只生成APK，固定PC EXE仍为124，不包含最新近景导航变更。没有新增原生权限或更改用户存档。

## 文件与核验

- 固定本机文件：原工程 `APK/山兔手机.apk`；版本存档 `APK/Shantu-0.2.125-test-standalone-private.apk`，旧123保留。
- 大小：70,252,729字节（约70.3 MB）。SHA256：`cbd013b8f2e64fe71376340e776a11505d7098145af2263899efe284bde65927`。
- 原签名SHA256：`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`；签名v2/v3、aapt版本/包名与zipalign PASS。
- fresh staging `mobile/.build/apk-20261014-082442/`；ZIP 1934项CRC PASS，1926项网页资源与staging一致，496张地形PNG解压像素流一致（基础地形473张）。classes.dex和地图worker与123相同。
- 内置天地图Key与9174预览配置一致；39图源种子逐字节一致。没有.env、签名密钥、缓存日志混入APK；Key只作为用户已授权的本机/自用包配置存在。
- 前轮同一导航源码57项定向、tsc、四尺寸20态及三手机尺寸展开/返回PASS；本轮版本提升后的fresh Web/Android构建PASS。实际APK解出的网页390×857启动、导航选中CSS加载、无横溢、内置天地图入口/选中及12次影像响应PASS。
- 隔离网页初始全球视图的部分外部高程请求502，浏览器IP定位不可用；选择天地图后的影像实际加载通过。未模拟原生GPS或成功回调，不将网页结果扩大为设备验收。

证据位于本机 `.openai/release-125/`：`preflight.json`、`build.log`、`integrity.json`、`bundle-check.json`、`packaged-smoke.json`、`packaged-tianditu-390.png`、`local-delivery.json`、`cloud-delivery.json`、`source-manifest.json`、`source-sync.json`。

## 手机下载、安装与同步

按用户“手机上需要下载链接”的明确要求，APK通过Google Drive上传到用户账号，上传完成并回读名称、MIME、70,252,729字节及仅owner权限。私有链接已在聊天交付，详细链接仅保留本机cloud-delivery.json；未开启公开分享、未上传含Key包到公共GitHub Release。手机需登录连接的Google账号下载。

Android 8.0+、可用WebGL2；直接覆盖安装同签名山兔测试版，保留数据，不先卸载。真机安装、触控、锁屏/切应用定位恢复、后台、相机和分享仍未验证；优先复测导航→锁屏约30秒→返回及偏航→虚线接回。HarmonyOS 6.1原生HAP/APP仍未交付，不能将此Android APK称为原生鸿蒙包。

活动工作树 `.openai/worktrees/place-address-search-48c80e0`，分支 `codex/place-address-search-20261011`，构建基线 `7107a0b5deba47188951f35dc028a1a711810213` 加本轮最终源码与125元数据。源码/测试/说明按项目授权提交并同步此分支，未合main；最终本地/远端SHA核对记录见source-sync.json，不把基线SHA当成最终源码提交。
