# 0.2.139-test：拖动地图临时缓存

用户反馈往返拖动时清晰度反复变化。本轮保留近期已解码瓦片，MapLibre每个图源的缓存系数5→8、上限256；已有浏览磁盘缓存之前增加16MiB/512项内存LRU。保留TTL、服务端缓存限制及调用方副本隔离；forget/put/dispose使在途旧读取失效，防止迟到结果覆盖新图。未修改最终画质、相机、图源、路线离线包或138的请求并发。实现、范围和受控测试见 [临时缓存记录](recent-tile-cache-20261025.md)。

## 验证与交付

- 23项定向检查、TypeScript和fresh Android网页/私人预览构建通过。旧原生取消测试错误假定异步缓存查询会同步发网，现等待fetch开始后再取消，仍断言原requestId、不发送URL及取消行为。
- 真Chromium/MapLibre6.7.0，390×857和360×780两档画质的本地no-store模拟瓦片回访：默认12或32张新请求，本轮均0；3D假地形回访影像与DEM均0新增请求、0错误。主审检查fixture、JSON与2D/3D截图。不能代替真实手机性能、GPU内存及限流验收。
- 私人APK139/code146，包名 `com.guanyun.weather.shantu.preview`，原签名SHA256 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`，v2/v3通过；1927项网页资源与本次stage逐一校验，DEX、Key存在性及39种子一致。
- APK大小70301972字节，SHA256 `7e5d90ba422b39af67f66907edc9de5e9127edaa4c96d9841e7478afd9c20900`。交付于 `交付包/山兔-0.2.139-test-2026-10-25/01-Android-APK/Shantu-0.2.139-test-private.apk`，固定 `APK/山兔手机.apk` 同步。旧包保留，私人产物未公开上传。
- 9174私人预览更新139，内置天地图及“我的图源·39”菜单、返回/关闭检查通过，截图 `artifacts/screenshots/cache-background/preview-139-sources.png`。前轮真实天地图HTTP429尚未解决，本轮没有再批量请求它；入口/配置通过不代表天地图真实加载通过。

## 平台边界

已交付 [Mac138独立窗口测试DMG](macos-native-window-20261024.md)，它不包含139临时缓存。Mac138文件完整性通过，Apple Silicon原生窗口CI通过，Intel CI WebGL2失败；当前私人包未上机验证、未签名公证。Windows EXE仍133，未重建。原生鸿蒙未交付。

完全没看过的区域、超出缓存容量、切换图源/重建source或改变画质仍可能需要加载。缓存不会保证始终同一清晰度，也不能绕过服务器限流。真机同图源/同范围/同画质的往返拖动、长时间双图内存压力仍待复测。源码同步搜索功能分支，未合main；最终远端SHA另核对。
