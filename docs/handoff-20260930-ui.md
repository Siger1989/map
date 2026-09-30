# 2026-09-30 UI 与功能交付交接

## 接续位置

- 项目：`D:\天气系统`
- 基线：`e79a90b`
- 分支：`codex/rollback-ui-0235-20260921`
- 本轮目标发行版：`0.2.89-test` / `versionCode 96`
- Android 包名及独立测试签名沿用原系列。构建前确认工作树内容、签名证书与目标版本；不得清理用户存储。
- 完整交付证据见 [`release-0.2.89.md`](release-0.2.89.md)；UI实测见 [`ui-gate-20260930.md`](ui-gate-20260930.md)。源码同步功能分支，不自动合入main。

## 已完成的本轮工作与证据边界

- 地图与绘制 UI 按新门禁收敛：外框8px、控件4px，标题安全内距10px；画线卡最宽276px，右侧保留80px操作区；44px最大比例尺位于右上3D/框选下方，保留真实动态刻度。首页影像日期与独立 i 入口已移除，图源/地形/道路署名放入图源说明。绘制期间保留隐藏UI入口、解锁恢复草稿；3D/框选选中只改文字颜色。
- 已修改收藏分类/选择与框选、分享/导入面板、直接画线及路线续画、导航起点接入和相关地图叠层。完整文件清单以 `git status --short` 和 `git diff --name-only` 为准，不要把此清单当成完整文件列表。
- 用户数据保护：续画实走或模拟路线产生手绘副本，原件不改；导入和浏览器演练未删除真实收藏/轨迹/照片。模拟样例使用显式模拟坐标与时间，不冒充 GPS。
- 已有定向、类型与网页编译结果及对应日志/截图记录在 `CURRENT_STATE.md` 最新条目和 `.openai/`、`artifacts/screenshots/`。这些记录只支持各自检查结论，不等于本轮最终源码构建或 APK 验收。
- 道路/路线线段已置于地名下方，端点/用户说明/定位仍置顶；完整测试880/880通过，图层顺序相关16项覆盖既有回归。加德满都已截图复查。类型、网页和新APK构建通过；架构文件长度预算仍失败，列为后续模块拆分待办。

## 路线规划诊断边界

本轮只读诊断发现在线规划先请求 `locate` 再请求 `route`，流程串行；两者共用约1100ms主机节流并受单次超时限制。UI 已有重复计算禁用和编辑时取消行为。没有修改服务端请求顺序、节流、吸附或超时，也没有证明路线计算变快。后续若获授权要优化，应先分段测量耗时并核验取消预约回收和可行的 `route` 优先路径。

## 主 agent 接续步骤

1. 检查 `git status --short --branch`、当前 SHA 与 diff，保留所有已授权未提交改动；只提交本轮应交付的文件。
2. 收尾道路/路线与地名的图层次序问题，按 `docs/ui-quality-gate.md` 对受影响尺寸/状态复查截图和关键点击。项目门禁适用于本项目；不要改 Codex 全局配置。
3. 按影响范围完成最终类型检查、定向/完整测试与网页构建，并逐项记录命令及结果。检查失败或未运行项必须如实记录。
4. 将 `mobile/android/AndroidManifest.xml` 版本设为目标 `0.2.89-test` / `96`（先核对实际值），从最终源码运行 `npm run build:apk -- -StandaloneTest`，必要时传 `-SdkRoot <路径> -JdkRoot <JDK17路径>`。脚本位于 `scripts/build-android.ps1`，会校验证书并执行 APK 对齐与资源检查；不要加 `-UnsignedOnly` 作为可安装发行包。
5. 核对实际 APK 路径、文件大小、SHA-256、包名、版本、签名和资源；确认公开 APK 不含本机私有图源种子、Key、签名材料、环境文件或日志。把证据填入 `release-0.2.89.md`。
6. 按项目 `AGENTS.md` 的长期同步规则提交并推送当前功能分支到唯一远端 `origin`（不强推、不声称已合并 main），创建/更新 GitHub 测试 Release，上传本轮 APK；下载或查询远端资产并核对摘要、大小和目标提交 SHA 后再标记发布成功。
7. 真机覆盖安装、真实 GPS、触控和系统分享仍列为待验证；APK 是 Android 交付，不得称作 HarmonyOS 6.1 原生 HAP/APP。用户数据、图源授权和平台限制按 `docs/project-rules.md` 项目门禁处理。

## 构建/接续参考

- 项目现状与变更证据：[`CURRENT_STATE.md`](../CURRENT_STATE.md)
- 最新交接索引：[`docs/agent-handoff.md`](agent-handoff.md)
- UI 视觉验收：[`docs/ui-quality-gate.md`](ui-quality-gate.md)
- 项目目标与门禁：[`docs/project-rules.md`](project-rules.md)
- 换机器与环境：[`docs/continue-development.md`](continue-development.md)
- Android 构建入口：[`mobile/README.md`](../mobile/README.md)、[`scripts/build-android.ps1`](../scripts/build-android.ps1)
