import AppKit
import WebKit

/// The map is the presentation layer. System operations live in these native services.
@MainActor
final class NativeBridge: NSObject, WKScriptMessageHandlerWithReply {
    private let storageRoot: URL
    private let window: () -> NSWindow?
    private let stateChanged: () -> Void
    weak var webView: WKWebView?
    private var pendingPush = false
    private var outstanding = 0
    private var activity: NSObjectProtocol?
    private lazy var location = NativeLocationService(storageRoot: storageRoot) { [weak self] in self?.changed() }
    private lazy var offline = NativeOfflineService(storageRoot: storageRoot) { [weak self] in self?.changed() }
    private lazy var files = NativeFileService(storageRoot: storageRoot, window: window)
    private let camera = NativeCameraService()

    init(window: @escaping () -> NSWindow?, stateChanged: @escaping () -> Void) throws {
        let support = try FileManager.default.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
        storageRoot = support.appendingPathComponent("org.shantu.map.launcher", isDirectory: true)
        try FileManager.default.createDirectory(at: storageRoot, withIntermediateDirectories: true)
        self.window = window
        self.stateChanged = stateChanged
        super.init()
    }

    static let bootstrap = """
    (() => {
      if (location.origin !== 'http://127.0.0.1:8787' || window.top !== window) return;
      const native = { version:1, snapshot:{}, request(action,args={}) {
        return window.webkit.messageHandlers.shantuNative.postMessage({action,args});
      }};
      Object.defineProperty(window,'ShantuMac',{value:native,writable:false,configurable:false});
      native.request('state').then(value => {
        native.snapshot=value; window.dispatchEvent(new Event('shantu-mac-state'));
      }).catch(() => {});
    })();
    """

    var hasActiveTasks: Bool { location.hasActiveRecording || offline.hasActiveDownload }
    var hasPendingDialogs: Bool { files.hasPendingOperation || camera.active }
    var taskDescription: String {
        [location.hasActiveRecording ? "轨迹记录" : nil, offline.hasActiveDownload ? "地图缓存下载" : nil].compactMap { $0 }.joined(separator: "、")
    }

    private var snapshot: [String: Any] {
        ["location": location.locationSnapshot, "recording": location.recordingSnapshot, "offline": offline.snapshot]
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame, message.webView === webView,
              origin.protocol == "http", origin.host == "127.0.0.1", origin.port == 8787,
              let url = webView?.url, url.scheme == "http", url.host == "127.0.0.1", url.port == 8787,
              let body = message.body as? [String: Any], let action = body["action"] as? String,
              action.utf8.count <= 80, let args = body["args"] as? [String: Any], outstanding < 64 else {
            replyHandler(nil, "原生请求来源或参数无效")
            return
        }
        outstanding += 1
        Task { @MainActor in
            defer { outstanding -= 1 }
            do {
                let value: Any
                if action == "state" { value = snapshot }
                else if action.hasPrefix("location.") || action.hasPrefix("record.") { value = try location.handle(action, args) }
                else if action.hasPrefix("offline.") { value = try await offline.handle(action, args) }
                else if action == "camera.capture" { value = try await camera.capture() }
                else if action == "settings.location" { value = openLocationSettings() }
                else { value = try await files.handle(action, args) }
                replyHandler(value, nil)
                if action != "state" && !action.hasSuffix(".state") && !action.hasSuffix(".read") && !action.hasSuffix(".has") { changed() }
            } catch {
                // Native services use user-facing errors without provider URLs or credentials.
                let ns = error as NSError
                let allowed = ["ShantuFiles", "ShantuCamera", "ShantuOffline", "ShantuLocation"]
                replyHandler(nil, allowed.contains(ns.domain) || error is LocalizedError ? error.localizedDescription : "系统操作失败，请检查权限或可用空间后重试")
                changed()
            }
        }
    }

    func openLocationSettings() -> Bool {
        guard let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_LocationServices") else { return false }
        return NSWorkspace.shared.open(url)
    }

    func changed() {
        updateActivity()
        stateChanged()
        guard !pendingPush else { return }
        pendingPush = true
        Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(200))
            guard let self else { return }
            self.pendingPush = false
            guard let data = try? JSONSerialization.data(withJSONObject: self.snapshot),
                  let json = String(data: data, encoding: .utf8) else { return }
            let js = "if(window.ShantuMac){window.ShantuMac.snapshot=\(json);window.dispatchEvent(new Event('shantu-mac-state'));}"
            _ = try? await self.webView?.evaluateJavaScript(js)
        }
    }

    private func updateActivity() {
        if hasActiveTasks && activity == nil {
            activity = ProcessInfo.processInfo.beginActivity(options: .userInitiatedAllowingIdleSystemSleep, reason: "山兔原生记录或地图下载")
        } else if !hasActiveTasks, let token = activity {
            ProcessInfo.processInfo.endActivity(token)
            activity = nil
        }
    }

    func pauseTasks() {
        if location.hasActiveRecording { _ = try? location.handle("record.command", ["command": "pause"]) }
        offline.shutdown()
        changed()
    }

    func shutdown() {
        location.shutdown()
        offline.shutdown()
        camera.shutdown()
        files.shutdown()
        if let token = activity { ProcessInfo.processInfo.endActivity(token); activity = nil }
    }
}
