# 山兔 0.2.133：地质两格信息栏与摇杆回归修复

2026-10-23 用户先确认将地质说明移入菜单，随后用截图指定右侧比例尺下、工具栏上的位置，并明确改为两格。以最后指令为准：上格是地图中心准星的地质信息，下格显示当前地图已加载的全部地质类型且独立上下滚动。标题、来源、授权和重试仍放在“图层 → 地质图例与说明”。用户已明确要求重新打包 Android APK、Windows EXE、Mac DMG；三平台版本统一133，Android构建号140。

## 根因与改动

- 新 `GeologyMapLegend` 只呈现色块与名称，宽64px、总高最多196px；测量实际比例尺和工具栏边界，保持上下各8px间隔，正常内容自然换行。空间不足68px时隐藏，避免覆盖控件。超长当前名称保留下格最小空间并允许在固定上格内查看全文；下格独立滚动，隐藏可见滚动条。使用原有图例层级、共享主题和8px圆角。
- `GeologyState.cursorSelection` 与上次点击的 `selection` 分开；移动开始清除旧准星值，移动结束及瓦片空闲时查询屏幕中心命中的地质图斑。无命中明确为空，不把旧点击或第一类冒充当前点。所有类型列表不随准星选择缩成一项。
- 地质列表用React memo隔离无关相机角度更新，避免每个旋转采样重新展开大列表。
- 用户报告上下不能调、左右发顿。确认 `CameraGizmo.begin` 错把圆环死区用于模型拖动，模型下半部起点被拒绝。移除此误用，圆环仍保留原55%中心死区、跨中心暂停/重锚；模型的上下和左右完整命中区恢复。未凭猜测改变角速度。
- Mac DMG构建器改由经过校验的payload manifest读取版本，ZIP前缀、plist与README必须一致；保留哈希、路径、权限、架构验证，原生CI可验证指定Release的公开payload。

## 主审验证

| 项目 | 已完成的验证与边界 |
| --- | --- |
| 地质数据与交互 | 新字段中心/点击隔离、移动/无命中/关闭及事件清理覆盖；18项地质/相机/图层/跨平台版本定向检查通过 |
| 摇杆 | 渲染React组件的pointerdown/move/up证明死区内模型起点可同时俯仰和旋转，圆环同点仍拒绝；失去捕获/取消正确收尾。真实浏览器键盘0→5°俯仰、0→5°旋转并恢复通过；用户随后明确反馈“上下、左右都恢复了”。手机触控与持续FPS仍待设备验证 |
| 390×857 | 实际图例宽64px、高约196px；距比例尺/工具栏各约8px；当前上格47px完整，下格141px可滚，单一当前点信息与全类型分开 |
| 360×780 | 实际总高约118px；上格固定、下格独立滚动。实际列表滚动后相机状态不变，当前名称与地图中心查询结果一致；最终源码截图上格47px，下格63px，scrollHeight608px，End滚到末尾544px |
| 390×480 | 右侧没有足够空隙，图例隐藏；不覆盖比例尺/工具和摇杆。打开菜单与锁定隐藏，关闭/解锁恢复通过 |
| 编译与DMG工具 | 最终TypeScript、预览构建、Go构建器测试及gofmt通过。界面截图在 `artifacts/screenshots/release-133/` |

网络数据真实存在局限：当前预览部分底图瓦片请求失败；地质原图覆盖、原始语言及精度照实保留。IP位置不是真实GPS，没有改记录、图源Key或用户存档。

## 最终安装包与交付

三平台private/public均从本轮冻结的最终源码（`2544b517bda1422e58bc3f63ca245fae79c4ed4c`）独立构建。按用户最后要求，交付目录 **只含三个私人地图包**，保留本机天地图Key及39项个人图源seed；Key未打印或上传。目录为 `交付包/山兔-0.2.133-test-2026-10-23/`，含校验清单、manifest与安装说明。旧131/132六包批次保留在 `EXE/历史交付/山兔-2026-10-23/`，不混在当前交付目录。固定 `APK/山兔手机.apk`、`EXE/山兔桌面.exe` 已更新至同一133私人版，版本化旧包保留。

