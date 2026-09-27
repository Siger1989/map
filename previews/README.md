# 窗口密度预览

`window-density-20260928.html` / `.css` 是用户确认用的独立版式样板，不导入生产页面、不访问用户存储或地图服务。示意数据仅用于观察常用操作的尺寸与排列；普通窗口主页面不设内部滚动，详细资料继续作为明确子页面。

参照用户认可的收藏窗口实际计算样式：标题栏44px；标题按钮36px、11px字号、0 4px内距；文件夹行36px、名称11px/14px行高；搜索行45px，面板字号13px、间距3–4px。样板在此基础上使用正文/普通按钮12px、辅助11px、标题14px，文本输入16px，主操作44px。

预览覆盖记录、路线规划、路线编辑、剖面点编辑、标记编辑和图层。吸附与路线编辑保留最新功能语义；预报立体云体已移除，卫星云况与降雨预报区分展示。地图只作示意，不表示实际地形、天气或定位。

验收：390×857、360×780检查页面和卡内横向溢出、按钮/字段尺寸、标题与主操作完整显示；图片保存在`artifacts/screenshots/`。用户对预览反馈后，再将确认的密度映射到现有组件和共享令牌，避免用另一个全局覆盖层积累样式冲突。

2026-09-28验收PASS：六卡均无内部溢出，360px地图工具间隔8px。交付图片`artifacts/screenshots/window-density-six-panels-20260928.png`。`?window=1..6`为该Windows主机IAB截图缩半问题准备的独立presentation导出；缩放仅用于展示，不用于手机尺寸验收或生产代码。初始fullPage重复拼接图标记FAIL，不作为用户交付。

2026-09-28修正：上一张总图仅保留部分按钮，误把实际控件当可删减样例，已废弃。新图`artifacts/screenshots/window-density-corrected-six-panels-20260928.png`逐个对照0.2.76组件：RecordingPanel/OutdoorPanel、RoutePanel/RouteViews、SurveyPointEditor/SurveySectionPanel、PinEditor、LayerPanel/LayerWindow。原有按钮、禁用/即时保存语义和二级入口保留；此预览只用于对比密度，不可替代生产组件。390×857及360×780均检查无横溢、卡内裁切或地图工具重叠；内容较多的图层按现有例外保持较高卡片。
