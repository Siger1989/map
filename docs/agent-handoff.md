# Agent快速交接

更新：2026-09-21。先读根CURRENT_STATE.md与AGENTS.md，再按本次需求进入模块，不必通读全部历史。

## 当前决策

**最新用户反馈：0.2.40主页首轮仍不像PDF，不接受本轮视觉效果。** 不得把“无溢出/506测试通过/已发布”理解成设计验收。用户正在询问技术栈和正确UI模仿方法；后续先按PDF同尺寸量取规格、隔离旧样式，再做分区截图对比。详情见CURRENT_STATE和design-qa。

最新一轮：用户授权按PDF**只改主页并截图对照**。已在本分支加入顶栏、分组地图按钮、视角弹窗、独立记录窗和主页行程点列表；没有合回旧整套改版。截图在 `artifacts/screenshots/home-pdf-20260921/`，检查见根 `design-qa.md`。视觉仍待用户反馈；下一位agent先处理用户指出的主页问题，不自动展开其他页面。0.2.40/code47是本次主页预览包，0.2.39/code46是之前的回退包。

用户明确否定PDF之后的整套UI实现，并已选择退回0.2.35。当前工作目录为 `D:/天气系统`，分支 `codex/rollback-ui-0235-20260921`。切勿在旧UI工作树继续“完成PDF还原”，也不要把旧UI合回来。

当前安装版本为0.2.39/code46，是0.2.35业务代码的回退包，另有照片库v3兼容修正，不代表新增UI。公开状态、实际测试与SHA以CURRENT_STATE.md为准。

## 已做内容与回退范围

| 范围 | 当前处理 |
| --- | --- |
| 0.2.35地图/天气/轨迹/记录/收藏/照片/离线/测量/模型 | 保留原实现 |
| 0.2.34布局整框选择、裁切、层级、缩放、布局导入导出、行程点数据 | 保留，已包含在0.2.35 |
| 0.2.35全线陡坡提示 | 保留：取消前12限制，上下坡分开，长坡约200米补标，20%阈值不改 |
| 0.2.36固定主图、画线/记录/照片等145文件改版 | 已从当前业务基线撤回；公开旧Release不等于视觉通过 |
| 9月17—20日多个工作树中的UI试改 | 仅备份保留，不纳入当前分支 |
| 32页PDF及最后文字讨论 | 保留作参考；以后每个层级先展示效果、确认后再实现 |
| 队伍/SOS/PTT | 历史因无通信服务器暂缓，不把它列为已实现 |
| HarmonyOS6.1原生包 | 未交付，不以Android APK替代HAP/APP |

## 去哪里改

| 需求 | 模块/文件入口 |
| --- | --- |
| 布局编辑/保存/层级 | modules/uiLayout、tools/layout-editor、config/ui-layout-draft.json |
| 主图按钮/搜索/视角/浮窗密度 | modules/controls、对应模块CSS、docs/ui-density-standard.md |
| 手绘/节点/路线删除 | modules/tracks；删点及相邻边，不自动补线 |
| 实走记录/行程数据 | modules/outdoor、modules/journey；保留原记录时间与来源 |
| 路线显示/陡坡 | modules/routeDisplay、modules/routeAnalysis；只派生，不改原轨迹 |
| 道路规划/离线/返航 | modules/navigation、offlineRouting、tileCache、returnHome |
| 照片/标记/模型 | modules/photos、annotations；模型沿用ObjectGizmo精调 |
| 组合层/移动外壳 | app/page.tsx、modules/workbench、mobile/；不要继续堆大文件 |

## 本机工作树登记（仅2026-09-21快照）

| 目录 | 分支/基线 | 用途 |
| --- | --- | --- |
| D:/天气系统 | codex/rollback-ui-0235-20260921 / d01d9dc | 唯一当前入口 |
| D:/shantu-ui-confirmed | codex/ui-confirmed-20260915 / 01c07a0 | 0.2.36历史交付；仅追溯 |
| D:/shantu-ui-rebuild | codex/pdf-ui-20260920 / 01c07a0 | 43项未提交状态已备份；用户取消此方向 |
| D:/shantu-ui-rework | gpt/ui-rework-20260918 / 8613b45 | 21项未提交试改已备份；不继续 |
| D:/shantu-layout-selection-fix | gpt/ui-pdf-20260917 / d01d9dc | 15项未提交试改已备份；不能误作干净0.2.35 |
| D:/shantu-compat | codex/huawei-webview-touch / a661a75 | 旧0.2.19；不作为当前基线 |

原未完成文件未强制重置或删除；本轮只在旧工作树状态页加停用指引。需要旧成果先看本机备份 `D:/山兔-本地归档/20260921-before-rollback-110139/manifest.json`。原补丁对应各自HEAD，不可跨分支直接覆盖。旧工作树与备份未自动上传，不能声称换电脑也能恢复这些未完成改动。

## 换电脑/换agent

```sh
git clone --branch codex/rollback-ui-0235-20260921 https://github.com/Siger1989/map.git
cd map
git status --short --branch
git rev-parse HEAD
npm ci
```

已有目录先核对工作树和分支，再 `git fetch origin`；只有正确分支且干净时才 `git pull --ff-only`。不要默认main。签名密钥与.env需私密迁移；不上传，不重生成替代签名。node_modules不跨电脑复制。

可直接给下一位agent：

> 请接手山兔项目。先读CURRENT_STATE.md、AGENTS.md、docs/agent-handoff.md。用户已决定退回0.2.35，唯一开发分支是codex/rollback-ui-0235-20260921；不要继续旧0.2.36/PDF还原分支。先核对Git状态与最新交付记录，再按我这次提出的需求修改；UI逐层给图确认。

## 验证与交付

类型、相关逻辑、架构、构建按范围执行。浏览器图与APK签名不等于设备验收。当前回退没有新UI设计，不复用旧0.2.36截图证明回退版。每轮完成后状态页只保留当前结论，过程与完整日志移至历史/本地目录。