| 私人交付文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| `01-Android-APK/Shantu-0.2.133-test-private.apk` | 70273209 | `a78494cc793da640db2d1dda2253c36183f8cb1b397849955b02af5b28ef138f` |
| `02-Windows-EXE/Shantu-0.2.133-windows-x64-private.exe` | 123851174 | `02711db09f8266ec26d1a2c823fd8acc4e1423a5754b17184dec13ca5f9cd9a8` |
| `03-macOS-DMG/Shantu-0.2.133-test-macOS-private.dmg` | 147370718 | `c67f980a32cbcab6d9cef66dc7864b938c94f355804256a63c4125759f9debc2` |

交付脚本 `node scripts/organize-release.mjs --version 0.2.133-test --date 2026-10-23 --private-only` 仅选择private三包；预检格式/字节数/sidecar与目标冲突，复制后再次核SHA。主审独立核对三项manifest、mode与文件哈希通过。

| 平台 | 成品核验 |
| --- | --- |
| Android | 私有/公开两包 versionName133、versionCode140，StandaloneTest包名 `com.guanyun.weather.shantu.preview`，原签名、zipalign、ZIP CRC通过；1926/1925项web文件、497项PNG分别匹配fresh stage。私有39项seed一致，公开无seed且72项本机凭据值扫描无命中 |
| Windows | 两EXE分别1929/1928项CArchive内容与最终web/shell逐项一致；frozen完整自检、地图/行业服务HTTP200、剖面/钻孔SVG/PNG通过。主审从最终私有EXE的隔离服务检查“内置”天地图、“我的图源”39项及影像选择/关闭；真实WebView窗口和设备性能未验收 |
| macOS | 私有DMG是真实HFS+/UDZO镜像，7-Zip CRC及解包1933项manifest哈希、39项seed通过。公开DMG在Apple Silicon（macos14）和Intel（macos15-intel）原生CI均通过hdiutil校验/只读挂载、完整payload哈希、plist/icon/symlink/执行权限、原生Node22.23.4、133服务/地形PNG及重复启动。最终公开DMG取自成功的Apple Silicon作业，SHA `75f3bb4ea303f5db9a8716082fc06dfbfc05441a292a8ecc0f0a8d517083013e`，147367285 bytes。私有DMG未上传CI |

主审还用Windows Node运行私有DMG解包后的原始服务与web资源，以临时同源390×857外框显示最终界面：天地图影像当前入口、地质中心信息和全部类型两格实际可见，截图 `artifacts/screenshots/release-133/final-mac-phone.png`。临时外框HTML仅加在解包验收副本，不在DMG内；此项不冒充原生Mac UI测试。临时9197/9198服务和验收标签页已结束，用户9174手机预览、独立3108 API与真实数据保留。

Mac原生CI：[两芯片验证](https://github.com/Siger1989/map/actions/runs/39973632124)。首次尝试因Release仍为draft无法读取payload而失败；公开测试发行可读取后，同一run第二次尝试两项成功，不把首次失败写成产品故障。

公开分发使用独立清除私有配置的APK、EXE、DMG及Mac ZIP，见 [0.2.133测试Release](https://github.com/Siger1989/map/releases/tag/v0.2.133-test-standalone)。源代码推送 `codex/place-address-search-20261011`，未声称合入main。公开资产与私人交付目录分开；最终7项GitHub资产（4个包、Mac两份sidecar、总校验清单）均为 `uploaded`，size及digest逐项与本机一致。最终发行标题/说明已去除“校验中”。本机证据 `.openai/release-133/github-final-verification.json`；自用包没有上传公开Release。

Mac DMG内是 `Shantu.app` 本地浏览器地图启动器，兼容Apple Silicon/Intel；当前未签名、公证，Finder/Gatekeeper/Safari/触控板和原生Android/Windows窗口/设备仍需分别验收。HarmonyOS原生包未交付。地质/相机之外的业务、真实用户存档、签名与图源凭据保持原配置。
