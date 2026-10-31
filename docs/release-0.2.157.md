> **157外网交付补充（用户本轮明确授权）**：用户在手机外网请求含私人天地图的下载地址；已建立只开放这个已审计APK的临时HTTPS单文件下载通道，使用随机不可枚举路径，支持HEAD/Range，根目录和其它路径404，最长12小时后关闭。地址只提供当前用户，不写源码/公开文档或公开Release；不是把凭据包发布到公共仓库。本机完整外网回读校验结果记录`.openai/private157-external-download-proof.json`，存在PASS记录后才称完整下载一致。临时服务依赖本机持续在线，不能冒称永久网盘链接或手机已安装。

# 0.2.157-test 私人试修版

本轮处理手机156静止闪烁、画线卡顿、节点不明显/高亮错位和道路吸附直连。**157是试修包，手机静止闪烁尚未确认解决。** 原因、方法、代价和下一步见[157交接](HANDOFF-20261031-157.md)。

## 安装包

- 版本0.2.157-test / versionCode164；包名`com.guanyun.weather.shantu.preview`，原签名及桌面启动别名保留，R8 optimized非调试包。
- 本机`APK/Shantu-0.2.157-test-private.apk`、固定`APK/山兔手机.apk`、`交付包/山兔-0.2.157-test-2026-10-31/01-Android-APK/Shantu-0.2.157-test-private.apk`内容一致。
- 大小165167188字节；SHA256 `751ddf8dedaaf3ce15d4fc7ccc72f3266384230c85bf7f3f760a757250b16f79`。
- 签名证书SHA256 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`。
- 原156版本化APK完整保留，SHA256 `01d758cfa848368c1525e0e12a27b449d32a13d16a8d9bd373ddd6e95508ea1d`。安装前保存未落盘的记录/草稿，沿原包名覆盖安装，不先卸载。
- 私人天地图保留；39源、1925份fresh React资源、React/native私人配置一致、CRC、473+23 DEM、4份64位ELF与16KiB对齐/zipalign通过。Key仅核验存在性和一致性，未打印/提交。

## 验证及边界

- TSC、fresh私人React构建、optimized构建PASS；31项Node及17项Kotlin定向检查PASS。
- 额外28项行为检查PASS，1项旧Android外壳manifest版本断言FAIL（旧manifest142/code149）；实际混合APK通过独立badging及安装后身份核对为157/code164。未将这项失败隐藏为全套通过。
- MuMu3真实157覆盖安装/启动和三点画线PASS；节点圆点可见、接在线段顶点，临时三点逐次撤销后退出。无损证据`artifacts/screenshots/native157-drawing-nodes.png`；所测为约391×834CSS实际设备窗口，不冒称390×857/360×780全矩阵已重测。
- 新渲染缓存预算在模拟器实际读到258203648字节（约246.2MiB）。内存预算增加不等于已确认真机根因。
- 手机156为用户确认FAIL。157真机静止闪烁、所有高度/图源、多指与长线手感、节点选中拖动及主双图长时内存仍未验收；未宣称全功能/全视觉通过。

只在本机提供私人APK，未公开含凭据包，当前无附件或永久云端下载ID；本轮已按用户要求提供临时外网单文件地址。源码/文档同步工作分支`codex/tianditu-loading-20261027`，未合main。HarmonyOS原生HAP未交付，EXE/DMG未重建。右侧9174为实际原生APK视频/触控，视频不作FPS或细线清晰度验收。

157同机静止扫测已完成：z9/11/13/15/17各俯仰0/55°共10姿态、每段8秒，后半段各5份有效计数全部底图新增解码0，实际帧增量0–14；GPU驻留约29.3–223.8MiB。相机恢复，标记数不变。156同机基线也未复现循环，因此此结果仅证明限定样本未见重复解码，不能证明手机闪烁已修复；等高线设置沿用，未强制关闭。去坐标/URL的数字摘要`artifacts/performance/native157-static-sweep-20261031/summary.json`。

另做实际按下→连续MOVE→抬手画线，最终节点与末次准星位置相接，无损图`artifacts/screenshots/native157-after-move-release.png`；该次37步同步ADB触控注入超过客户端5秒读超时，后续确认手势完成、UI响应正常，不能把注入时长当手机FPS或无卡顿证明。新增两点已撤销并退出，未保存测试路线。
