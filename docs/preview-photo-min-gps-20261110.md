# 2026-11-10 照片最小尺寸与部分GPS未读排查

状态：快速预览增量，基于196/code203；未升版、未生成197 APK、未提交/推送本轮增量。手机已装版本未读取，196私人包仍是上一包，不能说手机已应用20px下限。目标GPS根因仍待失败原片对照，不凭同机/同时间推断位置。

## 已修改

- modules/photos/mapPresentation.ts：照片外框最小20 CSSpx、最大32，继续沿标记模式与连续zoom缩放，在下限停止缩小；Web 44px触控范围不变。
- mobile-native/app/src/main/java/com/shantu/nativeapp/map/NativePhotoLayer.kt：同样20px下限，主/双图复用；只改imageScale，不替换对象/纹理，密度回退图也保持下限。
- 对应Node与NativePhotoLayerTest更新下限/密度/同对象/旧纹理回退验证。未改GPS解析、照片原片、存储、导入权限或普通标记。

## 检查

- 21定向Node、20Native（含8实际位图/照片层、12照片权限/预处理与状态）和TSC PASS。未跑无关全套。
- 私人390×857右侧主图实际Web DOM：原zoom12.07照片外框25.18px；zoom9.07、8.07/icon与7.07/dot为约20px（外框变换误差19.997），点击范围约43.99px。图片复用，不写照片/标记数据。
- 缩放按钮连点会在ease动画中产生非整数结果，检查后通过既有phone-preview.html的hash视图入口精确恢复原12.07/中心/bearing，再确认地图和三张照片已加载、外框25.18px。右侧手机框保留，未留低级别视角。
- 截图 artifacts/screenshots/photo-min-197/minimum20.jpg 为低zoom地图全景；多个同位置照片与普通标记有重叠，因此图片仅记录视角与地图状态，不宣称消除遮挡或照片可辨性真机通过。
- 未安装手机/启动模拟器；手机最小照片体验、双图画面、360/矮屏本轮未新验。现有天地图/39种子及旧包未改变。

## GPS与百度补充，仍待核实

用户明确部分照片显示“未读到可用GPS”，同时同一手机/相近时间其它照片可导入。代码只读确认：PhotoImportCache.prepareSource吞掉ExifInterface构造异常后仍可能生成无EXIF副本；JS exifr.parse异常同样归为undefined，最后均表现为无GPS。它证明现有提示不能区分解析失败与文件真缺GPS，不证明用户原片就是这个原因。用户原片、具体格式与已装版本均未读取。

Android官方说明android.media.ExifInterface在部分系统有已知问题并推荐AndroidX；当前未引入新库/放宽GPS校验，避免以猜测冒充修复。官方来源 https://developer.android.com/reference/android/media/ExifInterface 。本次未采用AndroidX迁移，也未顺带修改不相关的OOM风险。

用户对“失败照片相册详细信息是否显示位置”的回复是“我在百度地图一直显示加载中”；已请求澄清是点照片位置后外部百度页面加载，还是山兔切百度图源加载。不能把该回复当作确认原片有GPS。后续需要一张失败原片与一张成功原片作只读对照（作为文件保留EXIF），才能确认原片GPS、系统提供方脱敏、原生解析/转码或JS校验具体环节；不以当前定位或拍摄时间补造坐标。
