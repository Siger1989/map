import AppKit
import WebKit
import UniformTypeIdentifiers

private let appURL = URL(string: "http://127.0.0.1:8787/")!
private let statusURL = URL(string: "http://127.0.0.1:8787/__shantu__/status")!

@main
@MainActor
final class ShantuApp: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private static var retainedDelegate: ShantuApp?
    private var appVersion: String {
        guard let resource = Bundle.main.resourceURL,
              let data = try? Data(contentsOf: resource.appendingPathComponent("manifest.json")),
              let manifest = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return "" }
        return manifest["appVersion"] as? String ?? ""
    }
    private var window: NSWindow!
    private var webView: WKWebView!
    private var serverProcess: Process?
    private var ownsServer = false
    private var smokeJSONPath: URL?
    private var smokeDownloadPath: URL?
    private var smokeDownloadContinuation: CheckedContinuation<Void, Error>?
    private var smokeFinished = false
    private var smokeStarted = false

    static func main() {
        let app = NSApplication.shared
        let delegate = ShantuApp()
        retainedDelegate = delegate
        app.delegate = delegate
        app.run()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.regular)
        installMenu()
        if let index = CommandLine.arguments.firstIndex(of: "--smoke-test"),
           CommandLine.arguments.indices.contains(index + 1) {
            smokeJSONPath = URL(fileURLWithPath: CommandLine.arguments[index + 1])
        }
        if smokeJSONPath != nil,
           let index = CommandLine.arguments.firstIndex(of: "--smoke-download"),
           CommandLine.arguments.indices.contains(index + 1) {
            smokeDownloadPath = URL(fileURLWithPath: CommandLine.arguments[index + 1])
        }
        guard !appVersion.isEmpty else {
            showStartupError("应用包缺少有效版本清单。")
            return
        }
        createWindow()
        Task { await startOrReuseServer() }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationWillTerminate(_ notification: Notification) {
        if ownsServer, let process = serverProcess, process.isRunning {
            process.terminate()
        }
    }

    private func createWindow() {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.autoresizingMask = [.width, .height]
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable],
                          backing: .buffered, defer: false)
        window.title = "山兔"
        window.center()
        window.contentView = webView
        window.minSize = NSSize(width: 760, height: 560)
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func installMenu() {
        let main = NSMenu()
        let app = NSMenuItem(title: "山兔", action: nil, keyEquivalent: "")
        main.addItem(app)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "关于山兔", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appMenu.addItem(.separator())
        appMenu.addItem(withTitle: "退出山兔", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        app.submenu = appMenu

        let edit = NSMenuItem()
        main.addItem(edit)
        let editMenu = NSMenu(title: "编辑")
        for (title, selector, key) in [
            ("撤销", Selector(("undo:")), "z"),
            ("重做", Selector(("redo:")), "Z"),
        ] {
            editMenu.addItem(withTitle: title, action: selector, keyEquivalent: key)
        }
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editMenu.addItem(withTitle: "复制", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editMenu.addItem(withTitle: "全选", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.submenu = editMenu

        let help = NSMenuItem()
        main.addItem(help)
        let helpMenu = NSMenu(title: "帮助")
        helpMenu.addItem(withTitle: "导入旧浏览器中的数据", action: #selector(showDataHelp), keyEquivalent: "")
        help.submenu = helpMenu
        NSApp.mainMenu = main
    }

    @objc private func showDataHelp() {
        let alert = NSAlert()
        alert.messageText = "导入旧浏览器数据"
        alert.informativeText = "山兔应用窗口使用独立的本地存储，Safari、Chrome 或旧便携网页中的数据不会自动出现。请先在原浏览器中导出山兔备份，再在本应用中使用数据导入功能。"
        alert.addButton(withTitle: "好")
        alert.runModal()
    }

    private func startOrReuseServer() async {
        do {
            if let version = try await runningServerVersion() {
                guard version == appVersion else {
                    throw NSError(domain: "Shantu", code: 1, userInfo: [NSLocalizedDescriptionKey: "端口 8787 上运行着山兔 \(version)，请先退出旧版本。"])
                }
                webView.load(URLRequest(url: appURL))
                return
            }

            let resources = Bundle.main.resourceURL!
            let nodeName = "node-\(ProcessInfo.processInfo.machineArchitecture)"
            let nodeURL = resources.appendingPathComponent("runtime/\(nodeName)")
            let serverURL = resources.appendingPathComponent("server.mjs")
            guard FileManager.default.isExecutableFile(atPath: nodeURL.path) else {
                throw NSError(domain: "Shantu", code: 2, userInfo: [NSLocalizedDescriptionKey: "应用内没有当前 Mac 架构的 Node 运行时。"])
            }
            let process = Process()
            process.executableURL = nodeURL
            process.arguments = [serverURL.path]
            var environment = ProcessInfo.processInfo.environment
            environment["SHANTU_WEB_PORT"] = "8787"
            environment["SHANTU_NO_OPEN"] = "1"
            process.environment = environment
            process.terminationHandler = { [weak self] child in
                DispatchQueue.main.async {
                    guard let self, self.ownsServer, child.terminationStatus != 0, !self.smokeFinished else { return }
                    let alert = NSAlert()
                    alert.messageText = "山兔本地服务已停止"
                    alert.informativeText = "服务进程已退出（状态码 \(child.terminationStatus)）。请重新打开山兔。"
                    alert.addButton(withTitle: "好")
                    alert.runModal()
                    NSApp.terminate(nil)
                }
            }
            try process.run()
            serverProcess = process
            ownsServer = true
            for _ in 0..<80 {
                if let version = try await runningServerVersion() {
                    guard version == appVersion else {
                        throw NSError(domain: "Shantu", code: 3, userInfo: [NSLocalizedDescriptionKey: "端口 8787 被其他版本占用（\(version)）。"])
                    }
                    if !process.isRunning { ownsServer = false }
                    webView.load(URLRequest(url: appURL))
                    return
                }
                if !process.isRunning { break }
                try await Task.sleep(for: .milliseconds(250))
            }
            throw NSError(domain: "Shantu", code: 4, userInfo: [NSLocalizedDescriptionKey: "无法启动本地地图服务，请检查应用包是否完整。"])
        } catch {
            showStartupError(error.localizedDescription)
        }
    }

    private func runningServerVersion() async throws -> String? {
        var request = URLRequest(url: statusURL, timeoutInterval: 1.5)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let object = try JSONSerialization.jsonObject(with: data) as? [String: String],
                  object["app"] == "shantu-desktop-web" else { return nil }
            return object["version"]
        } catch { return nil }
    }

    private func showStartupError(_ message: String) {
        if let output = smokeJSONPath {
            let data = try? JSONSerialization.data(withJSONObject: ["passed": false, "error": message], options: [.prettyPrinted])
            try? data?.write(to: output, options: .atomic)
            smokeFinished = true
            NSApp.terminate(nil)
            return
        }
        let alert = NSAlert()
        alert.messageText = "山兔无法启动"
        alert.informativeText = message
        alert.addButton(withTitle: "退出")
        alert.runModal()
        NSApp.terminate(nil)
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        let isLocalOrigin = url.scheme == "http" && url.host == "127.0.0.1" && url.port == 8787
        let isLocalBlob = url.scheme == "blob" && url.absoluteString.hasPrefix("blob:http://127.0.0.1:8787/")
        if navigationAction.shouldPerformDownload && (isLocalOrigin || isLocalBlob) {
            decisionHandler(.download)
        } else if isLocalOrigin || isLocalBlob {
            decisionHandler(.allow)
        } else if navigationAction.navigationType == .linkActivated,
                  ["https", "http", "mailto"].contains(url.scheme?.lowercased() ?? "") {
            NSWorkspace.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.cancel)
        }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        guard navigationAction.targetFrame == nil, let url = navigationAction.request.url,
              url.host == "127.0.0.1", url.port == 8787 else { return nil }
        webView.load(navigationAction.request)
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationResponse: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(navigationResponse.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        if let smokePath = smokeDownloadPath {
            guard !FileManager.default.fileExists(atPath: smokePath.path) else {
                completionHandler(nil)
                finishSmokeDownload(.failure(NSError(domain: "ShantuSmoke", code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "smoke 下载目标文件已存在。"])))
                return
            }
            completionHandler(smokePath)
            return
        }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = suggestedFilename
        panel.canCreateDirectories = true
        panel.begin { [weak self] response in
            guard response == .OK, let destination = panel.url else {
                completionHandler(nil)
                return
            }
            do {
                if FileManager.default.fileExists(atPath: destination.path) {
                    try FileManager.default.removeItem(at: destination)
                }
                completionHandler(destination)
            } catch {
                completionHandler(nil)
                self?.showDownloadError(error.localizedDescription)
            }
        }
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let smokePath = smokeDownloadPath else { return }
        do {
            let contents = try String(contentsOf: smokePath, encoding: .utf8)
            guard contents == "shantu-wkdownload-smoke" else {
                throw NSError(domain: "ShantuSmoke", code: 4,
                    userInfo: [NSLocalizedDescriptionKey: "WKDownload 文件内容与测试值不符。"])
            }
            finishSmokeDownload(.success(()))
        } catch {
            finishSmokeDownload(.failure(error))
        }
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        if smokeDownloadPath != nil {
            finishSmokeDownload(.failure(error))
            return
        }
        let nsError = error as NSError
        guard nsError.code != NSURLErrorCancelled else { return }
        showDownloadError(error.localizedDescription)
    }

    private func showDownloadError(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "文件下载失败"
        alert.informativeText = message
        alert.addButton(withTitle: "好")
        alert.beginSheetModal(for: window)
    }

    private func finishSmokeDownload(_ result: Result<Void, Error>) {
        guard let continuation = smokeDownloadContinuation else { return }
        smokeDownloadContinuation = nil
        continuation.resume(with: result)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.allowedContentTypes = [.item]
        panel.begin { response in completionHandler(response == .OK ? panel.urls : nil) }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        guard let output = smokeJSONPath, !smokeStarted else { return }
        smokeStarted = true
        Task { await runSmokeTest(output: output) }
    }

    private func runSmokeTest(output: URL) async {
        guard !smokeFinished else { return }
        let script = """
        (() => { const c=document.querySelector('canvas.maplibregl-canvas') || document.querySelector('canvas');
          let gl=false; try { gl=!!c?.getContext('webgl2'); } catch(e) {}
          return {ready:document.readyState, title:document.title, canvas:!!c, webgl2:gl,
                  mapUI:!!document.querySelector('.maplibregl-map'), url:location.href}; })()
        """
        do {
            var result: [String: Any] = [:]
            for _ in 0..<120 {
                let value = try await webView.evaluateJavaScript(script)
                result = value as? [String: Any] ?? [:]
                if result["ready"] as? String == "complete" && result["canvas"] as? Bool == true &&
                    result["webgl2"] as? Bool == true && result["mapUI"] as? Bool == true { break }
                try await Task.sleep(for: .milliseconds(500))
            }
            let storageResult = try await runStorageSmoke()
            let snapshot = try await webView.takeSnapshot(configuration: nil)
            guard let tiff = snapshot.tiffRepresentation,
                  let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else {
                throw NSError(domain: "ShantuSmoke", code: 2, userInfo: [NSLocalizedDescriptionKey: "无法生成窗口截图。"])
            }
            let pngURL = output.deletingPathExtension().appendingPathExtension("png")
            try png.write(to: pngURL, options: .atomic)
            var passed = result["ready"] as? String == "complete" &&
                result["canvas"] as? Bool == true && result["webgl2"] as? Bool == true &&
                result["mapUI"] as? Bool == true && storageResult["localStorage"] == true &&
                storageResult["indexedDB"] == true
            var downloadResult: [String: Any] = ["requested": false]
            if let downloadPath = smokeDownloadPath {
                try await runBlobDownloadSmoke()
                downloadResult = ["requested": true, "passed": true, "path": downloadPath.path]
                passed = passed && (downloadResult["passed"] as? Bool == true)
            }
            let report: [String: Any] = ["passed": passed, "version": appVersion,
                "document": result, "storage": storageResult, "snapshot": pngURL.path,
                "download": downloadResult]
            let json = try JSONSerialization.data(withJSONObject: report, options: [.prettyPrinted, .sortedKeys])
            try json.write(to: output, options: .atomic)
            smokeFinished = true
            if ownsServer { serverProcess?.terminate() }
            NSApp.terminate(nil)
        } catch {
            let json = try? JSONSerialization.data(withJSONObject: ["passed": false, "error": error.localizedDescription], options: [.prettyPrinted])
            try? json?.write(to: output, options: .atomic)
            smokeFinished = true
            if ownsServer { serverProcess?.terminate() }
            NSApp.terminate(nil)
        }
    }

    private func runStorageSmoke() async throws -> [String: Bool] {
        let start = """
        (() => {
          try { localStorage.setItem('__shantu_smoke_storage', 'roundtrip');
            window.__shantuSmokeLocalStorage=localStorage.getItem('__shantu_smoke_storage')==='roundtrip';
            localStorage.removeItem('__shantu_smoke_storage'); }
          catch(e) { window.__shantuSmokeLocalStorage=false; }
          const dbName='shantu-smoke-'+Date.now(); window.__shantuSmokeIndexedDB='pending';
          try {
            const request=indexedDB.open(dbName,1);
            request.onupgradeneeded=()=>request.result.createObjectStore('probe');
            request.onerror=()=>window.__shantuSmokeIndexedDB=false;
            request.onsuccess=()=>{ const db=request.result; const tx=db.transaction('probe','readwrite');
              const store=tx.objectStore('probe'); store.put('roundtrip','key');
              const read=store.get('key'); read.onsuccess=()=>window.__shantuSmokeIndexedDB=read.result==='roundtrip';
              read.onerror=()=>window.__shantuSmokeIndexedDB=false;
              tx.oncomplete=()=>{ db.close(); indexedDB.deleteDatabase(dbName); };
              tx.onerror=()=>{ window.__shantuSmokeIndexedDB=false; db.close(); };
            };
          } catch(e) { window.__shantuSmokeIndexedDB=false; }
          return true;
        })()
        """
        let _: Any? = try await webView.evaluateJavaScript(start)
        var indexedDBPassed = false
        for _ in 0..<40 {
            let state = try await webView.evaluateJavaScript("window.__shantuSmokeIndexedDB")
            if let result = state as? Bool { indexedDBPassed = result; break }
            try await Task.sleep(for: .milliseconds(250))
        }
        let localStoragePassed = try await webView.evaluateJavaScript("window.__shantuSmokeLocalStorage") as? Bool == true
        return ["localStorage": localStoragePassed, "indexedDB": indexedDBPassed]
    }

    private func runBlobDownloadSmoke() async throws {
        guard smokeDownloadPath != nil else { return }
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            smokeDownloadContinuation = continuation
            Task { [weak self] in
                guard let self else { return }
                do {
                    let _: Any? = try await self.webView.evaluateJavaScript("""
                    (() => { const blob=new Blob(['shantu-wkdownload-smoke'],{type:'text/plain'});
                      const a=document.createElement('a'); a.href=URL.createObjectURL(blob);
                      a.download='shantu-smoke-download.txt'; a.click();
                      setTimeout(()=>URL.revokeObjectURL(a.href),30000); return true; })()
                    """)
                } catch {
                    self.finishSmokeDownload(.failure(error))
                }
            }
            Task { [weak self] in
                try? await Task.sleep(for: .seconds(20))
                guard let self, self.smokeDownloadContinuation != nil else { return }
                self.finishSmokeDownload(.failure(NSError(domain: "ShantuSmoke", code: 5,
                    userInfo: [NSLocalizedDescriptionKey: "等待 WKDownload blob 导出超时。"])))
            }
        }
    }
}

extension ProcessInfo {
    fileprivate var machineArchitecture: String {
        #if arch(arm64)
        return "arm64"
        #else
        return "x64"
        #endif
    }
}
