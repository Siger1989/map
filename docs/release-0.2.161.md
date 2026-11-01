# 0.2.161-test 本机私人试修记录

161-test 是本机私人试修候选，不是正式发布、手机验收或全功能视觉定稿。新增双图几何内存guard，并继续修整画线MOVE处理、节点/道路吸附与坐标工作。

- 版本 `0.2.161-test` / code168，原包名与签名身份；165175092 bytes，SHA256 `9067da62082202c63855d11a08679e0c2bd88b84759d64cec4a430f196b86da7`。专用MuMu3实际安装目标SHA与候选一致。
- 私人包审计：39图源、1925项资源、473+23地形资源、4个native64库、16KiB；PASS。
- 104 Node、TSC、fresh React、optimized build及9 Kotlin suites/80 unique items PASS。最终原生7姿态130条stroke宽度检查及相机/renderState/revision恢复PASS，root查看实际近远截图；不是完整UI或手机验收。
- MuMu3双图持续样本：179.81秒4轮操作，OOM/FATAL/mmap失败0；z7预算拦截1次并细分1次，maxLogical 53788、maxVBO 4303040、Java heap采样150.2MiB峰值/87.1MiB末值。无等高线样本117.38秒2轮，OOM/FATAL 0、全图contours=false，heap采样197.4MiB峰值/53.3MiB末值。具体流程及限制见[交接](HANDOFF-20261101-161.md)。模拟器结果不代表手机验收。
- 同161坐标复制/搜索与391×834、360×779标记卡片定向PASS；小幅20MOVE、快速6MOVE、节点吸附/撤销/保存退出重进PASS。真实道路曲线路径LIMITED；非手机FPS证据。
- Find X8手机161未验收；手机160任意两图源双图卡顿反馈仍FAIL。手机静止时及关闭等高线后的闪烁根因未唯一坐实；完整UI未验。HarmonyOS原生包未交付。
- 旧9ba候选双图持续OOM FAIL保留；161版本化/固定/归档三份一致，旧160/159/158/157保留。源码分支 `codex/tianditu-loading-20261027`，最终远端SHA以交付回报为准。无公开私人Release或新外网下载通道。

本机证据 `.openai/native161-dual-normal-guard-*`；未包含私人日志或凭据。浮窗、SDK依赖替换、权限、Unreal及用户存档未改。历史160/159/158/157保留。

可分享的脱敏核验见 [summary.json](../artifacts/performance/native161-dual-drawing-20261101/summary.json)。原始截图、坐标、剪贴板和日志仅本机，不进公开仓库。
