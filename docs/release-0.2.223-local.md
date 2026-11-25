# 山兔 0.2.223 本机私人 Android 包

「工具 → 地形打印」自动使用本机私人 APK 内置的 NASA Earthdata 令牌。手动输入仍可用于更换过期令牌。原生下载网关只向 NASA NSIDC 授权服务器提交令牌，后续分块请求使用通过校验的签名地址。

实网测试使用用户令牌，11 次签名跳转和 Range 读取生成了 5 × 6 的 8 米网格及 STL。19 项地形相关定向测试通过。Android 真机内的完整流程待验。

本机私人 APK 含用户令牌，仅本机交付。既有 0.2.222 APK（构建号 229）保留。本次版本为 0.2.223-test，构建号 230，沿用 `com.shantu.oldengine`。

本机归档为 `Shantu-0.2.223-oldengine-earthdata-local.apk`，166,082,242 字节，SHA-256 `731c7124f9e1fd758b304fc0a711ccfbcdeb07f7f0199efcade1fe6d841b04f5`。原签名、16 KiB 对齐、网页资源和已注册的天地图配置通过。受保护 DEM 与 STL 测试已用签名 APK 中的令牌复测。
