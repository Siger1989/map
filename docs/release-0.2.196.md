# 山兔·优化 0.2.196 私人测试版

目标 `com.shantu.oldengine`，0.2.196-test / versionCode203。修正照片标记导入成功后仍显示“系统未提供原图”的误导提示，并提供可完整查看的读取结果。195及旧包不替换。

## 用户反馈与已确认原因

用户明确通过“导入照片”选图，并追加说明“但是导入成功了”。因此不能再把本次当成照片GPS导入失败。195的确定代码路径是MediaStore原图通道失败后，所选文件备用读取成功，仍无条件把“系统未提供原图……GPS可能缺失”加入错误列表并显示长Toast；即便备用文件有有效GPS也会弹。未读取手机已装版本或原片，不把这次成功扩大为所有照片/设备均通过。

## 改动范围

- `AppFiles.java`：GPS备用读取成功仅记录“已通过所选文件读取”，不归为失败、不弹原图受限警告。最终GPS解析/保存结果仍由原流程决定。拒绝、取消、失败和超量等完整状态保留在内存中，当前Activity重开面板可查看；不存磁盘日志。普通非GPS导入原有异常提示和四条上限保持。
- 新增 `PhotoImportStatus.java`；`NativeBridge.java`新增只读`photoImportInfo()`，受trustedForeground保护；仅文件名/状态/文字，无URI、坐标或密钥。同批终态阻止关闭后的异步线程恢复preparing，旧批次不能覆盖新批次；完成只在缓存核对成功后发布。
- `GpsPhotoPanel.tsx`、新增`nativeImportStatus.ts`及`useRecording.ts`桥接类型：原生读取状态在页面显示，失败列表和中性详情可展开/滚动。最终标记保存成功保持成功结果，不用原生文件准备结果代替GPS/保存结果。后台暂停轮询、关闭面板释放轮询，旧包无getter时兼容。
- 新增Native/Node状态测试。仅提升版本及必要文档；未增加权限、未改原图/GPS、50米合并与照片存储格式、地图/路线/罗盘/图源和其它194/195功能保持。原签名、本人内置天地图、39私人种子、原存储键保留。手机“增强”自定义图源未读取/重置，升级保留未实测。

## 验证

- 19项Node照片导入/EXIF/GPS保存/桥接状态边界，12项Native权限/EXIF缓存/终态与批次状态通过。TSC通过，fresh私人Web8.14秒通过。
- 实际浏览器390×857与360×857合成组件检查（本轮未另验360×780）：276px宽/最高200px，无横向溢出，长提示可完整查看；12失败末项滚动可达（72px列表，386px内容），返回/关闭通过。合成GPS原片经真实readPhoto解析，在不写用户数据的QA回调显示1照片/1标记、0缺GPS；这是组件检查，不证明Android系统原片读取。原图通道受限→中性详情、拒权限完整文案均已检查。
- 截图本机：`artifacts/screenshots/photo-status-196/fallback-info-390.jpg`与`full-message-360.jpg`。临时QA页面已移出mobile并归档`.openai`，不会进入APK。右侧私人390默认地图保持，用户原数据未写。
- optimized3分10秒，原签名/包名版本/实际photoImportInfo getter DEX与fresh JS接线/1925资源/39私人种子与Key一致/CRC/16KiB ZIP及64位ELF完整性PASS；8SO同195，QA页面未打入APK；未连接/安装手机，不称196提示体验真机验收。
- 云端账号好友继续暂缓；HarmonyOS6.1原生HAP未交付。

## 交付

本机独立APK已先交付：[Shantu-0.2.196-oldengine-private.apk](D:/天气系统/APK/Shantu-0.2.196-oldengine-private.apk)。

包名`com.shantu.oldengine`，0.2.196-test / code203，165392384B；SHA256 `769b6e97bb33a5447584e57cf99a799f05ff416cffb882e8ea034ca206ff3de7`。原证书SHA256 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`；正式与180–195包哈希未变。

应用源码[`c76c73c`](https://github.com/Siger1989/map/commit/c76c73cd938512354351682fc5b100f6b022c6b6)已推`codex/old-engine-tilt-dual-20261105`并核对远端一致，非main。安装前保存草稿/结束记录，覆盖安装山兔·优化；不要卸载或清除数据。已成功导入的照片无需重导。

194/195私人仓库大文件上传未完成，保持草稿；196也只在实际上传和回读核验后才报告远端交付成功，不以网络问题阻塞本机包。


196私人仓库APK上传45秒超时，复查仍PRIVATE、Release为草稿、仅4份元数据附件，APK未完成上传；未完整回读，不声称远端交付成功。本机独立包已交付，哈希和资源核验不受影响。
