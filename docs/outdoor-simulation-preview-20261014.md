# 户外模拟定位右侧预览（2026-10-14）

这是仅限 Vite development 环境和 `localhost:9286` 的浏览器开发工具。根代理启动隔离 Vite 服务后打开 `http://127.0.0.1:9286/outdoor-simulator.html`。手机 iframe 固定 390×857，控制台显著标注“模拟定位 · 非真实GPS”。9174 APK 预览、普通 `index.html`、APK 与原生定位桥不受此页注入影响；9286 不同端口也形成独立浏览器存储 origin，模拟存档与正常预览隔离。

支持经纬度/精度、N/E/S/W方向、任意0–359°、左/右转、步行1.4m/s/跑步3m/s/骑行6m/s/自定义速度、单步5米、环形与往返路线播放、暂停、重置及模拟定位超时。位置按实际 elapsed time × m/s 累计，受后台恢复单步1秒上限保护；hook每秒收到一次速度、航向、精度和新时间戳。暂停保留路线累计距离，按0速度继续发送新定位；丢失按钮发送明确超时错误。无法验证传感器朝向、Android GPS、后台/锁屏、真机权限或性能；点击地图直接设点暂未实现。

实现边界：`mobile/simulation-frame.html` 通过 `simulation-bootstrap.ts` 先安装 `navigator.geolocation` 标准 mock，再动态导入原 `bootstrap.ts`（保留兼容探测）。模拟入口和控制台都检查 `import.meta.env.DEV`、localhost及9286端口；iframe通信只接纳同源、已知source和固定消息类型。应用不调用原生桥；模拟预览与9174使用不同origin，故其记录与存档分开保存在9286空间，可在此独立模拟环境中试用记录功能。

定向纯逻辑覆盖坐标校验、方向归一化、暂停零速度、m/s移动、时间戳和路线按距离插值。浏览器C UA验收由主代理执行；本轮未生成APK或推送。

主代理实测（2026-10-14）：普通9174关于面板显示0.2.128-test/135；模拟9286连续步行坐标变化、开启/保持跟随、暂停零速度且坐标稳定、超时与恢复、15度转向均通过。外层500×900无横溢，iframe实际390×857，窄窗格模拟控制抽屉可展开；已恢复浏览器默认视口。内置分类天地图入口和实际影像加载已验证。最终右侧保持步行环线演示与跟随。
证据：工作区 logs/screenshots/outdoor-simulator-20261014.jpg、logs/outdoor-simulation-tests-20261014.txt、logs/outdoor-simulation-typecheck-20261014.txt。模拟环境实际道路导航重算、真实GPS/传感器/后台仍未验证。
