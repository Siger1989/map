# 当前迭代：磨砂玻璃、三轴旋转与剖面紧凑排版

2026-09-07。用户否定上一版的实色白框，要求参考图的模糊感；追加左下数值旋转/归正和剖面布局压缩。本节覆盖下方旧版配色结论。

- 参考继续使用 `artifacts/screenshots/reference-thetrail.png`（1280×720的三个手机展示板），并参考用户本轮两张剖面截图。项目是现有真实地图，参考仅映射材质/控件层次，不复制展示板比例或手机外壳。
- 新实现截图 `artifacts/screenshots/glass-section-final.png`，598×628 CSS/像素，已与原参考在同一工具输出中对照。真实地图颜色在面板后形成低频模糊色块，文字保持清晰；对象数字栏、横排尺寸、同排两折叠入口和三操作均可见。
- 修复 [P1] 缺少参考玻璃材质：50% 暖灰表面 + 14px backdrop-filter（小控件16px），浅内层、圆形右侧工具、较轻边线；保留原绿色相机。无支持/减少透明度回退为实色。初轮60%/22px仍偏实，已降低覆盖和模糊半径，最终截图已查看。
- 修复 [P2] 路线字段仍被高优先级旧规则填成实色：收紧选择器，使地点输入透明，出行方式成为一个分段控件。禁用规划按钮使用中性灰状态。
- 修复 [P2] 剖面大块折叠入口占两行：改为同排、展开后占整行；单位/刻度/宽高标签与框横排，三个底部操作同排。内部细滚动条，字段保留44px高度。
- 字体：中文系统字体，常用12–13px；数值12px、等宽数字，单位12px以内。不宣称与源图字体精确一致。未新增素材，图表保留深色小区域以保持曲线/测点对比度。
- 旋转交互 PASS：X=45.5提交后单次撤销恢复107.5；归正后90/0/0并撤销；500无效恢复且没有新增历史。三轴读数在拖动过程中由预览姿态驱动，真实触摸拖动待手机验收。
- 响应式 DOM PASS：390面板304×320，360对象栏228×147、相机左侧242px、对象栏右边236px，无交叠；旋转输入44px高、约54px宽；两个折叠入口同一Y位置，各约129px宽。document.scrollWidth分别等于390/360。
- 验证 PASS：TypeScript、219/219测试、网页与安卓网页构建。正常视口浏览器最近错误日志为空。
- 截图限制：`glass-mobile-390.png`（390×844）仍出现工具捕获内容半尺寸，含全页截图方式，已拒绝作为手机视觉验收证据。临时页已关闭、视口重置；没有通过图片拉伸伪造手机截图。
- 测试后撤销恢复原剖面姿态。未生成APK；真实手机的模糊合成开销、静止闪烁和精确触控仍待验证。

当前视觉门禁仍为 blocked：可靠手机尺寸截图缺失；正常视口的材质与布局修正已确认。

# 上一轮记录：A / TheTrail 紧凑 UI 验证

Date: 2026-09-07

## Source visual truth

- Source: https://dribbble.com/shots/26674669-TheTrail-Travel-App-Hiking-Mobile-Dashboard
- Viewed image: https://cdn.dribbble.com/userupload/45391052/file/b05f6bab0b26c8595b0bd0a328940c16.jpg
- Local capture: `artifacts/screenshots/reference-thetrail.png`, 1280×720 pixels, browser viewport 1280×720 CSS pixels; the source is a three-phone presentation board. Its device-frame sizes are not production viewport requirements.
- User-selected adaptation: compact Chinese map workspace, small text, maximum map area, existing green camera. Intentional differences: no oversized discovery cards, photo map substitute, fake device chrome, TheTrail logo, or blue recoloring of real terrain.

## Implementation evidence

