# 山兔进度与回家电脑接续（2026-09-24）

## 当前成果

开发分支为 `codex/rollback-ui-0235-20260921`，仓库为 https://github.com/Siger1989/map 。本次同步是在0.2.71源码基准 `9fcb885397e5fb20e519960c499e07b2498952dc` 之后保存开发进度；没有合入main。不要从旧UI工作树继续PDF还原。

| 范围 | 已完成内容 | 当前边界 |
| --- | --- | --- |
| 地图 | 普通/编辑框选双指操作、地点/模型名称层级、2D/3D及历史相机恢复 | 已纳入0.2.71；真机触控待验 |
| 路线与导航 | 原线反向、断口定位、缺分叉终点定位候选、固定自由画线工具 | 已纳入0.2.71；真实路线/真机导航待验 |
| 收藏与标记 | 统一导入/JSON和XLSX分享、文件夹显隐、标记自动保存及完整文本分享 | 已纳入0.2.71；真机输入法/横滑待验 |
| 记录与照片 | 默认5米并保留旧设置、运动朝向跟随、记录内拍摄/导入、时间位置来源标注及失败保留草稿 | 已纳入0.2.71；GPS筛点、相机往返、后台待验 |
| 图层/图源记忆 | 设置保存与恢复、有效图源恢复、无效ID回退、启动保留细节上限 | 本次同步的后续开发源码；0.2.71 APK不含 |
| UI视觉方向 | 深色户外视觉规范及框选交互草图 | 提案，未实施/未定稿 |

0.2.71构建记录列有647项测试、TypeScript、网页/APK构建、签名/zipalign、473张地形瓦片及390×857/360×780浏览器QA通过。本次重新核对APK本地哈希、sidecar与GitHub资产digest一致，两个远程tag解析到同一源码基准，并将0.2.71草稿公开为测试Release。0.2.70草稿未改。

