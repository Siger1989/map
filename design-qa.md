# 0.2.24 地图下方编辑与横版图纸 QA

final result: passed (browser; physical-device acceptance pending)

## 视觉目标与比较

用户已否定旧点旁浮窗。本轮以底部独立编辑区预览 `exec-b3a72113-5bce-44a2-b175-c23911a164ac.png` 为界面目标；用户后续明确“仍用之前横版”，优先于生成预览的竖版纸张，工程图本体维持原1800×1480主图。新增方向角来自用户追加要求。

`artifacts/screenshots/ui-0224/comparison-dock-and-sheet.png` 将预览去掉手机装饰后与实际390/360截图按360px等宽、保留比例并列；已打开同一张比较图检查。此图仅比较控件结构/样式，地图地理内容和点位不是同一组数据，不能据此判断地形准确度。方向角工程图另见 `engineering-bearing.jpg`。

- 字体：沿用应用无衬线中文栈，标题13/15px、输入13px、辅助11px，主要按钮12px；满足用户紧凑要求。
- 间距：地图下方编辑带164px，点位本身112px；地图与编辑区边界相接，无浮窗遮住地图。36px内部按钮、44px主要动作。新建提示带88px，修正3px多余滚动。地图准星同步到缩短后的地图中心。
- 颜色与资产：原Logo、Lucide图标、真实地图继续使用；浅白/深绿与其他界面统一，黄色选线，红色删点；无新绘制替代Logo。
- 结构：预览中的资料/删除/坐标/模式/底部动作均保留；实际进一步压缩坐标为“经/纬”，移动时显示指引，地图可用高度更大。图纸仅更换外围工具，工程图保持用户要求的横版。
- 文案：方向角A→B标注“真北起顺时针”，数据来自当前勘探线；资料、坐标与删除均为真实操作。井深/岩层仍暂停。

## 实际检查

- 最后交叉检查复现“点位资料未关就进图纸信息”串窗，已隔离显示上下文；项目字段计数1、点位字段计数0，返回地图保留未保存点位草稿。
- 用户再次反馈手机不能拖动。浏览器结果不视为手机验收；补SVG根元素touch-action和取消事件提示，复查根元素none/空白穿透none，浏览器B再次drag坐标更新且console error为空。手指拖动、真实pointercancel仍待设备检查。

- `dock-b-390.png`：地图高622、编辑带y622–786，点位部分112px，页面宽390无横溢；准星中心y311匹配地图中心。
- `dock-move-360.png`：沿线移动有即时提示和取消入口；`dock-keyboard-360.png`：360×480时坐标/应用和错误可见，额外内容内部滚动。
- 实际B沿线drag：坐标从103.497965/30.856889更新到103.496496/30.854038。实际B方向drag后C里程1021.6m保持。C点击线外位置投影回线；D新增后确认删除，D句柄计数归零。
- `sheet-landscape-360.png` / `sheet-appendix-360.png`：横版主图、资料附表、信息和设置、缩放复位可用。方向角35.48°、20m等高距、项目信息写入实际JPEG。主图348303字节、附表145398字节，页码名称正确。
- 独立验证页localhost:9311为全新测试存储，未改用户手机数据。页面console error为空。405全量逻辑和类型通过。

已修复本轮可复现遮挡/无移动反馈；未发现剩余P0/P1/P2页面问题。旧浮窗的QA与截图不作为本版验收。浏览器pointer拖动和缩短视口不等于Android真机触控/输入法、系统保存/分享验收；ADB未连接。

---

# Marker windows 0.2.15 visual QA

final result: passed

Scope: the confirmed summary v2 and editor v3 implemented in the existing map application. This is browser acceptance; Android physical-device touch, keyboard, GPS and performance remain untested.

## Evidence and normalization

Source: docs/visuals/marker-level-one-preview-v2.png and marker-{basic-compact,position-matrix,data-dense}-v3.png. Images are 853x1844; the mock's phone content is cropped at (30,119)-(822,1832) and normalized to 390x844 CSS pixels. Actual screenshots are 390x844; narrow screens are 360x780, and keyboard simulation is 360x430. All screenshots are inspected at 1x density. The generated mock includes illustrative map imagery, tools, weather and sample values; those are not live-data visual requirements.

Full-view plus focused comparison boards were opened and inspected together:
- artifacts/screenshots/marker-compare-0215-summary.png
- artifacts/screenshots/marker-compare-0215-basic.png
- artifacts/screenshots/marker-compare-0215-position.png
- artifacts/screenshots/marker-compare-0215-data.png