- `artifacts/screenshots/ui-a-preview.png`: 598×628 pixels / CSS viewport, real mountain map, route panel and original camera.
- `artifacts/screenshots/ui-a-layers-final.png`: 1280×720 pixels / CSS viewport, compact layer rows, blue expanded layer control.
- `artifacts/screenshots/ui-a-annotations.png`: 1280×720, corrected annotation controls.
- `artifacts/screenshots/ui-a-photos.png`: 1280×720, photo import empty state.
- Full-view comparison: source board and final layer screenshot emitted and inspected together. Both show light floating surfaces, compact dark text and blue accents over terrain. The implementation deliberately reduces panels to task controls rather than copying source marketing proportions.
- Focused comparison: inspected panel headings, field rows, layer switches, selected navigation and original camera in full-resolution captures; no raster asset replacement was introduced.
- Density: normal captures are compared at CSS size. `ui-a-route-390.png` is rejected as visual acceptance evidence: the image is 390×844 but content is compressed into roughly 191×414 while DOM viewport is 390×844. No upscaling or cropping was used to pretend it passed. Temporary overrides were reset and original tab confirmed 598×628.

## Fidelity surfaces

- Typography: system Segoe UI / Microsoft YaHei fallback retained for Chinese. Typical labels and titles 12–13px, numeric summary 14–18px, weather temperature 28px. No attempt to claim matching the reference's unverified font family. Wrapping and truncation reviewed; route inputs measured 13px.
- Layout: single compact heading, route modes directly below it, one scrolling content region; 16px panel radii and 18px chrome radii. Layer rows measured approximately 45px including separator; switching targets remain 44px. 390 layer panel 304×320; 360 route panel roughly 286×343 with a via point.
- Colors: blue #2452e8, foreground #1c2940, muted #59677d, light panel rgba(248,250,255,.97). Blue is inferred from the source direction, not claimed as an exact pixel sample. Opaque-enough surfaces keep labels readable on terrain. User object colors and green camera retained.
- Assets: real map and existing Lucide controls remain. No new raster assets, CSS imitation artwork or replacement logos. No screenshot assets shipped in the app.
- Copy: existing Chinese actions retained; long layer descriptions move to an expandable section. Satellite capture date remains next to an enabled satellite row; source information remains accessible.

## Interaction and responsive checks

- PASS: route ⇄ track header navigation, add via point, existing input and sorting handles remain; Escape closes panel.
- PASS: terrain slider disappears when terrain off; weather opacity appears with clouds and disappears after disabling; settings restored. Source explanation expands, compact source entry opens source management.
- PASS: collections empty state, annotation browse, trip photo empty state and tool navigation render.
- PASS: 390×844 and 360×780 document scrollWidth equals viewport width; right tools and camera remain outside route panel. 360 annotation buttons measured 44px high. Last width refinement gives the annotation panel the same compact width formula as other panels.
- PASS: inspected browser error log returned no errors (last 5 requested); no claim about network availability or all-time console history.
- PASS: TypeScript, 217 existing tests, web and Android web-resource builds. Existing bundling warnings remain.
- BLOCKED: reliable full-size screenshots at the required phone sizes and real-device touch acceptance. Normal screenshots cannot substitute for those.

## Findings and iteration history

1. [P1, resolved] Annotation buttons inherited dark text over old dark backgrounds. Added scoped light button/card styling. Post-fix `ui-a-annotations.png` shows dark text on light controls; measured rgb(28,41,64) over rgb(234,240,249).
2. [P2, resolved] Expanded layer entry kept its old dark-green background with blue text. Added explicit expanded/pressed state rules. Post-fix `ui-a-layers-final.png` shows white icon/label on blue.
3. [P2, verification gap] Phone-size screenshot compositor reports the correct viewport but captures scaled content. Fresh tab and documented viewport/reset APIs did not fix capture. Stopped retrying the same diagnostic; normal viewport restored. This is a testing blocker, not a confirmed app overflow.

## Implementation checklist / remaining work

- Implement selected compact visual direction: done.
- Preserve camera and existing business logic: done; no rendering or storage changes.
- Fix observed contrast issues: done.
- Build and commit source with current limitations: done in this delivery flow.
- Recheck 390×844 and 360×780 on a functioning capture surface or phone: pending.
- Static APK flicker diagnosis and new APK release: separate follow-up, not claimed complete here.

final result: blocked
