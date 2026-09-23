# 山兔 0.2.66 测试版：框选与地点标记操作

地图框选工具缩成两行：默认可平移、缩放地图，点“画框”后拖选一框会返回地图操作；结果列表独立滚动，导出、分享、删除按钮保持可见。收藏夹与框选导出地点 Excel 时优先使用已存地区信息，缺失时有限查询并在失败时保留空列。标记自定义条目输入时适应键盘缩小的可视区，底部导航暂时隐藏；进入标记“调整”后，移动轴贴合当前地形、位于图标下方，地图旁和操作卡显示经纬度，完成后轴消失。

## 安装与平台

| 平台 | 产物与安装 | 验证状态 |
| --- | --- | --- |
| Android 8.0及以上 | [Shantu-0.2.66-test-standalone.apk](https://github.com/Siger1989/map/releases/download/v0.2.66-test-standalone/Shantu-0.2.66-test-standalone.apk)，可覆盖同签名“山兔测试版” | 构建、签名、打包网页启动和浏览器操作通过；真机覆盖安装与触控待验 |
| HarmonyOS 6.1 原生 | 暂无 HAP/APP 或邀请链接 | 平台适配、合法签名与安装验证未完成；Android APK 仅在设备支持时可兼容试装 |

包名 `com.guanyun.weather.shantu.preview`，版本 `0.2.66-test`、versionCode73，沿用既有 `4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f` 签名。源码在 `codex/rollback-ui-0235-20260921` 分支，未合入 main。存储键、布局草稿、照片/轨迹格式和地图图源未改变。

## 验证与限制

- TypeScript、626项逻辑测试、网页构建、Android网页/Java/DEX/APK构建、打包网页启动、签名、zipalign、473块随包地形资源通过。浏览器390×857及360px宽检查框选，390/360px宽与530/450px键盘占位检查条目输入，70°倾斜地形上检查有/无存档海拔的标记轴、坐标变化与完成隐藏。
- 本地文件 `APK/Shantu-0.2.66-test-standalone.apk`，57,830,492字节，SHA256 `282bbe0b6a6be13bd0d497e24dd02ef4a75cc4a4c6d30d7f5f12d1a786e693bc`，同目录有 `.sha256`。与上版同包名/签名且versionCode递增，可覆盖同系列安装；实际设备覆盖及用户数据保留仍待验。
- `npm run check:architecture` 因六个超长模块未通过；这六个文件在本轮修改前已超过长度预算。本轮只做出包范围内的局部修改，没有混入模块重构。
- 浏览器模拟不能替代Android中文输入法、真实触控和网络逆查；HarmonyOS 6.1 原生安装包尚未生成。
