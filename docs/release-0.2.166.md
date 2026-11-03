# 山兔 0.2.166-test / code173 私人测试包（2026-11-03）

用户本轮明确要求打包，现交付Android私人试修包，保留注册内置天地图与原数据兼容。原165源码主目录不切分支，未合入c0e46ba地名候选、标记候选或旧main。

## 产物与来源

- 版本包：`APK/Shantu-0.2.166-test-private.apk`；固定入口：`APK/山兔手机.apk`。
- 归档：`交付包/山兔-0.2.166-test-2026-11-03/01-Android-APK/`，三份APK字节/哈希相同；各有SHA256和安装说明。
- 165211356 bytes；SHA256 `89082cdea45b2224987eb75b9da104182ba020748c0b2a45d68f01f64c355d58`。
- 包名 `com.guanyun.weather.shantu.preview`；原证书SHA256 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`。
- 源码分支 `codex/zoom-queue-lifecycle-20261103`，工作树 `D:/shantu-zoom-queue-20261103`。构建基线4ca1d18691163bc2369bb2b2bf2c9df6e4db7b44加166/173版本配置；本说明与版本提交后的功能源码相同。`D:/天气系统`源码仍在165的a605c8a，固定APK已更新166，旧预览不能自动当成166原生实现。
- 原固定164包与校验文件在本机`.openai/private166-backup/`保留，163/164版本包与用户数据不删；模拟器原164已读取备份但未覆盖安装。私人输入仅复制到本机忽略目录，Key/签名私钥/私人APK未上传GitHub。

## 本包改动

基于165加入当前视口MVT待办撤销、视觉中心优先、关闭图层等待项清理、最高源级保护，以及原始数据返回后的解码前过期检查。非空缓存按中心先解码、边缘后补齐；空瓦片绕过。网络返回不占HTTP许可等待缓存解码队列。保留原几何、样式、功能、存储格式和完整可见覆盖策略。

详情和未解决边界见[施工记录](native-android/viewport-queue-20261103.md)。通用栅格影像队列及SDK私有阶段仍未整体改造，不能宣称所有卡顿、画线和崩溃已修复。

## 检查与限制

| 项目 | 结果 |
| --- | --- |
| 已有定向逻辑验证 | 25项队列/需求/适配器JUnit PASS，另4项等高线队列PASS；打包仅改版本，功能代码与这些检查对应 |
| TypeScript与手机React | 本轮PASS；native-hybrid私有配置fresh构建，APK逐字节匹配1925个React资源 |
| Android全模块构建 | 本轮optimized/R8/签名PASS，独立ASCII stage，55个task执行；不是复用旧DEX |
| 原签名、版本与SDK | PASS；原证书、166/code173，minSdk26/target35/compile37，新解码检查DEX标记在实际包内 |
| 私人资源 | PASS；React/native/本机输入39图源与Key一致，473 FABDEM和23修补瓦片保留；不打印Key |
| 包完整性 | PASS；2165 ZIP项CRC、zipalign16KiB、全部64位ELF LOAD段16KiB检查 |
| CAD与原生SO | 本轮未重编C。核对C/CMake/vendor归档/NDK配置等输入无变化后复用保留的4ABI CAD；新APK全部8个SO与原164包字节相同，JVM/React/资源/manifest重新构建 |
| 模拟器及真实手机体验 | 本轮未安装或运行新包，未证明启动、完整界面、主双图、画线、实际CPU/内存或崩溃已改善 |
| HarmonyOS6.1 | 原生HAP/APP未交付；工程/工具链/签名条件未齐，本次仅Android APK，不冒称鸿蒙原生支持 |

安装前保存正在编辑的草稿/记录，使用原包覆盖安装，不卸载、不清数据。本机原始构建/核验日志只保留在`.openai/private166-*`，不上传私人APK或原始用户数据。
