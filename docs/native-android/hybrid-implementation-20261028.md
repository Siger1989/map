# 具体施工办法

## 分层与所有权

1. 原 `mobile/main.tsx`、`app/page.tsx` 与各React业务模块保持界面/业务来源，原Web入口仍可运行。
2. `TerrainMap`增加原生适配分支，仍实现原 `MapHandle`/`TerrainMapProps`；浏览器分支不被修改成原生占位。
3. 本地透明WebView只承载React UI。下层Android FrameLayout承载每个mapId独立的WorldWind；UI区域由真实DOM几何发布，原生宿主在DOWN确定触摸归属，整个指针流直至UP/CANCEL不切换归属。
4. Android保留原Java系统桥接/服务，通过可扩展宿主钩子接入原生地图；不另写一套简版React菜单或记录业务。

## 协议

单WebView一个随机session，双图共享session、独立mapId。请求：`{version:1,sessionId,requestId,mapId,command,payload}`；reply类型为result/error；主动事件为`{version,sessionId,mapId,type:'event',payload:{name,value}}`。仅受信本地appassets origin可调用。reload、unmount、超时和取消使旧回复失效。

`renderState`按revision批量传原props的数据字段，不重定义对象schema；callbacks转成明确事件。相机原生高频运行，React仅接必要状态；同步投影使用最新真实WGS84 ECEF矩阵/逆矩阵、视口和高程缓存，不把异步RPC伪装成同步成功。CSS坐标与Android物理像素按实际WebView尺寸换算，不能简单假定dpi=1。

## 实施顺序

1. 已做备份与目标变更记录；列全方法/事件/数据合同。
2. 做安全协议、触摸叠层、独立验证构建和原React首页+真实原生地图端到端探针。
3. 按功能清单逐组补齐所有MapHandle/props映射，原业务测试继续运行；每组核对操作/返回/草稿/锁定和双图。
4. 通过全功能门禁后，才用原包名/签名做数据兼容替换；私人测试交付单独记录，不覆盖既有固定包。

目前是施工阶段。主agent负责宿主/React选择器/构建整合与实际复核；子任务分别负责协议数学客户端、原生地图host、透明叠层与触摸，文件边界分开。
