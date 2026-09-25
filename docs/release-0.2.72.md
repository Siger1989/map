# 山兔 0.2.72 界面优化测试版

包含已确认的深色黄绿界面规范、其他面板与子窗口统一样式，以及本轮反馈修复：

- 输入和按钮焦点框统一内收，修复收藏搜索边框裁切和路线双层高亮；无候选时不弹空联想层。
- 路线“收起”明确为“收起搜索”，保留输入值。记录“位置标记”和“拍摄 / 导入照片”采用等宽双列，文字完整显示。
- 窄屏/矮屏的地图工具收纳、记录内容滚动、固定标题与16px表单输入；已保存的个性化与业务内容颜色保留。
- 纳入0.2.71之后已保存的图层开关、透明度、细节上限及图源设置记忆。业务包名、签名、轨迹/照片存储格式保持不变。

## 安装包

| 项目 | 结果 |
| --- | --- |
| 文件 | `Shantu-0.2.72-test-standalone.apk` |
| 版本 / versionCode | 0.2.72-test / 79 |
| 包名 | com.guanyun.weather.shantu.preview |
| 大小 | 57,846,876 bytes |
| SHA-256 | `BA2036A675122E507F0BDC4A14B36B27820587E07E3F4DD874775C63A656E378` |
| 最低系统 | Android 8.0（API 26） |
| 签名 | 沿用4a94证书，v2/v3通过 |

[测试版页面](https://github.com/Siger1989/map/releases/tag/v0.2.72-test-standalone) · [APK下载](https://github.com/Siger1989/map/releases/download/v0.2.72-test-standalone/Shantu-0.2.72-test-standalone.apk)

沿用原独立山兔测试版的包名与证书，满足覆盖升级条件；安装时选择更新，保留现有应用数据。实际真机覆盖安装与数据保留尚未验收。

## 验证与边界

- TypeScript及653项完整测试通过。首次测试中的JDK路径和Windows短临时路径问题，仅在测试子进程指定实际JDK与长路径TEMP/TMP后解决，未修改系统设置或降低断言。
- 从最终源码全新构建网页与APK；apksigner、zipalign、版本包名、473张地形瓦片、修复瓦片清单、worker和必需资源核验通过；包内排除密钥、环境文件和开发目录。SHA-256 sidecar与实际文件一致。
- 390/360和矮屏界面已验证；最终打包网页启动、版本和焦点样式单独检查。静态网页冒烟不包含原生地形桥接，外部高程加载提示不作为原生地图验收。截图位于artifacts/screenshots，检查日志在.openai/apk-0272-*。
- 未连接Android真机，安装、中文IME、触控、相机往返和后台GPS仍待实测。弱信号轨迹断续仍待原始数据诊断。
- HarmonyOS 6.1原生HAP/APP未交付；此文件为Android APK，不能保证纯鸿蒙可安装。
- 源码发布于codex/rollback-ui-0235-20260921分支，Release tag对应本版构建源码，不表示合入main。
