# 山兔 0.2.83 测试版

版本 `0.2.83-test`，versionCode `90`，Android 8.0/API26及以上，包名 `com.guanyun.weather.shantu.preview`，沿用原独立测试版签名，可覆盖同包名同签名旧版。原数据键和备份格式不改。

本版加入OVMAP图源解析与密集滚动选择、双图源对比与同步相机、中心十字、标记编辑及18种符号选择、画线样式、共享摇杆，以及Android沉浸式系统栏。常规路线操作卡压紧。外部瓦片新增原生传输，不依赖开发电脑代理。

用户指定的本地包默认含39项图源：此前首次导入的2项ArcGIS XYZ配置，加附件去重后的37项OVMAP配置。两项旧格式与新格式分别保留。首次加载事务写入本机地图库，可逐项移除；重启和升级不重新添加已删除项。保留原有用户图源和选择；写入失败不标记初始化成功，也不隐藏原有地图库。

图源清单含用户购买配置及访问凭据，属于本地注入资产，不进入公开源码，也不自动上传含此配置的APK到公开Release。APK不是保密容器，获得包的人可以读取配置。普通构建不含这份清单；只有显式传入下面参数才注入。源码同步不等于该本地配置或APK已公开发布。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -StandaloneTest -DefaultMapSources '<本机图源JSON路径>' -SdkRoot '<Android SDK目录>' -JdkRoot '<JDK17目录>' -SigningKey '<原签名文件路径>'
```

配置格式为 `{ "version": 1, "maps": [MapDraft配置] }`，在线栅格图源1–100项、文件至多1MB。不把清单放入 `public/` 或Git；本机交付资产注入暂存目录的 `native/default-map-sources.json`，构建核对包内哈希与输入一致。

验证：788/788测试、TypeScript、SDK35 Java编译和原生传输定向测试通过。原生样本Mapquest与腾讯返回JPEG，ArcGIS当前样本502；供应商权限、网络、服务覆盖仍会影响实际显示，不能宣称39项全部可用。结构检查存在7个此前已超行数预算的文件，本轮未抬高预算；功能检查通过不等于结构检查通过。

浏览器接口连接失败，最终屏幕布局和Android触控/全屏/安装保留数据仍待真机验证。尚无HarmonyOS6.1原生HAP/APP，Android APK在该设备上的兼容安装也未验证。最终APK哈希、字节数、构建源码和发布状态记录于 `CURRENT_STATE.md` 与本机安装说明。
