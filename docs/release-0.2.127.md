# 山兔0.2.127-test导航基础优化交付（2026-10-14）

搜索结果“去这里”自动进入当前位置规划；导航保留正常跟随和第一人称，普通启动默认俯视。第一人称转向卡缩到约240×121px（含位置说明；正常更矮），距离28px，不再占约294×196px。俯视只保留必要操作；统计和重规划/分享/显示设置可按需展开。删除底部黑色“已走/剩余”行程条，不添加语音。

地图路线使用单条绿带、白色指引与蓝白定位；已走灰化。黄线与原路线等宽、顺滑相切接入，接入后方显示灰色，俯视与前视一致。GPS横向偏移只说明“道路待确认”；稳定沿线方向才能提供黄线方向参考，远离/反向/精度不足时不画误导接回。方向参考不是可通行道路，也不能证明主道/辅道；真实偏航仍沿用连续距离确认与实际道路重规划流程。保存标记双指变换保持布局，PC首笔先筛落点附近候选，用户已保存坐标、数据格式与签名不改。

## 交付入口与源码

项目根目录源码切换至 `codex/place-address-search-20261011` 的本发行提交；旧根目录两项tracked改动存入带`navigation127 source sync`说明的Git stash和`.openai/release-127/root-original-*`，未删untracked产物/存档。旧搜索worktree保留同一最终源码作为预览，detached HEAD；没有合入main或重写历史。

本机固定入口 `APK/山兔手机.apk`、`EXE/山兔桌面.exe`，桌面 `山兔0.2.127` 文件夹及新快捷方式；125/126手机和124/126桌面归档保留。自用构建保留已有天地图Key、39图源种子；Key不进源码或公开Release。本机和共享主图/双图保持内置天地图入口。自用APK通过已连接Google Drive上传并回读名称/大小/仅owner权限；它是Google Drive，不是Codex自有网盘。远端未返回hash，不能声称远端hash核验。私有PC EXE超过连接器100 MiB单文件限制，本机已交付，未上传私有Drive。

GitHub源码同步本功能分支；测试发行tag `v0.2.127-test-standalone`，资产仅为清除私有配置后fresh构建的APK、Windows x64单EXE与SHA256SUMS。公开包不包含私有天地图Key及图源种子，不能覆盖本机自用入口来冒充对齐。公共测试发行：[GitHub Release](https://github.com/Siger1989/map/releases/tag/v0.2.127-test-standalone)。最终远端SHA/发行资产digest与本机匹配核验写入`.openai/release-127/source-sync.json`和`github-release.json`，不是仅执行上传命令。

## 产物核验

Android独立测试包 `com.guanyun.weather.shantu.preview`，versionName `0.2.127-test`，versionCode134；原证书SHA256 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`，v2/v3签名及zipalign通过。

|产物|字节|SHA256|
|---|---:|---|
|自用APK|70260921|`067aa522e48c9f811d2995a0322aa40b554cd91ca404a1f11d039c877f7047b7`|
|公开APK|70256741|`67016b7f2db8f33d64e9db45cb003ba7c2a81ae88d9d4fcc3c01cacf74548a04`|
|自用Windows EXE|123839746|`530ca638e211c6a2f27de62566e9a5472f6818b52ee07704f4a217b2d20c3269`|
|公开Windows EXE|123837852|`ca5b391f4a470a397cc2565f5c187eec27a1e0081756006c3ed38cd85507db07`|

两APK CRC、fresh网页逐资源一致性及PNG像素一致性通过（private1926/public1925项，497张PNG；地形基础473）。私有Key嵌入、39项种子内容相同；公开APK/PC全部网页文本与本机凭证值比对为0匹配且无私有种子。两PC内嵌runtime逐文件匹配（private1929/public1928），frozen自检`ok=true`：本机网关与模板SVG/PNG出图通过。

158项相关导航/标记/路线/缓存/首笔测试、TypeScript和diff检查通过；主agent实际复核390×857、360×780、390×480提示尺寸、44px按钮、俯视/前视切换与展开收起。真实私有APK网页启动及内置天地图选择可见；静态网页缺少native网关，IP请求失败没有冒充GPS。

手机实机安装、定位/锁屏/切应用恢复、双指触控与FPS、Windows原生GUI仍未验证。原生HarmonyOS6.1工程/签名工具链未就绪，本轮没有原生鸿蒙包。以上是测试交付，不代表全业务或真实设备验收；完整门禁和截图见`ui-quality-gate.md`最新条目。
