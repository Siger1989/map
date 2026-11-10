# 山兔·优化 0.2.195 私人测试版

目标 Android `com.shantu.oldengine`，0.2.195-test / versionCode202。针对用户“手机照片已有位置，导入却说没位置”的反馈，补齐Android照片原始位置读取。194及此前包保留，不原位替换。

## 修复与边界

- 194确有适配缺口：未声明/请求ACCESS_MEDIA_LOCATION，未对系统支持的所选媒体原图请求未脱敏EXIF。Android官方说明媒体位置可被脱敏；尚未拿到用户原片，因此不把这一缺口认定为该照片全部原因。
- 仅工具→照片标记的Android入口按需申请照片原始位置权限；普通照片附件、相机、路线导入不申请额外照片位置权限，不增加全图库读取权限。拒绝授权取消本次选择，不绕过拒绝。
- 授权后对所选MediaStore、可映射的Media/DocumentsProvider/ExternalStorage URI使用MediaStore.getMediaUri/setRequireOriginal。普通SAF或file保持原URI；原图不可用时仅尝试用户已选文件，并明确GPS可能缺失。原图不写入、不以当前定位代替。
- GPS字段通过原生压缩副本保留至React EXIF解析和50米标记合并流程。取消的旧批次不能清掉新GPS选择状态；未知GPS提示改为“未读取到可用GPS”，区分数据未记录与提供方未提供的可能。
- 沿用194照片大小与稳定纹理、罗盘、图源批测、图层开关和统一边距。没有其它功能重构；原签名、存储键、内置天地图和39私人种子保持。手机增强自定义图源未读取/重置，实际升级保留仍待用户验。

## 验证记录

- Node照片导入/EXIF/GPS标记/保存：16项PASS；TSC PASS。
- Native权限、拒绝/取消、普通入口、原图URI、旧批次隔离，以及NATIVE位图/EXIF保存：定向9项PASS（45秒）。权限拒绝/关闭的框架Intent队列断言已按独立Activity隔离修正；最终无失败。
- fresh私人Web7.82秒PASS；optimized APK与包名/版本/签名/资源一致性/实际manifest权限：构建交付中。
- 手机未连接/安装，OPPO权限弹窗、相册URI映射、用户原片GPS成功率尚未验证；浏览器无法证明Android权限流。194定向390/360窗口证据保留，195提示长文本未另作视觉验收，用户自验。
- 云端账号/好友暂缓；HarmonyOS6.1原生HAP未交付。

## 交付

待最终产物完整性通过后先发本机独立APK。GitHub私人备份须单独核验：194大文件三次上传均未完成，不能称远端APK交付成功，不以远端网络问题阻塞本机测试包。

官方依据：[Android读取照片位置信息](https://developer.android.com/training/data-storage/shared/media#location-media-captured)、[MediaStore.getMediaUri](https://developer.android.com/reference/android/provider/MediaStore#getMediaUri(android.content.Context,%20android.net.Uri))。
