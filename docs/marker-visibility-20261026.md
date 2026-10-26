# 2026-10-26 标记缩小可见性与名称提前（快速预览）

用户要求：地图缩小时保留标记点，并让名称更早出现。

## 根因与修改范围

- `modules/map/nearbyMarkerRange.ts` 原先将加载半径封顶30km；缩小后，画面内30km以外的标记仍会被移除。现在随视口地面范围扩大，保留150m下限和进入/退出0.9滞回，画面范围外仍可剔除。
- `modules/map/NearbyMarker.ts` 手势保留范围改为30km与当前视口半径中的较大值，避免缩放/坐标刷新再次受到旧上限限制。
- `modules/annotations/markerScale.ts` 名称从相机原始zoom11提前至9，zoom8–9显示图案，更小时保留9px圆点；选中标记仍始终显示名称。界面图源级数随采样档变化，本轮默认高清约11级显示名称，标准约10级。
- 定向回归在 `tests/nearby-marker.test.mjs`、`tests/measurement-marker-delete.test.mjs`。复核既有 `tests/marker-terrain-occlusion.test.mjs`。

仅改三个运行时文件和两个测试文件。名称字体/颜色/44px目标、3D山体遮挡、原有模型、路线、定位、存储格式和用户真实存档未修改。没有更换私人天地图配置或清空本机数据。

## 主审验收

本机分支 `codex/place-address-search-20261011`，开工跟踪文件干净；已有未跟踪文件保留。远端当前分支fetch后ahead/behind为0/0。本轮为快速预览，不升版、不打包、不提交或推送。

| 项目 | 结果 | 证据与边界 |
| --- | --- | --- |
| 类型检查 | PASS | `npx tsc --noEmit` exit0 |
| 缩放、范围、地形遮挡定向逻辑 | PASS | 三个测试文件24/24，日志 `.openai/marker-zoom-20261026-tests.log` |
| 当前源码私人预览重建 | PASS | `.openai/quality-build.mjs`，JS/CSS完成；9174私人预览、3108独立API；Key和私有种子仅核验存在性 |
| 390×857、360×780主图缩放 | PASS（隔离浏览器） | 原始zoom9→8→7→5→3→9；中心点始终可见，47km外点在zoom8及以下保持，缩放结束后保留；zoom9近处名称可见。无横向溢出 |
| 实际computed | PASS（隔离浏览器） | 圆点9×9px、标记目标44×44px；zoom8图案22×22px；地理锚点保持。详细矩阵 `.openai/marker-zoom-20261026-results.json` |
| 点击与返回 | PASS（两尺寸） | 点击选中、再次点击打开真实标记编辑器；返回地图后zoom仍9；无pageerror；全部使用隔离测试点 |
| 双图缩放与返回 | PASS（两尺寸） | 原始zoom7两图圆点/47km点保留，zoom9两图名称显示；退出双图成功。主审亲看360窄屏两态截图 |
| 手机安装包/真机 | 未验证 | 现有Android私人139与Mac私人140未包含此次修改；Android实际触控、密集标记性能和设备定位仍待用户复测 |

截图位于 `artifacts/screenshots/marker-zoom-20261026/`：`390-z8.png`、`390-z9.png`、`360-z7.png`、`360-z9.png`、`360-dual-z7.png`、`360-dual-z9.png`及两尺寸编辑/返回图。主图在无地形模式测试，双图使用现有图源/地形；部分底图瓦片仍在加载，标记结论来自DOM/computed与真实截图，不宣称全部图源网络加载或设备体验通过。

隔离Playwright脚本及完整矩阵留在本机 `.openai/marker-zoom-20261026.mjs`、`.openai/marker-zoom-20261026-results.json`，未向用户存档注入测试点。右侧入口继续为 `http://127.0.0.1:9174/phone-preview.html`，390×约857手机框、禁止网页全屏。

再次测试条件：任意30km以上跨度的已保存地点，缩小直至两个点都进入画面，继续缩小/放大并结束手势；点保留、名称按新阈值切换。高密度地点可重叠，山体遮挡继续按已有规则隐藏。本轮没有新增聚合或改动地形遮挡规则。
