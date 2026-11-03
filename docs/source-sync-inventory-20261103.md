# 项目源码同步盘点 · 2026-11-03

用户已确认目标仍为 `https://github.com/Siger1989/map`，并要求项目相关代码和文件都保存。盘点6个注册工作树；不覆盖未提交改动，不改变另一负责人的index或设备状态。实际推送与远端SHA以本轮回报为准，本清单不预先声称成功。

| 分支/范围 | 保存办法与边界 |
|---|---|
| `codex/tianditu-loading-20261027`、`codex/perf-render-20261103` | 原负责人已将165源码提交到 `a605c8a1824655897f0ed2b5f0a519bd0e35a658` 并同步；完整5分钟快验NOT_READY，不能称修好 |
| `codex/near-place-labels-20261103` | 本轮矢量地名候选、9项规则测试、接线、独立验收提案及同步说明；保留165基线，不改正在测试的工作树。没有新APK/设备视觉验收 |
| `codex/qa-tools-snapshot-20261103` | 从原 `codex/perf-modes-20261103` 的 `31dceca` 基线保存6个QA源码/测试文件的精确快照；原工作树/index不动，不代表设备采样通过 |
| `codex/outdoor-simulation-snapshot-20261103` | 从旧 `3751115` 基线保存2026-10-14模拟预览10个项目文件，原旧分支已落后远端30提交，不能覆盖远端或直接混进165 |
| `codex/perf-baseline-20261103` | 干净；基线31d已在远端实现历史，不产生重复提交 |

QA快照文件：`scripts/android/native-marker-regression/README.md`、同目录`src/com/shantu/qa149/Native149Instrumentation.java`、`scripts/android/capture-performance-trace.py`、`scripts/android/performance-matrix.ps1`、`tests/android-performance-matrix.test.mjs`、`tests/performance-trace-capture.test.mjs`。离线fixture/dry-run定向16项PASS，没有运行真实ADB/设备采集。

旧模拟预览快照文件：`CURRENT_STATE.md`、`docs/outdoor-simulation-preview-20261014.md`、`mobile/installSimulationGeolocation.ts`、`mobile/outdoor-simulator.html`、`mobile/outdoor-simulator.js`、`mobile/simulation-bootstrap.ts`、`mobile/simulation-frame.html`、`modules/position/simulation.ts`、`tests/outdoor-simulation.test.mjs`、`types/simulation-vite-env.d.ts`。本轮纯逻辑5项PASS，未启动预览或模拟定位，不是新的真实GPS/设备验收。

旧快照保留源文件原内容：`outdoor-simulator.html`和`outdoor-simulator.js`各有一个既有EOF空行警告，未为上传而修改另一工作区。QA快照的diff空白检查通过。快照提交分别为 `7b1c14f54abe1e3b54d93d1de3e5a62b9822e5d5` 与 `e150599260d50c400b4a67c9171c3218b446609c`，远端核验仍以实际推送回报为准。

主目录原未跟踪验收提案以原内容保存到本轮标签分支，原文件保留；提案明确不等于实际Goal已经更新。render剩余Kotlin session删除属于构建临时状态，不保存为产品修改。

不上传：`.env.local`、私人图源/Key/Token/签名材料、私人APK、用户轨迹/照片/标记/草稿、备份、原始trace/日志/截图、构建输出、缓存、依赖和`.openai`本机脚本。运行所需私人配置和原签名仍需安全保管，源码上传不等于这些文件已有备份。

本地历史仍能查到既有 `.env.local` 与 `mobile/.build/guanyun-test.jks` 文件名。未读取历史值或判断有效性，不在本轮重写历史、强推、删除或轮换；新增文件检查不能证明仓库全历史没有秘密。此次只向用户已确认的仓库增量保存审核过的源码/文档，不加入这些敏感文件。
