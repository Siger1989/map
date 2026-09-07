# 地形异常瓦片修复

入口 `modules/terrain/tiles.ts` 提供修复覆盖查找、统一缓存版本，以及旧离线包兼容策略。网页高程 API 和安卓 `LocalGateway` 从同一份 `public/terrain/repairs-v1/coverage.json` 查找修复资源；三维网格、着色、等高线、点选海拔和新剖面使用同一高程来源。

## 鄂陵湖附近，2026-09-07

用户视角：`#13.64/34.85086/97.76257/0/80`。原始 Mapzen z12/3160/1624 瓦片的相邻像素出现 2988m 和 5585m，而周边约 4270m；z11 父级也有尖刺。同一位置 z13 高程无该千米级异常。已直接比对原始 PNG，问题发生在上游低级瓦片中。

修复范围为 z12 的 x=3159–3161、y=1623–1625 九张瓦片，以及它们的 z7–11 父级，共 23 张资源。使用同源 z13 的 36 张瓦片，先解码为米，再做 2×2 面积平均。外边缘 16 像素渐变衔接；父级只更新受影响的局部区域，保留区域外原始像素。没有全局削峰、按高度截断或手工捏造高程。

修复后两个已知异常像素为 4275.75m / 4288.75m，主瓦片范围 4264.60–4364m。这是栅格高程估计，不能当作现场测量；本轮只覆盖已核查区域，其他地区的上游数据仍可能存在异常。

## 重建、验证和回滚

`python scripts/prepare-terrain-repair.py` 需要 numpy/Pillow，将原始输入缓存到被忽略的 `outputs/terrain-repair-source`。输入/输出 SHA-256、来源、处理方式和统计写入 `SOURCE.json`。`--verify-only` 校验现有资源，不联网。运行时不依赖 Python，也不新增在线服务。

统一 URL 新增 `revision=repairs-v1`，绕过旧浏览器跳转和坏瓦片缓存。旧离线包在修复区外继续复用；修复区内需要联网重新下载一次新版高程（新版安卓打包中直接内置修复瓦片）。不删除已有行程或离线包。安卓构建检查覆盖清单中每张资源都已入包。

回滚时恢复地形 URL、网页/安卓路由及离线兼容改动，再移除修复资源；成都 FABDEM 原始资源、路线/照片/标记存档不变。

原始高程与署名：[Tilezen / Mapzen 数据来源](https://github.com/tilezen/joerd/blob/master/docs/attribution.md)、[Terrarium 格式与服务](https://github.com/tilezen/joerd/blob/master/docs/use-service.md)。原数据许可继续适用，本修复不改变其他图源许可。
