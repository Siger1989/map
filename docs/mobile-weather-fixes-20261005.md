# 2026-10-05 移动天气图层与交互修复接续

分支 `codex/rollback-ui-0235-20260921`，基线 HEAD `d9fa1d15761ec8555f4db235e1557e2b10f3e42b`。本轮快速预览未打APK、改版本、提交/推送或合并；现有0.2.105包不含本轮变更。保留旧PDF、`地质资料/`、私有图源配置和用户存档。

- 云图重试逻辑及真实NSMC最新时次代理影像通过；18/18主测、8/8并发补测通过。右侧真实页面未验。
- 位置跟随/双图逻辑37/37通过。路线返回键CSS窄修经静态审查通过，视觉未验。
- 雨图已完成固定绝对mm对数连续色阶（0.05/0.1/0.3/0.5/1/2/4/10/20）、平滑栅格、常驻可折叠小时雨量图例（当前区域预报样本min/max）和Timeline同尺度。统一98/98测试、`npx tsc --noEmit`、`npm run build:android:web`（9.52秒）及`git diff --check`通过。日志：`.openai/mobile-weather-final-tests-20261005.log`、`.openai/mobile-weather-final-tsc-20261005.log`、`.openai/mobile-weather-final-web-build-20261005.log`、`.openai/mobile-weather-final-diff-check-20261005.log`。PNG源码算法检查发现389个有效RGB色值，只验证算法色值。
- 修改前截图确认雨区已加载但小雨cyan强度难辨，作为旧版视觉FAIL保留；不能据此判断新版。当前390/360 UI、手机GPS/触摸未验，localhost读取受浏览器策略阻止。数据为Open-Meteo 25点模型预报连续插值，尚未取得或接入可用国内官方雷达接口。

后续仍需真实尺寸UI与Android设备验收；不得将代码测试/build通过写成视觉或真机PASS。