# 观云安卓测试版

当前安装包：`APK/Guanyun-0.1.3-test.apk`，应用名“观云”，包名 `com.guanyun.weather`，版本代码 4。沿用旧版的测试签名，可覆盖安装。

## 安装与使用

1. 把 APK 传到手机，在文件管理器打开安装；已安装旧版时直接更新，不需要卸载。电脑页面修改不会自动进入手机，必须安装新版 APK。
2. 要求 Android 8.0+、OpenGL ES 3 / WebGL 2，Android System WebView 或 Chrome 120+。
3. 界面与成都区域高程内置；道路、卫星图、天气、地质概览及路线服务联网获取，不要求电脑开机或登录 OpenAI。不是全国离线地图包。
4. 默认没有上拉大面板：点左下温度/海拔看天气，右下“时间 / 图层 / 路线”打开小浮窗，点 ×、地图或返回键关闭。海拔/地质图例常驻小色带。
5. 地图单指平移，双指捏合缩放/旋转、双指并排上下滑动调俯仰。右下绿色模型上下拖动调角度，底点不动；椭圆环滑动转向。
6. “路线 → 道路规划”：选驾车/骑行/步行，搜索起终点或点图钉在地图选点，点“规划路线”。显示实际道路路线、距离、预计耗时；顶上的路线摘要可重新打开详情。包含转向列表；尚无实时定位跟随、语音导航、实时路况；道路与手绘均有沿途天气，右侧可主动定位并显示行程位置。
7. “路线 → 手绘轨迹”：先用偏离手指的准星和放大镜精确定点，再拖绿色环平滑画；也可切换逐点连线。单指画、双指直接控图，支持节点吸附、细线/颜色、撤销和本机保存。已保存线路可续画、反向、合并相接线路。点“统计 / 天气”看全程里程、高程剖面/爬升下降，设置出发时间和速度获取沿途天气。手绘线未匹配道路，数据只存本机。

1∶20 万地质云仍缺授权。路线使用 FOSSGIS / Valhalla 公共测试实例，地名搜索使用 Photon；均无生产可用性承诺，后续销售应改为自有后台或有服务保障的提供方。目前其他地图/天气来源仍含非商业资源，不能直接作为已完成商用授权的销售版本。

## 模块与接口

- `main.tsx` / `index.html` / `vite.config.ts`：静态客户端复用网页组件和各模块的样式。产物 `mobile/dist/`，原生 HTTPS 本地资源来自 APK assets，不加载 localhost。
- `android/src/com/guanyun/weather/MainActivity.java`：WebView、安全区、生命周期、外部链接和返回键。原生已避让的系统栏不再重复传给网页；返回键优先关闭浮窗，其次结束轨迹编辑/选点。INTERNET及用户主动触发的前台定位权限，无 JavaScript 原生对象桥。
- `LocalGateway.java`：固定 APK 资源域 `appassets.androidplatform.net`。地形范围内读取本地瓦片，其他区域请求固定 S3；地质概览代理 Macrostrat；卫星日期读取 NASA 元数据；地质云明确未授权。其接口保持原样。
- `DataTransport.java`：固定 HTTPS 源、超时/响应体限制、瓦片校验、日期解析与 64MiB 私有缓存。路线/地名通过网页端 HTTPS+CORS 请求，由 navigation 适配器管理，没有把 Token 放入包内。
- `scripts/build-android.ps1`：Vite / AAPT2 / Javac / D8 / zipalign / 独立测试签名；从 AndroidManifest 读取版本生成文件名，验证签名和 473 张地形瓦片，使用 .NET SHA-256 生成旁边的校验文件。保留 `mobile/.build/guanyun-test.jks` 才能持续覆盖更新；测试签名不用于正式发行。
- 新的功能模块边界、公共服务条件和回滚说明见 `docs/mobile-controls-and-routes.md`。

## 构建与验证

项目根目录 `npm run build:apk`。默认 SDK 为 `D:/GodotAndroid/sdk`（platform 35 / build-tools 35.0.0），JDK 17；脚本支持 `-SdkRoot` / `-JdkRoot` 参数。网站单独运行 `npm run build`。

检查覆盖 TypeScript、天气/地质回归、导航响应与边界、牵引算法/轨迹存档、旋转边界、安卓返回脚本；实际调用路线三种方式及中文搜索。APK 检查包含启动 Activity、版本、v2/v3 签名、静态 worker、覆盖索引、473 张地形瓦片，以及不混入 .env/密钥/开发文件。

本轮未完成新版真机安装、WebView 渲染、牵引手感与性能验收。编译、服务响应和签名通过不代表真机交互已经实测。

0.1.2 详细交互、统计定义、模块接口及验证：见 docs/track-drawing-and-journey.md。

0.1.3新增道路天气色带、路线收藏、定位与方向切换，并修复手机绘制坐标：见docs/navigation-weather-location.md。定位由用户按钮触发，需要系统允许位置权限。
