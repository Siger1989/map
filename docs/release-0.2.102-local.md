# 0.2.102 本机私有测试包

本轮按用户确认的规则改动轨迹编辑：拖动当前可见节点 B，以相邻可见节点 A、C 为固定端点，AB、BC 拉直；中间原始点按原距离比例重新排到直线上，点数不减少。缩放再显示更多编辑点；拉长和同缩放平移不增加已编辑区间的句柄。用户提供的细长刺、松手补点、平移补点和镜头放大分别纳入验证。

## 实现

- `visibleNodeMove.ts` / `routeEdit.ts`：按一次手势捕获的可见控制点建立不可变计划，预览和提交使用同一几何。端点、共享分叉点、连续重复GPS点、闭环、备注冲突、无移动、撤销均有回归。原始录制路线通过编辑副本保留；节点颜色/备注、待生成标记随对应点移动，边元数据保持索引。
- `TrackLayer.ts` / `editing.ts` / `TerrainMap.tsx` / `app/page.tsx`：实际渲染句柄决定控制范围，两图携带同一计划；隐藏顶点所在的线块同步预览，取消恢复基线，无关线块保持。相机与地形资源更新分开判断采样时机。
- `SegmentHandleCache.ts`：地理索引先筛屏幕附近候选，再做屏幕投影和间距筛选；真实共享点保留。记录已编辑区间的隐藏点和控制点索引，同缩放平移只更新可见范围，主动缩放解锁抽样。连续重复记录点不误当共享岔口。
- `FeatureDragBridge.ts`：消费拖动结束后短时间内的尾随双击事件，避免刚恢复的地图双击处理器把选点/拖动当成放大。普通后续双击、双指取消及原有控制状态恢复。

## 验证

107/107 定向测试、`tsc --noEmit --incremental false`、涉及已跟踪文件的 `git diff --check` PASS。日志 `.openai/visible-edit-final-tests.log`、`.openai/visible-edit-final-tsc.log`。覆盖几何/备注/颜色/重复GPS点/撤销/取消/两图不同投影/未修改线块复用/地形刷新/同缩放平移/主动缩放/尾随双击/此前分叉路径。

真实浏览器在独立9293合成存档导入5800点GPX：390模式先复现平移补点；最终源码验证拉长→松手→平移后AB/BC无中间新增句柄，zoom保持14.04，主动+1变15.04才显示细节节点；切换编辑窗口检查两图一致。360×780从13.88开始，拖动和平移仍13.88，上图拖动后下图继续拖动同步，两次撤销恢复原线并退出；body/client/scroll宽均360。测试操作全部撤销；9293测试tab关闭，9291用户正在编辑的存档未手动刷新、未清空。

截图 `artifacts/screenshots/visible-node-edit-20261002/`：`pan-extra-handles-before.jpg`、`pan-fixed-dual-390.jpg`、`zoom-reveals-390.jpg`、`pan-fixed-dual-360-upper.jpg`、`pan-fixed-dual-360-lower.jpg`。浏览器不等于Android触摸/帧率验收。10001点显式节点的大部分在屏外时，地理预筛测试把投影控制在300次以内；无有效地理视口时会保守全投影，不宣称所有视角都只计算屏内点。

## APK构建

完整重新构建：`mobile/.build/apk-20261002-232325`；日志 `.openai/build-0.2.102-local.log`。`APK/Shantu-0.2.102-test-standalone.apk`，66,085,680字节，SHA256 `86a99b099942604a1d93b1d1644862607bec91b3de69940dc3de7c50091e7d5e`。独立核验包名/code109、原证书v2/v3、zipalign、CRC、1910项assets、496地形PNG像素/metadata、1365概览瓦片、38私有图源种子与Key/版本一致性均PASS。证书SHA256 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`。报告 `.openai/package-02102-integrity.json`、`.openai/package-02102-config-check.json` 和 `.openai/02102-*.log`。

临时[手机下载链接](https://explorer-knock-melbourne-penetration.trycloudflare.com/0b3d3ad25a435fcaefa3269d36b09f02e0d3/Shantu-0.2.102-test-standalone.apk)，北京时间2026-10-03 01:25到期；只暴露这一安装包，随机路径、2小时自动失效。本机代理路径整包200下载66,085,680字节及SHA256一致、Range206共16字节验证PASS，报告 `.openai/apk-02102-public-verified.json`；不等于已验证所有手机网络直连。下载服务PID17368、tunnel wrapper8548、cloudflared12376会按时退出。

## 平台与交付边界

目标Android版本0.2.102-test/code109，沿用原独立测试包包名、签名与数据键，可覆盖安装。预览与APK均使用本机已有天地图Key和38项私有图源配置；不输出Key，不公开上传含Key产物。HarmonyOS6.1原生包本轮未交付。真实Android平移/缩放/拖动手感、覆盖安装、GPS和后台记录未验证。

工作目录D:\天气地图，分支codex/rollback-ui-0235-20260921，HEAD ec47ec0aa5f23cba6dfa2dd576197a82b6f34efe。保留之前的全部本地改动；本轮不新增提交/推送或公开Release。
