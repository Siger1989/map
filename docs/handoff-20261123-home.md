# 山兔 2026-11-23 跨电脑交接

今晚从 `Siger1989/map` 的 `codex/old-engine-tilt-dual-20261105` 分支接续。先读 `CURRENT_STATE.md` 和 `docs/agent-handoff.md`。`main` 和公司电脑旧的 `codex/tianditu-loading-20261027` 工作树都不是当前版本。

```powershell
git clone --branch codex/old-engine-tilt-dual-20261105 https://github.com/Siger1989/map.git shantu
cd shantu
npm ci
```

已有该分支时，先检查 `git status -sb`。没有未提交改动时用 `git pull --ff-only`。源文件和交接文档在公开源码仓库，签名 APK、界面画板和本机旧分支快照放在已授权的私人交付仓库。家里的私人预览沿用那台电脑已配置的注册天地图和私人图源，本机凭据和用户记录不随源码同步。

## 已完成和待确认

- 0.2.217 Android 测试包，构建号 224，源码 `858c311`，原签名。第三人称行程继承主图的必应等在线图源，顶部可切换并保留进度。影像缺失时显示真实高程，模拟内天气已暂停。网页用真实必应跑完青城山 8.25 公里，签名包解包复测通过，手机真机待验证。[0.2.217 安装说明](release-0.2.217.md)
- 主图「工具」菜单 11 项同屏。正常屏三列，360×360 极矮窄屏两列避让定位栏。七种浏览器尺寸和菜单返回通过。此修复在最新源码和网页预览，晚于 0.2.217 APK，尚未进入安装包。[尺寸验收记录](ui-quality-gate.md#2026-11-23--主图工具菜单一屏显示)
- UI 画板包含 21 个现有预览截取的界面，按实际入口连线。点选只点亮该节点所在通路，支持双击查看大图。已查清规划结果可直接启动导航，收藏的「使用此路线」回到路线摘要。用画板先看现有分组和优先级，等待用户确认后再改应用界面。
- 开放数据还在方案阶段。建议先试做「路线详情 → 路面与坡度」，结合 OSM 路面/步道属性和现有高程，再评估 Overture 沿途设施、JRC 历史水面及 ESA WorldCover 地表。吉林一号研究随私人快照保存，环境模板为空，当前 6 项定向测试中 1 项未通过，待核对图源导入的 WGS84 元数据。

## 下载与查看

- [私人交付页](https://github.com/Siger1989/shantu-private-delivery/releases/tag/v0.2.217-private) 需要用已有访问权限的 GitHub 账号。下载 `Shantu-UI-Board-20261123.zip` 后解压，双击 `index.html` 即可看画板。另有画板源稿、截图和验收记录。
- APK 按分卷下载和合并，合并后的文件仍是同一个已签名 APK。[下载脚本](../scripts/download-shantu-217.ps1) 会用 GitHub CLI 下载、逐卷校验，再核对整个 APK 的 SHA-256。
- `Shantu-Research-Snapshots-20261123.zip` 保存旧工作树补丁、对应基线和吉林一号研究。按压缩包内的说明在独立工作区查看。

```powershell
gh auth status
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/download-shantu-217.ps1 -Destination .\delivery
```

APK SHA-256 `8cca61c208c514532df295c40aaeba32108b2a8676bbb2983b9c5c79b942c187`。覆盖安装前保存正在记录的轨迹和草稿。需要网页预览时，按本机已有私人配置启动 API，再运行 `npm run dev:apk-preview`，打开 `http://127.0.0.1:9174/phone-preview.html`。

## 给 Dot

这份交接供用户晚上在家里电脑接续。先确认当前分支和本机工作区，再按上面的入口下载。优先和用户一起看 UI 画板及真实跳转，等用户确认界面优先级后再继续改动或出包。
