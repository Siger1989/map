# 地名清晰度与可选文字层（2026-10-13）

## 结论与范围

当前天地图 CIA/CVA/CTA 注记在工程中均为 256px 栅格瓦片，地名已经画进图片。缩放时会插值或放大已有像素，三维地形还会拉伸该图片；提高字体 CSS 或强制最近邻采样不能恢复源图缺失的文字细节。CIA 的源上限为 18，地图允许到 20，超出源上限时无法得到新字形细节。

本轮保留天地图底图、私有 Key 和原注记选项，新增“地名注记 → 清晰文字”。它复用现有 OpenFreeMap/OpenMapTiles 的 OpenStreetMap 地名数据，以 MapLibre symbol/SDF 文字独立绘制；点状地名面向屏幕，道路名沿道路方向但不随地形平面压扁。用户随后明确“优先文字清晰，保留切回原注记的选项”，现以 `vector` 为新设置和缺失字段的默认，显式保存的旧偏好保持，切回原注记仍可保存。山区地名覆盖与天地图不同，不能当成相同地名覆盖的无损替换。

活动分支 `codex/place-address-search-20261011`，基线 `57635e63a647c0065fb8318ee702d89c37237932`，工作树 `.openai/worktrees/place-address-search-48c80e0`。9174 私有预览更新；固定 APK 仍为 0.2.123-test/code130，不含本轮代码。用户随后恢复PC同步，已构建并验证私有桌面124/code131；交付和源码同步见[PC记录](desktop-sync-20261013.md)。

## 修改

- `modules/cartography/tianditu.ts`、`modules/map/types.ts`：新增 `tiandituLabels: 'vector'`。清晰模式保留原 img/vec/ter 与境界，停止显示 CIA/CVA/CTA，避免两套地名叠字；标签总开关继续生效。
- `modules/cartography/cartography.ts`：国内底图在清晰模式保留矢量文字。文字俯仰对齐设为 viewport，点状文字旋转也对齐 viewport。
- `modules/map/TerrainMap.tsx`：即使 roads=false，也为清晰地名添加矢量源；使用 OpenFreeMap 字形端点处理所需字符，中文沿用 MapLibre 默认的本机 sans-serif TinySDF。没有降低地图像素密度或设置 DPR 上限。
- `modules/map/layerPreferences.ts`、`TiandituSources.tsx`：新增模式可保存、恢复和随底图切换保留。原“匹配底图”文案明确为“原图注记（自动）”；清晰模式提示“地名：OpenStreetMap · 覆盖可能不同”。图源署名仍在现有说明中。
- `modules/controls/homeMap.css`：矮屏实际点击发现图源关闭键被 z-index 13 的相机控件遮住，面板宿主原为 10。把图源面板加入现有路线宿主的 z-index 14 规则，关闭后恢复普通宿主层级。没有猜测偏移或缩小地图。
- 两个图源/偏好测试文件及 `tests/raster-level.test.mjs` 覆盖新模式的范围、旧值兼容、独立道路开关、关闭及切回。

## 主审实测

| 项目 | 结果 | 证据 |
| --- | --- | --- |
| 真实数据与图源 | PASS | 天地图影像继续 visible/loaded；vector 时 CIA/CVA/CTA 全隐藏，现有矢量地名层可见；切回 auto 恢复原注记，none 两套都关闭 |
| 缩放 | PASS（样本） | 青城山真实要素在 z12、14.35、16.7、19.2 均绘出中文名；截图主审已查看。大缩放影像本身仍受源分辨率限制 |
| 倾斜 | PASS（样本） | z14.35 下 pitch0、60、80；青城山文字独立于山体影像，近处可读，无栅格拉伸 |
| 像素密度 | PASS（浏览器模拟） | DPR1 与 3.2；3.2 时 390×750 CSS 对应 1248×2400 backing，中文名仍显示；不等同 Android 真机 |
| 模式切换/视角 | PASS | none → auto → vector，中心、zoom14.35、pitch80、bearing 全部不变，没有双注记 |
| 菜单与点击 | PASS | 390×857、360×780、390×480，16px 选择控件、4px 控件圆角、无横向溢出；选择/关闭/重开/切回通过。矮屏内容内部滚动，关闭键实点通过 |
| 中文覆盖 | 有差异 | 成都、青城山、四姑娘山均有实际中文名；用户区域 pitch40/z14.14 缺少近处点状地名，缩至 z12.5 有曲山镇、擂鼓镇和若干村名。pitch80 可见更远的北川县/永安镇与道路名，不代表近处覆盖一致 |
| 主/双图 | 主图实测，双图只读/逻辑复核 | 同一个 TerrainMap 与独立 pane settings 传递新字段；未重新跑双图完整视觉全过程 |
| 自动检查 | PASS | 25 项图源/偏好/栅格相关测试；前两项修改的59项定向仍通过；tsc、Android 网页资源构建、diff whitespace检查通过 |
| 真机 | 未验证 | Android IME、DPR/GPU文字、触控、FPS与系统能力均待真机；本轮不声称任意图源/任何角度/所有地区都绝对清晰 |

初次快速预览仅查看新入口；用户确认默认清晰文字后，右侧9174实际已显示“清晰文字（默认）”，主审查看后关闭菜单，图源与相机保持。隔离 QA 使用真实公开地图要素，未写入用户标记、照片、路线或定位存档。PC主图/双图的补充实测和手机三尺寸回归见PC记录。

## 本机证据与再测条件

- `.openai/label-clarity-20261013/browser-labels-result.json`：11 个源/模式/缩放/俯仰观测，无 page/map 错误。
- `browser-ui-result.json`：三尺寸实际菜单、返回与保持视角；`browser-dpr-result.json`：模拟 3.2 DPR。
- 截图：`artifacts/screenshots/labels-user-area-auto-20261013.png`、`labels-user-area-vector-20261013.png`、`labels-clear-z19.2-p0-20261013.png`、`labels-clear-z14.35-p80-20261013.png`、`labels-clear-dpr3.2-20261013.png`、`labels-menu-{390x857,360x780,390x480}-20261013.png`。
- 修改图源、glyph、标签显示规则、缩放上限或手机 WebView 后，重跑有名称要素的整数/非整数缩放、0/60/80°俯仰、道路关闭和切回原图；核查源加载/字符缺失/双字与地区覆盖。

技术依据：[MapLibre 图层规范](https://maplibre.org/maplibre-style-spec/layers/)、[本机中文字形示例](https://maplibre.org/maplibre-gl-js/docs/examples/use-locally-generated-ideographs/)。本机 6.7.0 源码核对了默认 DPR 与 localIdeographFontFamily。天地图官方 Cesium GeoWTFS 扩展不是本工程可直接使用的 MapLibre 数据源，本轮没有引入另一套地图渲染器或依赖未公开解码格式。

同轮其它两项修改与限制见 [远处图标及键盘记录](nearby-icons-keyboard-20261013.md)。
