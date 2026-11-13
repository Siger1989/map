# 现代地图UI与交互Skill调研 · 2026-11-13

用户认为科技深蓝试版整体仍显老气，要求查找当前常见UI、视觉与交互skill。此轮只做公开资料调研和参考判断，未改产品UI源码、未安装新skill、未出包。科技深蓝仍为候选，不是用户接受的视觉定稿。

## 近期产品参考

| 来源 | 已核实内容 | 对山兔的借鉴判断 |
|---|---|---|
| [komoot新版地图概览](https://www.komoot.com/whats-new/) | 官方更新页提供新版地图概览前后图，强调给地图更多空间、规划衔接与集中路线信息 | 优先参考任务与地图的关系、可收起信息面板、清晰主操作；保留山兔全部功能 |
| [komoot Android规划器](https://support.komoot.com/hc/en-us/articles/11223871075738-New-Route-Planner-on-Android) | 2026-09-10更新：布局与航点管理重做，路径编辑/列表排序、地形预览等移动端功能 | 复杂编辑拆成当前任务，地图内操作和详细参数分层 |
| [komoot iOS记录导航](https://support.komoot.com/hc/en-us/articles/11486164928794-New-recording-and-navigation-experience-on-iOS) | 2026-11-09更新：记录/导航/规划之间切换，面板最小化，数据字段可选1/2/4项 | 借鉴活动不中断、模式状态常显和按需信息；其功能平台限定iOS，不能声称Android已同样实现 |
| [Google Material 3 Expressive](https://design.google/library/expressive-material-design-google-research) | 颜色、形状、大小、动效与内容分组共同建立层级 | 借鉴清晰主次和状态反馈，不将大圆角/大按钮直接套入山兔已确认密度规则 |
| [Linear 2026-03-12设计更新](https://linear.app/now/behind-the-latest-design-refresh) | 降低次要导航视觉权重、统一操作位置和界面层级 | 专业工具的精确对齐、信息密度和可预测位置值得参考，不照搬桌面侧栏 |
| [Apple平台设计更新](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/) | Liquid Glass控件与导航作为内容上方的功能层，按上下文变化 | 借鉴内容优先与控件分组；玻璃透明度不能代替信息架构与户外可读性 |

以上是近期公开设计实例，不是市场占有率或“最流行UI”排名。komoot参考图从官方更新页链接在浏览器实际打开，原样页面截取保存在 `artifacts/screenshots/ui-references-20261113/komoot-official-map-overview.png`。这是官方展示图，不是本机实际运行komoot的验收截图。Google文字资料可读，但其大图在浏览器被客户端阻止，未绕过限制获取。

## Skill候选及边界

| Skill | 适合用途 | 当前状态/限制 |
|---|---|---|
| [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) | 配色、字体、组件、布局与UX规则检索，生成设计系统建议 | 社区项目，已读官方仓库模板；未安装。应按移动地图任务筛选，不机械套网站/营销页模板 |
| [Anthropic frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md) | 明确视觉方向、字体层级、具有产品辨识度的布局 | 未安装；与Impeccable有重叠，不是完整用户研究或任务流程验证 |
| [interaction-design](https://github.com/wshobson/agents/blob/main/plugins/ui-design/skills/interaction-design/SKILL.md) | 点击反馈、面板过渡、手势、加载和状态切换 | 社区项目，已读原文件；未安装。主要解决微交互，不能据此认定整个导航/记录流程合理 |
| [Vercel web-design-guidelines](https://github.com/vercel-labs/agent-skills/tree/main/skills/web-design-guidelines) | 交互语义、按钮与表单、键盘焦点、动画可中断、减少动效、内容布局检查 | 未安装；检查规则已读，适合山兔React UI的验收补充 |
| Product Design audit / ideate | 按真实流程截图审查；在实现前探索不同视觉方向 | 当前环境已有，无须安装；本轮仅核查技能说明，没有执行正式产品流程审查或生成方案 |
| Impeccable | critique、distill、clarify、harden、animate等定向改进 | 已项目内安装；前两轮用在配色收敛，未充分改变原有结构，因此不能以用了skill推断界面现代 |
| [mobile-android-design](https://github.com/wshobson/agents/blob/main/plugins/ui-design/skills/mobile-android-design/SKILL.md) / [mobile-ios-design](https://github.com/wshobson/agents/blob/main/plugins/ui-design/skills/mobile-ios-design/SKILL.md) | 平台导航、触控、安全区、适配与原生规范参考 | 社区资料，未安装；Compose/SwiftUI示例不适用于直接替换当前React UI，不改变已确认Hybrid技术路线 |

## 对山兔的初步判断与下一轮建议

根据本会话已展示的图层窗，问题集中在：小字与大量等高横条、控件视觉重量接近、图源/图层/参数堆在同一层、面板呈现仍像桌面工具栏。以上是视觉判断，不是本轮重跑全部界面或正式可用性研究的结果。

后续应先比较结构方案，再决定颜色细节：

1. 图源选择、常用图层开关和高级参数分组；常用操作少一步，高级参数按需展开。
2. 局部提高标题/内容层级和图标可辨识度，通过分组与按需展示维持紧凑及地图面积，不删除功能。
3. 高频按钮直接切换并显示当前状态；面板返回保留地图级别、草稿与记录；避免只有长按/手势才能发现的入口。
4. 动效用于说明展开、收起和操作完成，兼容减少动效，不用持续发光与循环动画制造科技感。

建议组合：现有Product Design做流程审查和视觉方案，UI UX Pro Max作规则/设计系统参考，interaction-design补微交互，Vercel规则作实现验收，Impeccable继续做定向打磨。不是全部同时堆叠执行。

下一步候选方向可为“轻量原生地图”“现代户外工具”“精密专业工作台”，先用同一个图层窗比较布局与层级。尚未生成/确认这三版，也未将圆角、字号、面板位置或流程提案写成最终规范；现有8px/4px圆角、紧凑例外、功能及数据保护继续有效。
