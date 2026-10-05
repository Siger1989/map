# 0.2.103-test：地形平移误判为放大

用户在0.2.102之后反馈，拉长时不加点，但一平移地图，中间编辑点又出现。0.2.102的合成测试没有覆盖真实地形引擎导致的缩放微变，因此其“平移保点”结论不完整。

## 根因与修复

直接在用户9291现场复现：地形开启、pitch=0，空白地图平移25px后zoom从15.931250881400532变成15.93129787555636。旧实现把缩放值四舍五入到百万分之一作为细节key；这个微小地形修正清除了编辑区间的隐藏点记录。MapLibre源地图平移没有zoom事件，但双图CameraSync复制实际相机时，另一图的jumpTo会发出zoom事件。

- 新增cameraDetailZoom，使用真实zoom事件更新编辑密度，地形平移修正只刷新屏幕投影。
- CameraSnapshot携带detailZoom，CameraSync同步期间屏蔽jumpTo产生的伪缩放，主动缩放仍向两图同步细节。
- SegmentHandleCache在段数/长度不变时保留重合拓扑变化、expanded折叠/恢复之前的隐藏区间；实际新共享节点仍可编辑，折叠状态不强制显示全部控制点。
- 原始点数量、数据格式、备注、颜色、撤销语义保持。没有增加逐帧全路线计算。

## 验证

| 项目 | 结果与证据 |
| --- | --- |
| 定向逻辑测试 | PASS，87/87，`.openai/pan-detail-tests.log` |
| 旧逻辑对照 | 独立临时esbuild将TrackLayer改回raw zoom；新双图长跨度回归在“平移不应显示隐藏顶点”断言失败；修复通过 |
| TypeScript | PASS，`.openai/pan-detail-tsc.log` |
| 390单图地形 | 拉长后平移，实际zoom13.869908571284455→13.869761057061572，detailZoom固定13.870200474306694；两条长直线中间无新增点 |
| 390双图 | 50度，上图拉长/上下图平移保持隐藏点；主动+1级后正常显示更细节点 |
| 360×780双图 | 40度，上图拉长、下图继续拉长和平移保持隐藏点；两次撤销后退出 |
| 截图 | `artifacts/screenshots/pan-detail-20261003/`，包含release、pan、dual-upper/lower-pan及主动zoom |
| APK | fresh build + aapt/signature/zipalign/CRC/assets/config全部PASS |

测试用独立9293的合成5800点GPX，不冒充真实走轨；合成改动撤销，测试tab与服务关闭。用户9291仅手动平移诊断，没有手动保存/撤销/清空/刷新；但后续版本更新触发整页重载，原先未保存的编辑会话丢失。已保存路线仍在。此前“草稿会保留”的说法已向用户纠正；当前useRouteEditor只有内存会话，无重载恢复记录。

边界：Android真实触控手感、帧率、覆盖安装、GPS/后台未验证；编辑隐藏区间仍是当前地图的渲染状态，重新加载后按当前视图生成控制点；段结构变化会重新建立采样。另观察到360单图编辑面板遮挡工具菜单，可退出编辑后进入双图，未纳入本次修复。HarmonyOS6.1原生包仍未交付。

## 本机产物

- `APK/Shantu-0.2.103-test-standalone.apk`，0.2.103-test/code110。
- 包名 `com.guanyun.weather.shantu.preview`，66,085,680字节。
- SHA256 `55f4c2c5cfb82674eef621d34e8741e6494c7a6f2d43a15af13a4c8b31bdd0eb`。
- 原证书SHA256 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`，v2/v3、zipalign通过。
- 明确暂存 `mobile/.build/apk-20261003-003241`：1910assets逐项匹配、496地形PNG像素、38私有种子字节、1365概览tile哈希通过；preview/production/包内已有Key一致，仅输出布尔。
- 构建日志 `.openai/build-0.2.103-local.log`；独立报告 `.openai/package-02103-integrity.json`、`.openai/package-02103-config-check.json`。

工作目录D:\天气地图；分支codex/rollback-ui-0235-20260921，HEAD ec47ec0aa5f23cba6dfa2dd576197a82b6f34efe。原有大量本地修改保留，未新增commit/push或公开含Key APK。

临时手机下载：[https://readily-dogs-portal-perfectly.trycloudflare.com/600792556517b9c6a3281434f39df800abc7/Shantu-0.2.103-test-standalone.apk](https://readily-dogs-portal-perfectly.trycloudflare.com/600792556517b9c6a3281434f39df800abc7/Shantu-0.2.103-test-standalone.apk)，北京时间2026-10-03 02:35到期，电脑须在线。外网完整下载SHA/字节数与Range206核验PASS，报告.openai/apk-02103-public-verified.json。单APK能力路径，两小时自动结束；未改变系统代理配置。
