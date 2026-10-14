# 山兔0.2.128导航反馈修复交付

用户127真机截图：偏离很远或移动中不重算、箭头方向不准、导航锁定入口消失、调角度会退出跟踪。本轮修复范围为guidance重算/session、position运动方向/跟踪、map相机姿态及controls锁定门禁；没有语音、新权限或清空用户数据。

确认偏航与回线原本分别是35米以上和20米以内；已确认偏航32米处于迟滞区，旧自动规划条件却再次要求35米，形成死区。现在共同使用回线阈值判断是否继续重算，未确认32米仍不会误报。移动造成请求结果不再适合当前位置时拒绝旧结果，按最新可靠点定时重试；普通失败15/30/45秒有界退避。原终点和未到途经点保留，GPS精度/时效及3秒确认仍在，network/IP不作真实GPS。

第一人称定位箭头不再取相机/规划线朝向，采用真实可信course或有足够位移的GPS估向，map alignment负责地图旋转，不重复扣bearing。地图/视角手势不pause跟踪；手势暂缓相机交付，结束继续GPS居中并保留手动pose。显式模式/继续导航可恢复默认相机；锁定计时器不恢复旧角度、不推翻取消。导航本身允许锁定，独立面板/编辑门禁与必解锁保持；保留127紧凑提示和删除黑色行程条。

## 门禁和交付

92项相关测试、tsc、diff通过，含实际React Hooks、假时钟/规划器及35/20m迟滞回归；主agent实际390×857/360×780锁定/解锁、Gizmo调整角度/移动、取消后新点和独立朝东箭头检查通过。截图与逐项再次测试条件见ui-quality-gate.md最新128条目。手机真实GPS、传感器course、锁屏/后台、双指触控/FPS与Windows原生GUI仍未验证；不能以截图输入或模拟验收代替安装复测。原生HarmonyOS6.1未交付。

源码在根目录D:/天气系统，分支codex/place-address-search-20261011；同分支同步GitHub，未合main。旧搜索worktree保留为历史/追溯。固定`APK/山兔手机.apk`、`EXE/山兔桌面.exe`及桌面`山兔0.2.128`更新，127等旧版保留。自用APK通过连接的Google Drive上传/回读名称、大小和仅owner权限；远端未给hash，不声称远端hash核验。私有PC超过Drive连接器100 MiB，只本机交付。

两份Android包versionName0.2.128-test/code135、原包名com.guanyun.weather.shantu.preview、4a94证书/v2v3/对齐/CRC通过；private1926/public1925网页项逐文件匹配fresh stage，497 PNG像素一致。两PC内嵌1929/1928 runtime逐文件相同，frozen自检ok=true。私有天地图Key和39种子保留；公开两平台没有私有env值及种子，不能替代自用固定入口。测试Release：[v0.2.128-test-standalone](https://github.com/Siger1989/map/releases/tag/v0.2.128-test-standalone)，仅公开APK、Windows x64 EXE与SHA256SUMS。

|产物|字节|SHA256|
|---|---:|---|
|自用APK|70260921|`827fc789c2ddee49ce65dba8c52422af22e8daf5ae5cd8d4fecce5af990582e3`|
|公开APK|70256741|`5347893918615c0b8137784d1b122c9fed69543d1fe296da656f894c78b31ed4`|
|自用PC EXE|123838478|`8cd8aae99f49bdba3f80ba30c843d92895c3a89751277f8cff851a4421fceb59`|
|公开PC EXE|123836072|`819e36fbea992f63a8e093dd1a93644da41d3be697efaccc219b3fbd8fa837ff`|

本机核验原始资料写在`.openai/release-128/`，用户Key/运行日志不进Git。签名材料保持原证书，保存在本机ignored路径且有本机备份，没有生成新签名或上传Key。最终提交/远端Tag及资产digest核对写入`source-sync.json`和`github-verification.json`。