- [0.2.71发行说明](release-0.2.71.md)
- [GitHub测试Release](https://github.com/Siger1989/map/releases/tag/v0.2.71-test-standalone)
- [下载APK](https://github.com/Siger1989/map/releases/download/v0.2.71-test-standalone/Shantu-0.2.71-test-standalone.apk)
- APK：57,842,780字节，SHA-256 `E298995A4394500E168EA2D6794C402FC674D5D5EA70B577E29965C111B318D6`。

## 本次保存的文件

- 已有源码修改：`app/page.tsx`、`modules/mapSources/useMapSources.ts`。
- 新增源码/测试：`modules/map/layerPreferences.ts`、`modules/mapSources/selection.ts`、`tests/map-layer-preferences.test.mjs`。新设置使用`shantu.map.layer-preferences.v1`；旧坐标基准设置与`shantu.map.last-view.v1`继续保留。
- 已有验证脚本：`scripts/verify-box-selection-interaction.mjs`、`scripts/verify-favorites-import-ui.mjs`。
- 设计草案：`docs/ui-visual-system.md`、`artifacts/previews/box-selection-interaction-proposal.svg`及PNG。草图不能作为最终页面截图或视觉验收。
- 更新状态/接续文档、README与附件忽略规则；无文件删除。本轮没有修改路线几何、照片库、用户布局、Android包名或签名，也没有实施视觉改版。

本次类型检查、5项图层偏好测试、两份脚本语法检查及网页生产构建通过。图层记忆的完整浏览器交互与真机重启恢复尚未验收，后续先验证再发布新包。本次是已有进度归档，不提升版本或把原APK作为后续源码的新构建。

## 家里第一次获取

准备Git、Node.js 24和npm，在希望保存项目的父目录打开PowerShell：

```powershell
git clone --branch codex/rollback-ui-0235-20260921 --single-branch https://github.com/Siger1989/map.git
cd map
git status --short --branch
git rev-parse HEAD
git ls-remote origin refs/heads/codex/rollback-ui-0235-20260921
npm ci
npx tsc --noEmit
node --experimental-strip-types --test tests/map-layer-preferences.test.mjs
npm run dev -- --host 127.0.0.1 --port 3108
```

`git rev-parse HEAD`应与远程分支SHA一致；后续其他电脑再次推送时以新远程SHA为准。浏览器打开 `http://127.0.0.1:3108/`。源码路径任意，不要求家里也有D盘或同名目录。Node依赖与MapLibre worker由`npm ci`恢复，不能复制旧node_modules。

若要使用与APK一致的移动入口，保留上面的API服务，另开终端进入同一项目：

```powershell
npx vite --config mobile/vite.config.ts --host 127.0.0.1 --port 9174 --strictPort
```

打开 `http://127.0.0.1:9174/`，默认预览390×857，窄屏独立检查360×780。移动入口`/api`默认代理到3108；需要改地址时用`SHANTU_DEV_API_URL`。只有移动前端、没有API后端时，在线地图/天气请求可能失败。

## 家里已有仓库

先执行`git status --short --branch`。若有未提交内容，先保留并整合，不能强制覆盖。工作区干净后：

```powershell
git fetch origin
git switch codex/rollback-ui-0235-20260921
git pull --ff-only origin codex/rollback-ui-0235-20260921
npm ci
```

本地尚无该分支时，用`git switch --track origin/codex/rollback-ui-0235-20260921`。若快进失败，停止并处理分叉，不执行hard reset或强推。

## 配置、签名与本机数据

- 用户在本次同步中明确授权，并再次要求不加密直接上传：`.env.local`中的地图服务配置和`mobile/.build/guanyun-test.jks`原Android签名密钥按原路径纳入本次提交。当前仓库为PUBLIC，这两项会随克隆以明文取得；此项为本次明确例外，覆盖早期文档“不上传密钥”的描述，不扩大到其他凭据。
- 签名文件已实际导出证书并核对SHA-256为`4a941b9dda8cfe6af755949ad690a5e2d4969557f99a2efe67c55637623e6f9f`，与已发布独立测试APK一致。家里保留该文件即可继续同签名构建，无需另传或生成新密钥。地图服务是否持续有效仍取决于服务授权与网络。
- 用户浏览器localStorage/IndexedDB、轨迹照片、手机私有数据和离线缓存不随源码迁移。需要同一批业务数据时，使用应用导出/备份功能另行迁移。
- `.codex-remote-attachments/`用户反馈原附件、`.openai/`运行日志/实验脚本、旧状态PDF和历史工作树未上传；必要结论已进入项目文档。Codex任务聊天也不随git clone迁移。

Android签名构建另需Windows、JDK17、Android SDK35/build-tools35.0.0。以下路径均需换成家里实际路径；正式新版本需先按项目规则提升版本，勿用同版名覆盖0.2.71发行资产：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-android.ps1 -StandaloneTest -SdkRoot 'C:\Android\Sdk' -JdkRoot 'C:\Java\jdk-17' -SigningKey 'mobile\.build\guanyun-test.jks'
```

可选浏览器验证脚本需要Playwright与Edge；不是网页启动依赖。可本机执行`npm install --no-save --package-lock=false playwright`，通过`MAP_BROWSER_PATH`指定Edge可执行文件；通过`BOX_SELECTION_URL`或`SHANTU_PREVIEW_URL`指定移动预览地址。截图输出`artifacts/screenshots/`，不自动同步。

## 后续工作与给家里Codex的说明

1. 先验证图层/图源记忆：两尺寸切换图源、开关与透明度、细节上限，立即刷新并关闭重开；兼顾2D/3D相机恢复、已删除图源和损坏设置回退。记录截图并由用户确认后再出包。
2. 弱信号轨迹断续尚未确诊，需原始轨迹/诊断数据；5米门槛可能拒绝低精度点，不能直接认定丢点算法已修好。
3. 继续Android覆盖安装与数据保留、双指操作、中文输入法、拍照往返、后台定位/离线下载真机验证。
4. 深色UI草案需逐页确认；上下同步双地图仍只记录，不自行开始开发。HarmonyOS 6.1原生HAP/APP未交付，也未验证Android兼容安装。

可将以下内容交给家里Codex：

> 接手山兔项目，先读CURRENT_STATE.md、AGENTS.md、docs/agent-handoff.md和docs/progress-handoff-20260924.md。使用codex/rollback-ui-0235-20260921，先核对本地改动与远程SHA。0.2.71已发布；分支另含未进入APK的图层/图源记忆源码与测试，UI视觉系统仍是提案。保留轨迹、照片、布局与原签名，不恢复被否定的PDF改版。按我接下来指定的问题继续，先最小修改、定向验证、截图确认。
