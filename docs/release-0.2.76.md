# 山兔 0.2.76 测试版

本版针对 OPPO Find X8 Ultra 的路线节点拖动延迟：地图逐帧预览移出整页 React 更新，轨迹通过 GeoJSON 增量更新相关节点和线段；备注位置在拖动结束后刷新，提交、撤销和取消保持原语义。没有降低地图分辨率；真实手机跟手程度和 3D 帧率仍待复测。

Android 返回改为先由当前页面处理：子菜单先返回，浮窗先关闭，主页没有待处理菜单时才交给系统。路线规划和地名搜索默认联网，明确无网或网络连接失败时回退已下载步行路网；取消、授权错误、HTTP 错误和不连通提示不会误当作断网。工具菜单只保留测量、扫码路线和剖面。路线详情的起终点增加复制坐标与单独分享地点，分享复用既有原生地点分享能力。

移除根据预报生成的立体云团、界面开关与自动化配置入口，保留旧偏好字段兼容。图层的“最新云况影像”来自 NASA GIBS VIIRS 日间真彩色卫星影像，可看实际拍到的云；不是实时雷达或红外云图，天地图模式下不可用。“降雨动画”仍是 Open-Meteo 预报示意，本版没有接入实况雷达降雨地图。

- APK：Shantu-0.2.76-test-standalone.apk
- 版本：0.2.76-test，versionCode 83
- 包名：com.guanyun.weather.shantu.preview；沿用原独立测试版签名
- Android：8.0（API26）及以上
- 大小：57,855,068 bytes
- SHA256：D39A8B4B41FD3F3465B831D0994E0C5FE469501B3AFF9C0C3D9B2A0CA2FFF386
- 签名证书 SHA256：4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f

验证 PASS：TypeScript、688/688 测试、全新网页/Android 构建、原 v2/v3 签名、zipalign、473 张本地地形与修补瓦片；32 个网页 HTML/JS/CSS 与最终 APK 内容逐字节一致。

独立 390px 打包网页验证了拖点产生未保存、撤销恢复；精简工具、取消计算方式选择、返回先关闭菜单、地点分享关闭后保留详情、云团开关消失和降雨透明度入口。最终网页显示0.2.76-test/code83。截图位于 artifacts/screenshots/，过程日志位于 .openai/。

浏览器静态 QA 未接入 Android LocalGateway，存在高程瓦片缺块提示；初步验证页加载有无来源 MutationObserver.observe 错误，验证 HTML 补显式 body 后重新加载未新增同类错误，此修正只涉及本地验证页。云况入口和选中状态已验证，实时卫星服务连通性没有在 Android 真机验收。原生系统返回手势、触控/GPS、覆盖安装、性能和闪烁需真机确认。HarmonyOS6.1 原生 HAP/APP 尚未生成，不宣称此 APK 可直接安装到纯鸿蒙系统。

请覆盖安装同包名旧测试版，不要先卸载。源码位于 codex/rollback-ui-0235-20260921，未合入 main。精确构建提交与远程资产核对见 CURRENT_STATE.md 及本版 GitHub Release。
