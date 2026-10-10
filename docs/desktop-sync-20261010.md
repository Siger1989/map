# 2026-10-10 PC 同步到 0.2.120

用户要求“PC端能用上的也同步到PC端”。从已同步的 `69a1c950ce01b9bca5d556a2de9e064c3b072f1c` 构建桌面 0.2.120-test/code127；当前分支 `codex/rollback-ui-0235-20260921`，未合 main。APK 120 原 tag 不移动；本次 PC 平台限制的源码以本文所在提交为准。

## 范围和施工

- 桌面地图复用 `mobile/main.tsx` → `app/page.tsx`，重新生成完整地图 runtime 并嵌入单文件 EXE，因此同步了 119/120 的路线卡片向上展开、固定底部操作、换方式自动规划、跟随保留缩放、道路偏航重规划、主图/双图换源保留图层、双图返回及路线图标遮罩修复。
- 只新增 `useGuidanceWorkflow.recordingEnabled` 平台能力参数，默认 true；`app/page.tsx` 在桌面宿主传 false。PC 原本隐藏记录入口，但导入设置中的 `recordOnNavigation=true` 仍可能自动启动隐藏记录；现在开始导航不启动记录。导航本身、定位生命周期、手机默认行为及已有记录阶段不变。
- 新增 `tests/guidance-recording-platform.test.mjs`，实际挂载 hook 检查五种情形；更新 EXE 说明与交接。不改 Windows 外壳、行业生图逻辑、数据格式、存储键、APK 版本、签名或用户数据。
- 私有与公开地图各 fresh 构建，再分别 PyInstaller onefile；公开包不包含本机 Key 或私有图源。含 Key 私有包仅本机，不上传。

## 本机交付

| 文件 | 字节 | SHA256 |
| --- | ---: | --- |
| `EXE/山兔桌面.exe`、`EXE/山兔桌面-0.2.120-private.exe` | 123805197 | `1941c0f01a4d10172afd5247a085677ff72beea06849c961ce8ac05fa68d377d` |
| `EXE/Shantu-0.2.120-test-windows-x64.exe` | 123803147 | `dd81ec6147ba167ce024b8a0276d3a97f5d9149455920727d6ccc730ee350d9c` |

固定入口替换为私有 120；旧 `Shantu-0.2.118-test-windows-x64.exe` 保留。原 `.env.local` 与39项私有图源文件构建前后 hash 一致；真实存档未清空。桌面仍需 Microsoft Edge WebView2 Runtime，PNG 渲染需系统 Edge/Chrome，无需另装 Python/Node。

公开资产入口：[0.2.120 测试发行页](https://github.com/Siger1989/map/releases/tag/v0.2.120-test-standalone)。公开 EXE 与已有公开 APK 共用发行页，但 APK 保持原 120 tag 源码，PC 附加平台限制见本次提交；不宣称 APK 已重新构建。

## 检查和证据

| 检查 | 结果与边界 |
| --- | --- |
| 共享逻辑定向检查 | PASS：75 项，涵盖跟随、偏航、双图、图层偏好、路线操作/摘要、注记和图标优先级 |
| 既有桌面定向检查 | PASS：8 项，平移生命周期及 desktop-web |
| 新平台限制 | PASS：1 项测试覆盖 PC 禁止自动记录、手机默认允许、用户禁用、已有暂停记录、导航拒绝五种情形；共84项测试 |
| TypeScript / 构建 | PASS：`npx tsc --noEmit`，私有/公开地图及两次 onefile 构建 |
| 内嵌资源 | PASS：私有1932项、公开1931项逐文件与最终 runtime/外壳 hash 一致，无缺失或不匹配 |
| 私有/公开配置 | PASS：私有种子39项及Key存在；公开扫描49个文本资源无配置凭据匹配、无私有种子，地质授权配置为空 |
| 真实 EXE 独立自检 | PASS：私有 EXE 复制到中文/空格隔离目录，仅单文件启动；两版 frozen/embedded=true、exit0、版本120、shell/map/industry HTTP、四模板、剖面/钻孔 SVG/PNG；钻孔100回次/30层/120样品/300m |
| 桌面浏览器 UI | PASS：使用私有 EXE 实际启动的9192服务，而非Vite源码；关于页显示120/code127；天府广场→春熙路实际规划，驾车1.7km/5分钟→步行1.5km/20分钟自动重算，缩放16.129753710022786保持 |
| 详情展开/收起 | PASS：1366×900操作区 y=742.385保持，面板269→577px向上展开；1024×768完整可见，1920×1080无横向溢出；尺寸均为实测CSS视口，地图高度扣除44px外壳栏 |
| 换源/双图返回 | PASS：主图切天地图，contours/elevationColors=false、缩放保持；双图左侧等高线=true换源后保持，右侧=false独立；退出恢复主图天地图和原图层/缩放 |
| 行业页/返回 | PASS：实际打开行业页，平移按钮禁用；返回地图仍为天地图、路线和缩放保留。生图结果由真实 EXE 自检验证 |
| 原生能力 | 未验证：Windows WebView2窗口权限/手感、真实GPS/跟随、后台记录、Android安装、HarmonyOS原生。浏览器已有“IP估计位置”提示，不视为GPS验收 |

本机证据目录 `.openai/pc-sync-20261010/`：两版 `*-payload-audit.json`、`public-config-audit.json`、两版 `selftest-*/self-test-report.json`、`browser-ui-checks.json`、构建/类型检查日志、`final-artifacts.json`、`final-config-check.json`。共享检查日志 `.openai/pc120-targeted-tests.log`、`.openai/pc120-desktop-tests.log`；平台测试日志本目录 `platform-recording-test.log`。日志、截图和私有资源不提交。

截图位于 `artifacts/screenshots/pc-sync-20261010/`：`version-1366x900.jpg`、`route-expanded-1366x900.jpg`、`route-expanded-1024x768.jpg`、`route-folded-1920x1080.jpg`、`comparison-1366x900.jpg`、`industry-1366x900.jpg`。

## 再测条件与下一步

后续改录制能力或导入导航偏好，须重测 PC 不自动启动隐藏记录及手机正常启动；更改路线卡片/CSS 或桌面控制器，须测展开、收起、窗口尺寸、computed边界及实际操作；图源或双图适配须重测独立图层与退出恢复。已知外部高程瓦片偶发加载提示、历史超小/矮窗口及架构预算问题未在本轮扩大修复。用户可直接运行本机固定 EXE 验证实际 Windows 手感；原生GPS和权限仍需设备验收。
