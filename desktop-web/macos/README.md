# macOS 原生窗口启动器

启动器使用 AppKit 与 WKWebView 打开本机地图窗口，继续复用 `desktop-web/server.mjs`、`web/` 和已有的 Node 运行时。运行时应位于 App Bundle 的 `Contents/Resources/runtime/node-arm64`、`node-x64`；服务与网页位于 `Contents/Resources/server.mjs` 和 `web/`。启动器固定连接 `127.0.0.1:8787`，通过 `/__shantu__/status` 校验并复用同版本服务，运行服务时设置 `SHANTU_NO_OPEN=1`。应用退出时只终止本次启动且仍存活的服务进程。

在 macOS 13 或更新版本、安装 Xcode Command Line Tools 的 Mac 上，从仓库根目录执行：

```sh
sh desktop-web/macos/build-launcher.sh
```

脚本用 Apple Silicon 和 Intel 两个 target 分别编译，再合成 universal `Shantu` 可执行文件。默认输出到 `.openai/macos-launcher/Shantu`，也可以把输出目录作为第一个参数传入。将该可执行文件放到 `Shantu.app/Contents/MacOS/Shantu`，并在 `Info.plist` 保留 bundle identifier `org.shantu.map.launcher`、显示名“山兔”、版本号和最低系统版本 13。

在最终 App Bundle 中可执行冒烟检查：

```sh
"/path/to/Shantu.app/Contents/MacOS/Shantu" --smoke-test "$RUNNER_TEMP/shantu-smoke.json"
```

应用会在真实 WKWebView 中加载地图，检查文档完成、MapLibre 界面画布与 WebGL2，保存同名 `.png` 窗口截图及 JSON 结果，然后退出。检查需要可用的 macOS 图形会话；它不打开 Safari/其他浏览器。JSON 的 `passed` 必须为 `true`。该检查证明该 runner 上 WebView/界面启动，不证明地图服务的远端瓦片覆盖、真机性能或 Gatekeeper 签名公证。

窗口采用 WKWebView 默认持久网站存储。Safari、Chrome 与此前便携网页的数据不会自动迁移；“帮助 → 导入旧浏览器中的数据”提示用户先在旧浏览器导出应用备份，再在新窗口导入。文件选择由系统打开面板处理，浏览器下载（包括由 WebKit 识别为下载的 blob 下载）由系统保存面板处理。只有用户点击的外部链接会交给 macOS 默认应用打开。此版不声明原生 GPS 或后台定位能力。
