import AppKit
import Foundation

/// All paths are either application-owned staging files or chosen in an OS save panel.
@MainActor
final class NativeFileService: NSObject, NSSharingServicePickerDelegate, NSSharingServiceDelegate {
    private struct Transfer {
        let url: URL
        let name: String
        let size: Int
        var received: Int
    }
    private let root: URL
    private let window: () -> NSWindow?
    private var transfers: [String: Transfer] = [:]
    private var finishing = Set<String>()
    private var picker: NSSharingServicePicker?
    private var sharing: CheckedContinuation<String, Error>?
    private var saving = false
    var hasPendingOperation: Bool { saving || sharing != nil || !transfers.isEmpty }

    init(storageRoot: URL, window: @escaping () -> NSWindow?) {
        root = storageRoot.appendingPathComponent("Transfers", isDirectory: true)
        self.window = window
        super.init()
    }

    private func failure(_ message: String) -> NSError {
        NSError(domain: "ShantuFiles", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
    }

    func handle(_ action: String, _ args: [String: Any]) async throws -> Any {
        switch action {
        case "clipboard.write":
            guard let text = args["text"] as? String, text.utf8.count <= 1_048_576 else { throw failure("复制内容过大或无效") }
            NSPasteboard.general.clearContents()
            guard NSPasteboard.general.setString(text, forType: .string) else { throw failure("写入系统剪贴板失败") }
            return true
        case "share.text":
            guard let text = args["text"] as? String, !text.isEmpty, text.utf8.count <= 1_048_576 else { throw failure("分享内容无效") }
            return try await share([text])
        case "share.url":
            guard let raw = args["url"] as? String, let url = URL(string: raw),
                  ["https", "http"].contains(url.scheme?.lowercased() ?? ""), url.host != nil else { throw failure("分享链接无效") }
            return try await share([url])
        case "files.begin":
            guard transfers.count < 3, let raw = args["name"] as? String,
                  let number = args["size"] as? NSNumber else { throw failure("文件请求无效或已有太多传输") }
            let size = number.doubleValue
            let name = (raw as NSString).lastPathComponent
            guard !name.isEmpty, name != ".", name != "..", name.utf8.count <= 240,
                  !name.contains("\0"), size.isFinite, size.rounded() == size, size >= 0, size <= 100 * 1024 * 1024 else {
                throw failure("文件名称无效或超过100MiB")
            }
            try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
            let token = UUID().uuidString
            let folder = root.appendingPathComponent(token, isDirectory: true)
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
            let url = folder.appendingPathComponent(name)
            guard FileManager.default.createFile(atPath: url.path, contents: nil) else { throw failure("无法创建输出临时文件") }
            transfers[token] = Transfer(url: url, name: name, size: Int(size), received: 0)
            return token
        case "files.append":
            guard let token = args["token"] as? String, var transfer = transfers[token],
                  let offset = args["offset"] as? NSNumber, offset.doubleValue == Double(transfer.received),
                  let encoded = args["base64"] as? String, encoded.utf8.count <= 350_000,
                  let bytes = Data(base64Encoded: encoded), !bytes.isEmpty, bytes.count <= 262_144,
                  transfer.received + bytes.count <= transfer.size else { throw failure("文件分块无效或顺序错误") }
            let handle = try FileHandle(forWritingTo: transfer.url)
            defer { try? handle.close() }
            try handle.seekToEnd()
            try handle.write(contentsOf: bytes)
            transfer.received += bytes.count
            transfers[token] = transfer
            return transfer.received
        case "files.cancel":
            guard let token = args["token"] as? String else { throw failure("文件令牌无效") }
            guard !finishing.contains(token) else { throw failure("系统文件对话框已经打开，请在对话框中取消") }
            discard(token)
            return true
        case "files.finish":
            guard let token = args["token"] as? String, !finishing.contains(token), let transfer = transfers[token], transfer.received == transfer.size else {
                throw failure("文件尚未完整传输")
            }
            finishing.insert(token)
            defer { finishing.remove(token); discard(token) }
            let handle = try FileHandle(forWritingTo: transfer.url)
            try handle.synchronize()
            try handle.close()
            if args["share"] as? Bool == true { return try await share([transfer.url]) }
            return try await save(transfer)
        default: throw failure("不支持的文件操作")
        }
    }

    private func discard(_ token: String) {
        guard let transfer = transfers.removeValue(forKey: token) else { return }
        // A UUID child created by this instance, never an arbitrary page-supplied path.
        try? FileManager.default.removeItem(at: transfer.url.deletingLastPathComponent())
    }

    private func save(_ transfer: Transfer) async throws -> String {
        guard !saving, sharing == nil, let window = window() else { throw failure("请先完成当前系统对话框") }
        saving = true
        defer { saving = false }
        let panel = NSSavePanel()
        panel.nameFieldStringValue = transfer.name
        panel.canCreateDirectories = true
        let response = await withCheckedContinuation { continuation in
            panel.beginSheetModal(for: window) { continuation.resume(returning: $0) }
        }
        guard response == .OK, let destination = panel.url else { return "cancelled" }
        let temporary = destination.deletingLastPathComponent().appendingPathComponent(".shantu-\(UUID().uuidString).tmp")
        defer { try? FileManager.default.removeItem(at: temporary) }
        try FileManager.default.copyItem(at: transfer.url, to: temporary)
        if FileManager.default.fileExists(atPath: destination.path) {
            _ = try FileManager.default.replaceItemAt(destination, withItemAt: temporary)
        } else { try FileManager.default.moveItem(at: temporary, to: destination) }
        return "saved"
    }

    private func share(_ items: [Any]) async throws -> String {
        guard sharing == nil, !saving, let view = window()?.contentView else { throw failure("请先完成当前系统对话框") }
        return try await withCheckedThrowingContinuation { continuation in
            sharing = continuation
            let next = NSSharingServicePicker(items: items)
            picker = next
            next.delegate = self
            next.show(relativeTo: NSRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1), of: view, preferredEdge: .minY)
        }
    }

    func sharingServicePicker(_ sharingServicePicker: NSSharingServicePicker, didChoose service: NSSharingService?) {
        if service == nil { finishSharing(.success("cancelled")) }
    }
    func sharingServicePicker(_ sharingServicePicker: NSSharingServicePicker, delegateFor sharingService: NSSharingService) -> NSSharingServiceDelegate? { self }
    func sharingService(_ sharingService: NSSharingService, didShareItems items: [Any]) { finishSharing(.success("shared")) }
    func sharingService(_ sharingService: NSSharingService, didFailToShareItems items: [Any], error: Error) { finishSharing(.failure(failure("系统分享未完成，请重试"))) }

    private func finishSharing(_ result: Result<String, Error>) {
        let continuation = sharing
        sharing = nil
        picker = nil
        continuation?.resume(with: result)
    }

    func shutdown() {
        finishSharing(.success("cancelled"))
        for token in Array(transfers.keys) { discard(token) }
    }
}
