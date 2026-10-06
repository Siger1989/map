# 降雨视口与图例接续（2026-10-05）

本轮代码工作已完成。两张用户截图是改前视觉 FAIL 证据：`9db62075-c7b0-46b5-a0d6-8ae83224d694` 显示图例过大并遮挡左侧控件；`1cce84c9-1005-44d0-835d-ed0b2cdaf7c0` 显示固定 5×5 雨区方框。截图均不代表修复后的视觉结果。

视口降雨请求已独立于原天气请求：原有 25 点天气变量保持不变，降雨单独请求两个变量。实时 Open-Meteo 检查返回 HTTP 200，72 个空间点 × 25 个小时共 1,800/1,800 个有效值（`.openai/rain-weather-viewport-live-20261005.json`；`scripts/check-weather-viewport-live.mjs`）。另一次最大预算核验 HTTP 200，9×9=81 点、25 小时 2,025/2,025 有效（摘要 `.openai/rain-weather-viewport-81-summary-20261005.json`、原始 `.openai/rain-weather-viewport-81-raw-20261005.json`）；数据 API 检查不等于 UI 截图。空间覆盖为 2..9 轴、最多81点并带视野边缘；缩放变细后重采样，小幅平移复用已有范围，30分钟刷新TTL。旧数据无法覆盖新视野时立即隐藏，时次精确匹配失败也隐藏，不用旧帧冒充。

图例已默认折叠，summary触控区44px；源码目标约180px宽、约52px高（玻璃边框可能使总高约54px，未量测）。标题12px、辅助文字11px，纵向内距4px/横向10px，外8px/内4px圆角；位于底栏上方4px，左侧预留52px、右侧80px。展开说明在内部受限滚动；图例宿主解除120px最大高度限制，避免展开内容向底栏溢出，户外主题明确使用卡片圆角变量。均为源码声明，不是 computed 尺寸，也不表示真实布局已避碰。

验证结果：视口雨数据与图层定向45/45（`.openai/rain-layout-viewport-final-tests-20261005.log`）；图例及任务显隐6/6（`.openai/rain-layout-visibility-final-tests-20261005.log`，其中2项与前述45项重复，不合并称51个独立用例）；最终 `npx tsc --noEmit` exit 0、`npm run build:android:web` 18.20秒 exit 0、`git diff --check` exit 0，日志分别为 `.openai/rain-layout-viewport-final-tsc-20261005.log`、`.openai/rain-layout-viewport-final-web-build-20261005.log`、`.openai/rain-layout-viewport-final-diff-check-20261005.log`。

真实390×857 / 360×780截图和手机触摸仍未验证。此前localhost预览被浏览器安全URL策略拒绝读取，不绕过策略。快速预览不出APK、不升版本、不提交、推送或合并；保留私有配置、用户地质文件和旧PDF。