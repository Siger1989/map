# OPPO Find X8 Ultra：准星穿过弹窗

用户明确设备为 OPPO Find X8 Ultra（用户原文 FindX8U），并确认问题是白色十字准星盖在弹窗内容上，而不是准星坐标偏移。最近交付包为206；本轮没有连接用户手机或独立核实已安装版本。

## 根因与范围

原生地图磨砂由 `NativeReactGlassBackdrop` 绘制在整个WebView下方。DOM准星即使CSS层级低于面板，也仍在原生底板之上；用户窗口底色透明时，单改z-index无法消除穿透。不能用提高窗口alpha改变用户配色来掩盖。

新增 `mobile/native-reticle-occlusion.ts`，原生publisher在发布窗口区域和窗口动画采样时按实际玻璃区域判断准星是否相交。主图 `.map-center-cursor` 和双图 `.map-comparison-cross` 与可见窗口矩形相交时整枚隐藏，窗口移开、关闭或原生宿主清理后恢复。不是逐像素裁剪或重新居中；圆角外的矩形角区也按窗口范围避让。

仅在真实原生会话启动时注入准星visibility规则，普通网页路径不激活。准星本身无点击事件；标记按钮、地图中心坐标、选中路线优先取点、跟随/方向、用户配色均不改。原生动画期间复用已有600ms有界采样，不新增持续地图帧轮询。

修改 `mobile/native-ui-regions.ts`，新增遮挡模块和 `tests/native-reticle-occlusion.test.mjs`，在 `tests/panel-native-motion.test.mjs` 补原生publisher集成测试。

## 检查

- TSC通过。
- 25项定向通过：正面积覆盖/边缘接触/隐藏窗口，主双图分别遮挡，移开/关闭/卸载/宿主清理恢复，以及既有玻璃发布和真实地面标记取点。
- 日志 `.openai/reticle-20261115-*.log`；实际截图放 `artifacts/screenshots/reticle-occlusion-20261115/`。
- Web与隔离Android构建通过，仅覆盖安装专用模拟器上的 `com.shantu.hybridprobe`。probe沿用0.2.204-glass-check标签，资产来自206源码加本轮修复，不是旧204源码。
- 安卓1256×2760实际PNG：`native-home.png` 有准星；`native-covered.png` 图源面板覆盖准星原位置，准星整枚不显示；`native-restored.png` 关闭面板后准星在原位置恢复。未操作用户手机或主包存档。
- OPPO标记编辑实际场景、双图实机和其它尺寸尚未验收，不用模拟器图源面板结果代替用户手机验收。

| 检查 | 结果 | 证据/限制 |
| --- | --- | --- |
| 正面积覆盖与边缘接触 | PASS | 新增遮挡单测 |
| 主/双图分别隐藏与恢复 | PASS | 单测，不是双图真机画面 |
| 窗口WAAPI退出与宿主清理 | PASS | publisher集成检查 |
| 安卓窗口覆盖及关闭 | PASS | 上述三张原始PNG |
| 原配色 | PASS | savedMaterialPreset SHA256 625c9e28a3cfd79a0a2169c96361f78d6cd549e358bbbabc0274d412eed63afb |
| OPPO Find X8 Ultra标记编辑 | 未验证 | 手机未连接，本轮修复未交付到手机 |

再次测试条件：保持当前透明材质，打开覆盖准星的标记编辑/其它窗口，准星不压文字；关闭或移开恢复；不相交窗口不隐藏；主/双图各自独立，标记坐标、跟随和方向不因显示变化而改变。

本轮为反馈修复阶段，不提升正式版本、不改写206交付包、不提交推送。只使用隔离 `com.shantu.hybridprobe` 验证，用户现有手机仍需后续新包才能获得修复。
