# 自动高清与晴空渐变：2026-10-23 快速预览

## 目标与范围

接续“查找最新版本并优化图层清晰度”中断的工作：在相同屏幕缩放下提供标准/高清两档，高清提前一级影像；天空由白色地平线渐变到蓝色顶部。用户当前阶段为试用流畅度，不是打包交付。

工作目录 `D:/天气系统`，分支 `codex/place-address-search-20261011`，基线 `40dc00a`。保留此前未提交的重规划原起点/锁定速度条修复和其它本机文件；未合并远端、提交、推送或升级包版本。现有手机包129、电脑包128均不含本次改动。

## 实现与根因

- `modules/cartography/RasterQuality.ts`：当前栅格图源在自动高清时按原 tileSize 的一半选层，关闭/固定级别/换源时恢复；不调整相机、不提升原图源最高级别、不处理DEM。
- `RasterLevelControl.tsx`、`app/page.tsx`：现有级别菜单增加“自动 · 标准 / 自动 · 高清”，保留固定级别；提示提前一级的流量和内存代价。`types.ts`、`layerPreferences.ts`保留/读取画质偏好，默认标准。
- `TerrainMap.tsx`与`sky.ts`：接入画质控制与地图原生晴空渐变，主图/对比图沿用同一渲染组件。
- `rasterLevel.css`、`outdoorSurfaces.css`：菜单上限200px，标题紧凑，select实测16px。根因为通用紧凑样式及标题样式覆盖；调整后的卡片252×196px，未裁正文。高清选项缩短，避免16px文字在窄选择框内裁切，解释保留在下方。
- `homeMap.css`：此局部面板此前未接入隐藏UI显隐门禁；面板打开只隐藏未锁定入口，锁定状态不命中该规则。

轨迹、照片、导航业务、存档格式、包名签名和已有私有配置没有因本次改动而修改。`app/page.tsx`等文件还包含上一轮导航修复，不能把整个工作区diff都归为本轮。

## 主审验收

| 项目 | 实际证据与结果 |
| --- | --- |
| 同样大小提前一级 | 屏幕zoom12、pitch0时标准tileSize256加载z13；高清tileSize128加载z14。切换不移动地图。回切标准时可能暂时保留淡出的旧z14，z13已加载。PASS |
| 固定级别与恢复 | 选择固定14级恢复tileSize256/maxzoom14；恢复自动高清后tileSize128/maxzoom18。注记tileSize256不变。PASS |
| 390×857、360×780、390×480 | 卡片均252×196px；clientHeight=scrollHeight=194，border-box，padding6px 10px，圆角8px，上限200px，无横溢；select16px。PASS |
| 面板入口与关闭 | 打开时未锁定入口display:none；关闭恢复，之后实际锁定→“解除界面隐藏锁定”→恢复。PASS |
| 天空 | 主审查看真实截图：白色地平线、蓝色顶部、渐变可见。不是实时天气天空；用户审美确认待反馈。PASS（浏览器） |
| 内置天地图与双图 | 主图内置分类天地图影像可选，39个私有图源种子仍可见；双图下方从“内置”选择天地图影像，上下影像/天空实际显示并可退出。PASS（限定浏览器） |
| 定向检查 | `raster-quality`、`raster-level`、`map-layer-preferences`、`map-comparison`、`sentinel-provider`共57/57；tsc、diff检查、当前源码预览JS/CSS生成PASS。未跑无关全量测试或安装包构建 |
| 原生/性能边界 | 未测Android真实触控、GPU帧率/内存、真实GPS、锁屏后台、APK安装；不保证手机高清流畅。浏览器IP定位接口404已见，未用测试坐标冒充GPS，试验坐标仅控制地图相机。 |

截图：`artifacts/screenshots/quality-sky-20261023-panel-390x857.png`、`-panel-360x780.png`、`-panel-390x480.png`、`-locked.png`、`-final.png`、`-dual.png`。主审实际查看窄屏菜单、主图天空和双图截图。运行结果保存在本机`.openai/quality-resume-check.log`及`.openai/quality-dual-check.log`，不提交日志。

## 预览与下一步

预览地址 `http://127.0.0.1:9174/phone-preview.html`，默认390×约857手机框且禁止网页全屏；API独立3108。常规Vite依赖/样式预处理启动曾卡住，本轮沿用上一轮本机`.openai/quality-build.mjs`、`.openai/quality-vite.config.mjs`替代预览：从当前mobile/bootstrap与本机Key生成资源，预编译与移动端相同的CSS兼容处理并直接提供资源。没有更改项目正常启动命令和全局配置。此替代预览后续源码变更需重新运行构建脚本，不能把旧bundle当新源码。

上轮最终验收还因MapLibre内部字段迁移中断：`tileManagers.detail._tiles`已改为`_inViewTiles._tiles`；修正的只是本机验收脚本，生产代码不依赖此字段。

下一步由用户在同一位置切换标准/高清并拖动比较；若满意再按明确交付要求重新构建安装包。未出包、未公开上传私有配置，不把预览成功等同于APK一致性或真机验收。
