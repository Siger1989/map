# 山兔0.2.44：导航保持亮屏

- 普通导航与拉力导航共用前台常亮逻辑，开始导航自动启用，结束/取消导航、组件退出或页面重新加载时解除；回到仍在导航的页面重新启用。
- Android通过Activity的FLAG_KEEP_SCREEN_ON保持前台亮屏，不改变系统息屏时间，不增加权限。切到其他应用后系统仍可正常息屏，手动电源键锁屏仍有效。实现依据：[Android官方说明](https://developer.android.com/develop/background-work/background-tasks/awake/screen-on)。
- 仅修改导航状态与Android桥接接口，既有记录、路线、收藏、GPS采样与存储格式不变。保留0.2.43记录保存修复。
- 定向导航逻辑检查、类型检查和最终APK构建执行；原生编译、签名、zipalign、版本与资源检查随打包执行。未接Android真机，需要安装后验证导航超过系统息屏时长仍亮屏，以及退出后恢复自动息屏。浏览器版此次未增加常亮API。

安装：Android8.0及以上，`Shantu-0.2.44-test-standalone.apk`，versionCode51；沿用独立山兔签名，直接覆盖安装，不卸载旧版。HarmonyOS6.1原生HAP/APP未交付，APK不代表原生鸿蒙支持。
