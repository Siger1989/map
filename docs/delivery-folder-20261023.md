# 山兔交付文件夹整理说明（2026-10-23）

## 状态

这是待运行的整理方案。当前 APK 与 Windows EXE 为 0.2.131，Mac 为 0.2.132 DMG。主审尚待确认 DMG 挂载与运行；本脚本不执行挂载或启动，也不预写该项通过。脚本会检查两份 DMG 的文件名、`koly` trailer、可选 `.sha256` sidecar 和最终文件哈希，再开始整理。

目标目录：`D:\天气系统\交付包\山兔-2026-10-23`

```text
山兔-2026-10-23/
├── README-交付说明.md
├── SHA256SUMS-2026-10-23.txt
├── 01-Android-APK/
│   ├── 自用版-含个人图源/Shantu-0.2.131-test-private.apk
│   └── 公开版-不含个人图源/Shantu-0.2.131-test-public-standalone.apk
├── 02-Windows-EXE/
│   ├── 自用版-含个人图源/Shantu-0.2.131-windows-x64-private.exe
│   └── 公开版-不含个人图源/Shantu-0.2.131-windows-x64-public.exe
└── 03-macOS-DMG/
    ├── 自用版-含个人图源/Shantu-0.2.132-test-macOS-private.dmg
    └── 公开版-不含个人图源/Shantu-0.2.132-test-macOS-public.dmg
```

脚本逐项核对发行记录中的 APK/EXE SHA-256。APK 的 `standalone` 文件名不代表公开版：发行记录中 SHA `4c66cfbe...ba8b03` 明确对应自用包；脚本使用显式文件名和完整哈希分类。Windows 自用/公开文件按发行记录哈希分类，整理后的文件名使用 ASCII 版本化格式。Mac DMG 检查文件尾部 512 字节中的 `koly` trailer；如存在 `.sha256` sidecar，也会对照文件哈希。最终清单记录所有六个产物的相对路径与 SHA-256。

脚本不移动源产物，也不删除或改名历史版本。目标里已有同名且哈希一致的文件可安全复跑；同名但内容不同的文件会令脚本停止，不覆盖未知内容。目标 README 或校验清单若已存在但与本次生成内容不一致，也会停止。运行前请确认私有 DMG 只用于本人交付，公开 DMG 不含个人图源配置。

## 平台版本与安装边界

Android 和 Windows 仍是 0.2.131-test；Android versionCode 为 138。Mac DMG 为 0.2.132-test，版本更新包含 2026-10-23 地质图例、摇杆、等高距及高程服务相关改动。不要因 Mac 是 132 就将 APK/EXE 标记成 132。

Android 在设备上打开 APK 安装；首次可能需要允许当前文件管理器安装未知来源应用。覆盖现有应用需保持原包名与签名。Windows 双击 EXE；需要 WebView2 Runtime，行业 PNG 导出使用系统 Edge 或 Chrome。

Mac 打开 DMG，将 `Shantu.app` 拖入 Applications，再双击应用启动。`.app` 是启动器；地图仍在浏览器窗口中通过本机服务运行，不是原生地图窗口。启动后保持 Terminal 服务窗口打开；关闭 Terminal 会停止服务。地图数据留在所用浏览器的本机存储中，复制 DMG 不会迁移存档。跨设备前使用应用内存档或完整工程导出。Gatekeeper 设备提示、DMG 挂载和运行仍待主审确认；本整理脚本仅检查 DMG trailer 与 SHA-256，不声明挂载或运行通过。

平台能力的真实 GPS、后台轨迹、触控、系统分享和相机等边界仍以各平台实际验收记录为准。本文件不构成真机验收声明。

## 发行依据

- [0.2.131 双平台交付记录](release-0.2.131.md)
- [0.2.132 Mac 便携版记录](release-0.2.132-macos.md)

## 整理命令

待主审完成 DMG 挂载和运行检查后，从项目根目录运行：

```powershell
pwsh -NoProfile -File .\scripts\organize-delivery.ps1
```

脚本预期 DMG 路径为 `EXE/Shantu-0.2.132-test-macOS-private.dmg` 和 `EXE/Shantu-0.2.132-test-macOS-public.dmg`。如果文件名、trailer、可选 sidecar 或哈希不符合预期，脚本会在创建/复制前停止并报告具体文件。