Actual captures: artifacts/screenshots/marker-{summary,basic,position,data}-0215-{390,360}.png. Position screenshots use a model for actual XYZ support; summary/basic/data use the saved QA sample pin at 390 and model at 360. Model-only size options at 360 are an intentional object-type difference. Focused regions on the boards inspect the app-owned card, labels, buttons and axis colors, in addition to the full map layout. Source drill icon and runtime sample icon are distinct selections of the existing icon system; no replacement icon system was invented.

## Findings and fixes

- P1, fixed: identical sibling React keys on AnnotationWorkspace and ObjectGizmo caused accumulating duplicate panels during map camera updates. Reproduced in both development and production. Unique namespaced keys fixed it; production DOM confirmed one workspace and one gizmo. Later actual keyboard-controlled gizmo movement and camera zoom kept one workspace.
- P2, fixed: draft position headers repeated for each row. The final layout shares X/Y/Z headings above metre/degree rows, with six independent resets on models.
- P2, fixed: initial data panel exceeded the project's 38dvh/320px editor limit. It now scrolls internally, retaining the top bar. Measured 390 card height320; 360 position width286/height177; no horizontal viewport overflow.
- P2, fixed: reducing the viewport could leave the focused note below the scroll viewport. Resize handling now scrolls the active input into view. Post-fix screenshot artifacts/screenshots/marker-keyboard-0215-360.png shows the note and Save together; card y56..219.39, note y168..212 at 360x430. Save succeeded afterward.

No actionable P0/P1/P2 findings remain within this scope.

## Required fidelity surfaces

- Fonts/typography: retain the application's sans-serif Chinese fallback, compact 13px fields and 16px summary heading. Source mock text is readable at normalized size; runtime text remains readable with truncation for long titles. Numeric units and labels remain distinct.
- Spacing/layout: compact one-row editor header, inline name, adjacent icon/color selectors, paired axis rows, dense properties. Root at top56/left8, clear of right tools and bottom navigation. Runtime 44px action heights intentionally exceed smaller raster mock hit areas. This preserves touch targets; five properties plus notes may require internal scrolling under the height cap.
- Colors/tokens: warm white panel, dark teal primary action, muted borders, red/green/blue axes aligned with the existing gizmo. Focus outlines remain visible.
- Image quality/assets: app and Android use the supplied 1254x1254 rabbit/mountain-road PNG without changing shape. Existing map/marker/gizmo assets are reused; actual imagery/weather replaces illustrative mock content. APK native-logo pixel identity separately checked.
- Copy/content: summary/Basic/Position/Data/Save structure matches the confirmed flow. Runtime shows true coordinates or cached location and actual/missing elevation; no mock temperature or geological field values enter product defaults. Fixtures remain only in isolated local test storage.

## Interaction checks

Storage failure preserves draft and original stored record; restoring storage and retrying succeeds. Unsaved selection change offers save/discard/continue; discard restores prior data. X reset leaves Y20 unchanged. Actual gizmo keyboard movement changed X to2m; Z ring keyboard movement changed rotation to6.01 degrees; reset restored the respective field. Delete cancellation, complete details, navigation and Return to marker were checked. Production after the key fix has one card/gizmo. App console checked with no errors at final interaction checkpoint.

341 logic tests and final types pass. Temporary QA entry files were removed before final builds. Final extra regression keeps a draft visible when an external window deletes its source; it uses the same window layout.

## Follow-up polish and limits

P3: raster-reference spacing is slightly denser; retain current touch dimensions and scroll cap. Native soft-keyboard timing, real pinch/touch gestures, installation, GPS and performance still need device testing. Browser viewport emulation is not native keyboard/device acceptance.
# 导航选点、地点箭头与搜索框 · 0.2.16（2026-09-09）

- 390×844、360×780：导航选点状态面板持续可见；选点提示、取消、当前起终点或途经点可达；地图拖动不关闭。标记点击填入名称，空白地图保留自由选点，取消/Escape保留地址；关闭后标记摘要/编辑正常。
- 长路线10行地址切换首尾：360视口面板y56..352.4，提示y106..157；起点y157..202、终点滚动后y298..343，可达且无横向溢出。普通地点箭头尖端对应地图锚点，名称容器与箭头分离，未改模型顶部投影。
- 两尺寸顶部真实成都搜索结果实色rgb(247,248,243)、backdrop-filter=none；明确分隔线、两行名称/地址，不透底图。路线搜索结果同步用不透明底。
- 关键截图：artifacts/screenshots/navigation-pick-390-0216.png、navigation-pick-360-0216.png、navigation-search-390-0216.png、navigation-search-360-0216.png。已目视核对；未进行Android真机触控验收。
