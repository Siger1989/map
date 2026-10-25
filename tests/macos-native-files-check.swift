import Foundation
import AppKit

@main
struct NativeFilesCheck {
    @MainActor static func main() async throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("shantu-files-test-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: root) }
        let service = NativeFileService(storageRoot: root, window: { nil })
        let token = try await service.handle("files.begin", ["name": "fixture.bin", "size": 3]) as! String
        let received = try await service.handle("files.append", ["token": token, "offset": 0, "base64": Data([1, 2, 3]).base64EncodedString()]) as! Int
        precondition(received == 3)
        let file = root.appendingPathComponent("Transfers/\(token)/fixture.bin")
        let stored = try Data(contentsOf: file)
        precondition(stored == Data([1, 2, 3]))
        do {
            _ = try await service.handle("files.append", ["token": token, "offset": 0, "base64": "AA=="])
            fatalError("duplicate chunk accepted")
        } catch {}
        do {
            _ = try await service.handle("files.finish", ["token": token, "share": false])
            fatalError("reported success without a save window")
        } catch {}
        precondition(!FileManager.default.fileExists(atPath: file.path))
        do {
            _ = try await service.handle("files.begin", ["name": "large", "size": 101 * 1024 * 1024])
            fatalError("oversize accepted")
        } catch {}
        let abandoned = try await service.handle("files.begin", ["name": "cancel.bin", "size": 10]) as! String
        _ = try await service.handle("files.cancel", ["token": abandoned])
        precondition(!service.hasPendingOperation)
        print("Native file transfer, bounds, order, failure and cancellation: PASS")
    }
}
