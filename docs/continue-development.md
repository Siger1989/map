# 换电脑继续开发

项目仓库：[Siger1989/map](https://github.com/Siger1989/map)。最新状态看根目录 `CURRENT_STATE.md`；项目协作与后续同步规则写在 `AGENTS.md`，在家打开仓库时也能读到。

## 第一次在家运行

安装 Git 和 Node.js 24，然后在你希望保存项目的目录打开终端：

```sh
git clone https://github.com/Siger1989/map.git
cd map
npm ci
npm run dev
```

打开 `http://localhost:3000/`。网页本身不需要 OpenAI 登录。初次下载 npm 依赖和地图/天气需要联网；473张成都区域地形瓦片已随源码保留，不需要重新生成。`npm ci` 会同步匹配版本的 MapLibre worker，不要手动删除 `public/vendor/maplibre/`。

然后用编辑器或 Codex 打开整个 `map` 文件夹，先读 `CURRENT_STATE.md`；功能文件职责分别见 `README.md`、`docs/track-drawing-and-journey.md` 和 `docs/mobile-controls-and-routes.md`。不要把旧开发机器的 `node_modules/`、缓存或运行日志复制到新电脑。

本轮已完成：手机紧凑界面、真实地形/贴图/等高线、地图图层、道路路线、双指控图、精确定位与平滑手绘、节点吸附/续画/合并、整线高程统计和手绘沿途天气。待继续的重点是真机手感/性能、云层效果、商用数据替换，以及取得地质云1:20万服务授权；它们不能因为代码已上传而视为完成。

## 以后在两台电脑之间切换

开始前检查是否有本地改动，再拉取另一台电脑上传的成果：

```sh
git status
git pull --ff-only
npm ci
```

如果 `git status` 有未提交内容，先提交或妥善暂存；如果提示分叉，先整合，不要用强制覆盖。`npm ci` 在依赖/锁文件变化后需要重新执行。

结束工作前保存文件、更新 `CURRENT_STATE.md`，执行相关检查，再同步：

```sh
git add -A
git diff --cached --stat
git commit -m "Describe the completed change"
git push
```

提交前检查暂存范围，确认没有真实凭证或本机文件。首次在家推送时，用 Git 的凭证管理器或 `gh auth login` 登录自己的 GitHub 账号；不要把 Token 发进聊天或写入项目。

## 下载安装包

从 [Releases](https://github.com/Siger1989/map/releases) 下载当前测试版 APK、SHA-256 校验文件和安装说明。0.1.5-test 为“观云测试版”（com.guanyun.weather.preview），沿用 0.1.4 签名，可覆盖更新 0.1.4 并保留数据；可与原“观云”并存，数据独立。电脑修改不会自动进入手机。APK 中的界面是构建时的快照，源代码继续修改后需要重新打包。

## 在家构建安卓

只运行网页不需要 Android SDK/JDK。需要生成 APK 时，准备 Windows、JDK17、Android SDK platform35 和 build-tools35.0.0，先运行 `npm ci`，然后传入你家电脑的实际路径：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -SdkRoot 'C:\Android\Sdk' -JdkRoot 'C:\Java\jdk-17'
```

上面的路径只是示例；脚本默认的 `D:\GodotAndroid\...` 是当前开发机器路径。构建产物在 `APK/`，临时构建目录在 `mobile/.build/`。

**签名密钥不会进 GitHub。** 测试签名位于各自构建电脑的 `mobile/.build/guanyun-test.jks`。若希望另一台电脑构建的包也能覆盖更新同一版本系列，请通过自己的可信私密方式迁移对应文件。0.1.4-test 的签名为本机新建，只用于独立测试版；0.1.3 及更早的原“观云”仍需原电脑的旧签名。没有对应文件时脚本会生成新签名，新签名不能直接覆盖旧签名安装；不要为此先卸载而丢失本机轨迹。

地图地质服务的 `.env.local` 同样不上传。普通原型运行无需它；1:20万地质云配置与授权步骤见 `docs/geocloud-integration.md`。

## 检查

```sh
npx tsc --noEmit
node --experimental-strip-types --test tests/*.test.mjs
npm run build
```

0.1.3发布时55项检查通过，网页/APK构建完成，并检查APK签名和资源；没有新版手机定位权限/方向传感器/手势/渲染/性能实测。新版操作见 `docs/navigation-weather-location.md`。地图资源来源和非商业许可情况见 `docs/data-sources.md`；公开源码与免费数据不代表所有功能已获得商用授权。
