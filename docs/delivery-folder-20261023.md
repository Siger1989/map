# 山兔交付文件夹整理说明（2026-10-23）

> **最终交付更新**：用户要求只要私人地图版，最新批次已统一为0.2.133，当前目录为 `交付包/山兔-0.2.133-test-2026-10-23/`，仅含三个private APK/EXE/DMG、说明与校验文件。天地图及39项个人图源保留。下文131/132六包批次为历史记录，原目录已移至 `EXE/历史交付/山兔-2026-10-23/`；不再作为当前交付。新脚本 `scripts/organize-release.mjs --private-only`，完整核验与哈希见 [133交付说明](release-0.2.133.md)。

## 状态

已完成六个产物的分类复制与逐文件 SHA-256 复核。当前 APK 与 Windows EXE 为 0.2.131，Mac 为 0.2.132 DMG。公开 DMG 的生成、真实挂载与本地服务已在 Apple Silicon 和 Intel 的 GitHub macOS 环境分别通过；交付的公开文件取自已验收的 Apple Silicon 作业。私有 DMG 仅在本机生成，独立 7-Zip 解压/CRC 与全部1933项清单哈希、私有seed一致性通过，没有上传私有数据。Finder双击、Gatekeeper、Safari与触控板仍未验证。

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

Mac 打开 DMG，将 `Shantu.app` 拖入 Applications，再双击应用启动。`.app` 是启动器；地图仍在浏览器窗口中通过本机服务运行，不是原生地图窗口。启动后保持 Terminal 服务窗口打开；关闭 Terminal 会停止服务。地图数据留在所用浏览器的本机存储中，复制 DMG 不会迁移存档。跨设备前使用应用内存档或完整工程导出。没有 Apple 开发者签名或公证。系统交互验收边界见上文；挂载和服务证据来自下述 macOS 作业，不来自文件整理脚本。

平台能力的真实 GPS、后台轨迹、触控、系统分享和相机等边界仍以各平台实际验收记录为准。本文件不构成真机验收声明。

## 发行依据

- [0.2.131 双平台交付记录](release-0.2.131.md)
- [0.2.132 Mac 便携版记录](release-0.2.132-macos.md)

## 整理命令

已从项目根目录执行并核对结果；需要重新整理相同产物时运行：

```powershell
pwsh -NoProfile -File .\scripts\organize-delivery.ps1
```

脚本预期 DMG 路径为 `EXE/Shantu-0.2.132-test-macOS-private.dmg` 和 `EXE/Shantu-0.2.132-test-macOS-public.dmg`。如果文件名、trailer、可选 sidecar 或哈希不符合预期，脚本会在创建/复制前停止并报告具体文件。

## DMG构建与验收证据

`scripts/macos-dmg/` 锁定纯Go HFS+/UDIF写入库，生成真实UDZO镜像，`.app`只有一份资源，带原品牌图标、Applications链接、两个Node运行时的0755权限和启动器。原始ZIP保留，不改名冒充DMG。新增 `.github/workflows/macos-dmg-check.yml` 与只读挂载检查器；图层业务/存储格式没有追加改变。交付目录已加入 `.gitignore`，防止个人图源产物被误提交。

[macOS双架构检查](https://github.com/Siger1989/map/actions/runs/39964437755) 使用构建提交 `6d0c8c2782c3a6a3129ab5fdb39984f3427382f9`：

- 两个作业均通过 `hdiutil verify` 与只读挂载、1932项公开payload哈希、plist/图标/Applications符号链接/可执行权限检查。
- 分别运行对应芯片的原生 Node 22.23.4、`Start-Mac.command`；服务报告132，首页可读，本地高程API返回PNG，重复启动复用原服务。
- 交付公开DMG来自 macOS 14.8.9 arm64 作业，下载后哈希与作业记录相符；Intel作业独立生成并验证相同输入及构建代码，镜像时间元数据可能不同。不把两次文件哈希当作相同。
- 两份最终 DMG 均经 Windows 上独立7-Zip 26.05识别为 Dmg/HFS+、ZLIB与CRC完整性通过。私有DMG解出资源后，全部1933项清单哈希与本机私有seed相符。
- Go路径/权限/架构定向测试通过；整理脚本语法、DMG trailer/sidecar与六个落盘产物哈希通过。运行日志留在 `.openai/`。

| DMG | 字节 | SHA-256 |
| --- | ---: | --- |
| 自用 private | 147370122 | e66a76150f2470cd2796aa3fcef38bf1f52785de3e9a824f3f8fd349286ca739 |
| 公开 public | 147366594 | a019a00b3aec05f12e9276aa5993c2f24520332fcc98f0b87593cb2280e9139c |

源码同步至 `codex/place-address-search-20261011`，不宣称合入main。原计划132 DMG独立发行已由 [133统一测试发行](https://github.com/Siger1989/map/releases/tag/v0.2.133-test-standalone) 取代；原131 APK/EXE与132 ZIP发行保留。
