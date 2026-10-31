# 山兔 0.2.151 私人测试版 — 原生标记回归通过（范围限定）

## 状态

0.2.151-test / versionCode 158 的定向原生标记回归和真实起终点按钮 follow-up 均通过。版本化 APK 与固定入口已更新为 151；两份 APK 的只读 SHA-256 和长度一致。主/双图全功能矩阵及 Find X8 真机体验仍 **UNVERIFIED**，所以本文只确认标记与路线选择范围，不宣称全功能验收完成。当前聊天私人附件 **NOT_DELIVERED**。

## 构建产物

- 包名：`com.guanyun.weather.shantu.preview`
- 版本化副本：`APK/Shantu-0.2.151-test-private.apk`
- 固定入口：`APK/山兔手机.apk`
- 版本：`0.2.151-test` / versionCode `158`
- 大小：165,150,292 字节
- SHA-256：`60f77e35fd7f4c4d39c6f076ac98409dd9a4d5ca8eec3fd0decb6008e6692689`
- 只读检查确认版本化副本与固定入口 hash/长度相同。root 正在把最终签名/资源/配置审计元数据写入验证记录。

## 源码与构建检查

- 51 项 Node 测试：PASS。
- 31 项 Kotlin 测试、5 个 suites：PASS。
- TypeScript、私人 React 资源与 optimized APK 构建：PASS。
- 无可用 marker texture 时跳过 SDK default placeholder，已 ready 的 fallback texture 保留。
- Host generic cancel 不再让一个无关手势取消 GPU、DEM 或 section 工作。

## 原生核心回归

`.openai/native151-gpu/report.json` 共 78 步：A/B/C、三轮 rapid（每轮期望 B、实际 B）、blank clear、refocus 全部 PASS；64 个双向缩放与阈值样本均显示 focused marker，另含 5 个姿态。初始/最终用户标记数为 1→1，QA ID 清理后为 0。69 张 zoom/pose PNG 的中心红色 A 都有像素；9.16 显示 fallback icon，后续 9.4 label 出现，未见 149 的孤立文字/图片缺口。对应样本中未发现 150 曾出现的 24 px 白色 SDK placeholder。

## Native UI 按钮与最终姿态 follow-up

`.openai/native151-gpu/followup-ui-final-report.json` 的 18 步 `trueFollowUp` 通过：真实 MotionEvent 点选“设为起点”，路线输入框显示 `QA-PIN-A`；关闭面板、清选和重新点选后，“设为终点”也把 `QA-PIN-A` 写入终点框。随后关闭/清选/重选通过，5 个姿态完成；最后用真实触摸“完成调整”并清理 QA 标记，剩余 QA ID 为 0，最终选中 ID 为空，用户标记总数仍为 1。

根协调方已审阅最终视频与截图：`.openai/native151-gpu/followup-final/followup-ui-final.mp4`。此前 `replicate-full.txt` 因 helper 将 boolean 编码为字符串 false，不作为 follow-up；本段结论来自有 `trueFollowUp` 的新报告。

## 150 失败历史与 helper 命名

150 曾有 rapid expected B / actual A 和 24 px 白色 SDK placeholder，状态仍 **FAIL / UNQUALIFIED**；151 的结果不改写 150 历史。

151 回归报告中的 `qa149` / `native149` 是复用 helper 的历史工具包/类名与默认设备侧证据目录，不是 app 版本号。工具 `com.shantu.qa149` 对多个目标版本复用；151 实际包为 app versionCode 158。版本身份应以 package badge、安装与 dumpsys 等包证据核对，不用 helper 前缀判断。复现脚本由 `scripts/android/native-marker-regression/` 提供。

## 尚未验收与私人交付

- 主/双图全功能矩阵：**UNVERIFIED**。
- OPPO Find X8 等真实手机行为：**UNVERIFIED**。
- 当前聊天附件：**NOT_DELIVERED**，没有附件 ID/私有下载链接。私人地图配置和 APK 不公开发布。

151 的结论限于所述原生标记选择、缩放及路线端点选择流程。