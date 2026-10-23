# 山兔 0.2.132-test Mac 便携测试版

2026-10-23，用户要求把本轮完成的地图改动打包供 Mac 使用。本次交付为自带运行环境的本地浏览器版，同时包含 Apple Silicon arm64 和 Intel x64；不是原生 `.app` / `.dmg`，不包含 Windows Python 行业制图工作台。没有 Apple 开发者签名或公证，Mac 真机启动、Safari、触控板、GPS 与持续性能尚未验收。

## 本轮内容

包含[地质图例、摇杆和等高距修复](geology-camera-contours-20261023.md)：紧凑地质摘要与完整详情、默认高清、中心旋转无效区、等高线统一高差和减少重复生成、海拔着色按等高距分档、固定在线高程服务在本机 Fake-IP 网络下的加载修复。

新增 `scripts/build-macos.mjs`、`desktop-web/Start-Mac.command`、`desktop-web/README-Mac.md` 和 `tests/macos-package.test.mjs`。复用既有网页入口和 `desktop-web/server.ts` 的七个接口；地图/路线/收藏的存储格式不变。产品源码升到132，Android manifest预备版本139/132保持一致；**本轮没有重建 APK 或 Windows EXE，现有固定包仍为131**，没有用132标识覆盖旧包。

## 产物与配置

| 文件（本机 EXE 目录） | 字节数 | SHA-256 |
| --- | ---: | --- |
| Shantu-0.2.132-test-macOS-private.zip | 146056286 | 0dbae7f91e2005aa0766efa44791dc1a342b236355a98e0dbd6e064a8421a688 |
| Shantu-0.2.132-test-macOS-public.zip | 146049291 | dff40aee4548944bf2716f0a2528b94b2635bac5bae1b5f597ea4c9aa1a7cc50 |

自用私有包含与本机预览一致的天地图 Key、39项图源 seed，只在本机交付，不上传公开 Release。公开包从 public 模式独立构建，不含这些配置；不能用公开包替代自用包。两包都没有配置地质云1:20万授权。源码及公开 ZIP/校验文件同步至工作分支 `codex/place-address-search-20261011` 与 [132 Mac测试发行](https://github.com/Siger1989/map/releases/tag/v0.2.132-test-macos)，不宣称已合入 main。

解压整个文件夹，双击 `Start-Mac.command`。启动器自动选择芯片，打开 `http://127.0.0.1:8787/`，无需另装 Node、Python 或项目依赖。保留启动终端；关闭它就停止服务。重复启动同版本复用已有服务，旧版本/其他程序占用时明确报错，不结束其他进程或改存储地址。使用同一浏览器；换机前通过存档/完整工程导出迁移数据。系统首次打开提示见包内 README。

运行时来自 Node.js 官方 v22.23.4，随包保留各架构 LICENSE；[Node 22 平台要求](https://github.com/nodejs/node/blob/v22.x/BUILDING.md#platform-list)为 macOS 11+，此要求不等于山兔已经在所有这些系统完成验收。官方 HTTPS 下载包与 SHASUMS256.txt 核对：

- darwin-arm64.tar.gz：c9e1dbc748b33ed2d14f42445191ecaf14c56259c7a9a26d0042c49ec2b66428
- darwin-x64.tar.gz：efcc2b0db6f94bf53eddb038fe2b370277a042bd29e4f19b8f8e23598795b819

## 验证与边界

| 检查 | 状态 |
| --- | --- |
| 前一阶段54项相机/画质/等高距/代理检查，九组布局和真实指针操作 | PASS，详见前述修复报告；不等于原生触控 |
| 两套正式 Vite web构建、TypeScript | PASS |
| Mac打包、桌面接口/重复启动、版本一致性4项定向测试 | PASS；包含安全ZIP路径、双架构/执行权限、全文件哈希、私有seed与JS凭据拒绝、错误运行时拒绝 |
| 两份最终 ZIP 全部文件哈希、官方运行时逐字节一致、无 Windows exe/私钥/env | PASS；1934/1933条目 |
| 私有配置与公开隔离 | PASS；私有seed字节一致、Key存在；公开包全条目未发现本机天地图Key，打包同时扫描本机已知URL/token凭据 |
| Mac启动器 LF、755、sh语法与含空格路径架构选择/非法平台拒绝 | PASS；架构选择用桩程序测试，不能当作Mac原生执行 |
| 从最终私有ZIP解出的服务和web在Windows Node运行 | PASS；132状态、重复启动复用；高程接口200/image/png/64247字节 |
| 成品实际浏览器 | PASS；内置天地图可选择并显示影像、真实地形状态、39项seed；截图 `artifacts/screenshots/mac-132/packaged-tianditu.png`（本机验收证据） |
| Mac设备、Apple安全提示、Safari/触控板、FPS/耗电、原生后台能力 | 未验证；当前机器是Windows。不存在Mac `.app`、鸿蒙原生包交付声明 |

打包脚本只接受当前本机匹配的私有seed和Key；公开模式拒绝私有seed及已知凭据。若本机配置了地质云token，私有Mac构建明确停止，避免静默丢掉该配置；该授权配置适配仍待后续处理。本轮实际配置没有此token。

日志位于 `.openai/mac-132-*.log`，不提交运行日志、私有配置、下载缓存或用户数据。原预览服务保留；成品验证的临时服务和标签页在结束时清理。
