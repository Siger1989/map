import Foundation
import CryptoKit

@MainActor
enum NativeOfflineServiceTests {
    private static let tileURL = "https://8.8.8.8/tiles/a.png"
    private static let validPNG = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ14AAAAASUVORK5CYII=")!

    private static func fixture(id: String, urls: [String], dataByURL: [String: Data] = [:]) throws -> (NativeOfflineService, URL) {
        let storage = FileManager.default.temporaryDirectory.appendingPathComponent("shantu-offline-test-\(UUID().uuidString)")
        let native = storage.appendingPathComponent("NativeOffline")
        let tiles = native.appendingPathComponent("tiles")
        let manifests = native.appendingPathComponent("packages")
        try FileManager.default.createDirectory(at: tiles, withIntermediateDirectories: true)
        try FileManager.default.createDirectory(at: manifests, withIntermediateDirectories: true)
        let token = "fixture-token"
        for (raw, data) in dataByURL { try data.write(to: tiles.appendingPathComponent(hash(raw))) }
        let manifest = manifests.appendingPathComponent("\(hash(id)).\(hash(token)).urls")
        try JSONEncoder().encode(urls).write(to: manifest)
        let metadata: [String: Any] = ["id": id, "name": "existing", "done": 0, "bytes": 0,
                                       "state": "paused", "manifestToken": token]
        try JSONSerialization.data(withJSONObject: metadata).write(to: manifests.appendingPathComponent("\(hash(id)).meta"))
        return (NativeOfflineService(storageRoot: storage, changed: {}), storage)
    }

    private static func hash(_ text: String) -> String {
        SHA256.hash(data: Data(text.utf8)).map { String(format: "%02x", $0) }.joined()
    }

    static func testDraftFailureAndDiscardPreserveCommittedManifest() async throws {
        let (service, storage) = try fixture(id: "trip", urls: [tileURL])
        try expect(try await service.handle("offline.begin", ["id": "trip", "name": "replacement", "total": 2]) as? String == "ok", "begin")
        try expect(try await service.handle("offline.append", ["id": "trip", "offset": 0, "urls": ["https://8.8.8.8/tiles/new.png"]]) as? String == "ok", "first draft append")
        do {
            _ = try await service.handle("offline.append", ["id": "trip", "offset": 1, "urls": ["http://127.0.0.1/private"]])
            throw TestFailure.failed("private URL should reject the append")
        } catch is TestFailure { throw TestFailure.failed("private URL should reject the append") } catch { }
        do { _ = try await service.handle("offline.commit", ["id": "trip"]); throw TestFailure.failed("incomplete draft should not commit") }
        catch is TestFailure { throw TestFailure.failed("incomplete draft should not commit") } catch { }
        let resumedDraft = NativeOfflineService(storageRoot: storage, changed: {})
        try expect(try await resumedDraft.handle("offline.append", ["id": "trip", "offset": 1, "urls": ["https://8.8.8.8/tiles/second.png"]]) as? String == "ok", "draft must resume after restart")
        _ = try await resumedDraft.handle("offline.discard", ["id": "trip"])
        let state = try await service.handle("offline.verify", ["id": "trip"]) as? [String: Any]
        try expect(state?["total"] as? Int == 1 && state?["state"] as? String == "paused", "discard must preserve the committed package")
    }

    static func testVerifyRecountsOnlyValidContiguousFiles() async throws {
        let secondURL = "https://8.8.8.8/tiles/b.png"
        let (service, _) = try fixture(id: "verify", urls: [tileURL, secondURL], dataByURL: [tileURL: validPNG, secondURL: Data("html".utf8)])
        let state = try await service.handle("offline.verify", ["id": "verify"]) as? [String: Any]
        try expect(state?["done"] as? Int == 1, "verification must stop at the first invalid tile")
        try expect(state?["bytes"] as? Int64 == Int64(validPNG.count), "verification must recalculate actual bytes")
        try expect(state?["state"] as? String == "paused", "invalid completed package must pause")
    }

    static func testLocalReadAndHasDoNotRequireDNS() async throws {
        let unresolved = "https://this-host-must-not-resolve.invalid/tiles/a.png"
        let (service, _) = try fixture(id: "local-read", urls: [unresolved], dataByURL: [unresolved: validPNG])
        try expect(try await service.handle("offline.has", ["url": unresolved]) as? Bool == true, "local cache hit must not resolve DNS")
        let result = try await service.handle("offline.read", ["url": unresolved]) as? [String: String]
        try expect(result?["mime"] == "image/png" && result?["base64"] != nil, "local tile read must work without DNS")
    }

    static func testUncommittedDeleteTombstoneRestoresMetadataFormat() async throws {
        let (service, storage) = try fixture(id: "rollback", urls: [tileURL])
        _ = service
        let manifests = storage.appendingPathComponent("NativeOffline/packages")
        let metadataURL = manifests.appendingPathComponent("\(hash("rollback")).meta")
        let tombstone = manifests.appendingPathComponent("\(hash("rollback")).deleting-test")
        try FileManager.default.moveItem(at: metadataURL, to: tombstone)
        let deletionRecord: [String: Any] = [
            "metadata": ["id": "rollback", "name": "existing", "done": 0, "bytes": 0,
                         "state": "paused", "error": NSNull(), "manifestToken": "fixture-token"],
            "urls": [tileURL]
        ]
        try JSONSerialization.data(withJSONObject: deletionRecord).write(to: tombstone, options: .atomic)
        let restored = NativeOfflineService(storageRoot: storage, changed: {})
        let state = try await restored.handle("offline.verify", ["id": "rollback"]) as? [String: Any]
        try expect(state?["total"] as? Int == 1 && state?["state"] as? String == "paused", "manifest still present must roll back tombstone to a normal package")
        try expect(FileManager.default.fileExists(atPath: metadataURL.path) && !FileManager.default.fileExists(atPath: tombstone.path), "rollback must restore .meta and clear tombstone")
    }

    static func testSharedTileIsReusedWithoutNetworkOrDoubleCounting() async throws {
        let (service, _) = try fixture(id: "existing", urls: [tileURL], dataByURL: [tileURL: validPNG])
        try expect(try await service.handle("offline.begin", ["id": "new", "name": "new", "total": 1]) as? String == "ok", "begin shared package")
        try expect(try await service.handle("offline.append", ["id": "new", "offset": 0, "urls": [tileURL]]) as? String == "ok", "append shared URL")
        try expect(try await service.handle("offline.commit", ["id": "new"]) as? String == "ok", "commit shared package")
        var state: [String: Any] = [:]
        for _ in 0..<100 {
            state = try await service.handle("offline.verify", ["id": "new"]) as? [String: Any] ?? [:]
            if state["state"] as? String == "complete" { break }
            try await Task.sleep(for: .milliseconds(20))
        }
        try expect(state["state"] as? String == "complete" && state["done"] as? Int == 1, "shared tile should complete without a request")
        try expect(state["bytes"] as? Int64 == Int64(validPNG.count), "shared bytes count once at actual size")
        try expect(try await service.handle("offline.remove", ["id": "existing"]) as? Bool == true, "remove old package")
        try expect(try await service.handle("offline.has", ["url": tileURL]) as? Bool == true, "shared tile must survive removal")
    }

    static func testRetryAfterIsNeverShortenedAndFinal429DoesNotRetry() throws {
        let url = URL(string: "https://8.8.8.8/tiles/a.png")!
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        let longWait = HTTPURLResponse(url: url, statusCode: 429, httpVersion: "HTTP/1.1", headerFields: ["Retry-After": "120"])!
        let ordinaryWait = HTTPURLResponse(url: url, statusCode: 429, httpVersion: "HTTP/1.1", headerFields: ["Retry-After": "45"])!
        try expect(NativeOfflineService.retryDecision(longWait, attempt: 0, now: now) == .pause, "long service retry must pause")
        try expect(NativeOfflineService.retryDecision(ordinaryWait, attempt: 0, now: now) == .wait(45), "short retry must respect Retry-After")
        try expect(NativeOfflineService.retryDecision(ordinaryWait, attempt: 3, now: now) == .pause, "last 429 must not sleep or retry")
    }

    static func testURLRulesCoverPrivateIPv4IPv6DNSAndLength() throws {
        for raw in ["http://127.0.0.1/tile", "http://2130706433/tile", "http://[::ffff:127.0.0.1]/tile", "http://localhost./tile", "https://printer.local/tile", "file:///etc/passwd"] {
            do { try NativeOfflineService.validateURL(raw); throw TestFailure.failed("Expected URL rejection: \(raw)") }
            catch is TestFailure { throw TestFailure.failed("Expected URL rejection: \(raw)") }
            catch { }
        }
        let privateV6: [UInt8] = [0xfd,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1]
        let publicV6: [UInt8] = [0x20,0x01,0x48,0x60,0,0,0,0,0,0,0,0,0,0,0,0x88]
        try expect(NativeOfflineService.isPrivateIPv6(privateV6), "ULA IPv6 must be private")
        try expect(!NativeOfflineService.isPrivateIPv6(publicV6), "public IPv6 must not be blocked by hostname prefixes")
        try expect(NativeOfflineService.isPrivateIPv6([UInt8](repeating: 0, count: 10) + [0xff,0xff,127,0,0,1]), "IPv4-mapped loopback must be private")
        try expect(!NativeOfflineService.exceedsTileLimit(written: 1024, expected: 8 * 1024 * 1024), "small image should not be cancelled")
        try expect(NativeOfflineService.exceedsTileLimit(written: 100, expected: 8 * 1024 * 1024 + 1), "large declared body should be cancelled before download")
        do { try NativeOfflineService.validateRedirect(URL(string: "http://127.0.0.1/private")!); throw TestFailure.failed("private redirect should reject") }
        catch is TestFailure { throw TestFailure.failed("private redirect should reject") }
        catch { }
        do { try NativeOfflineService.validateURL("https://8.8.8.8/" + String(repeating: "a", count: 16_384)); throw TestFailure.failed("oversized URL should reject") }
        catch is TestFailure { throw TestFailure.failed("oversized URL should reject") }
        catch { }
    }

    static func testIntegerRejectsFractionsBooleansAndOverflow() async throws {
        let storage = FileManager.default.temporaryDirectory.appendingPathComponent("shantu-offline-test-\(UUID().uuidString)")
        let service = NativeOfflineService(storageRoot: storage, changed: {})
        for total: Any in [1.5, true, 9.223372036854776e18] {
            do { _ = try await service.handle("offline.begin", ["id": UUID().uuidString, "name": "test", "total": total]); throw TestFailure.failed("invalid integer accepted") }
            catch is TestFailure { throw TestFailure.failed("invalid integer accepted") }
            catch { }
        }
    }

    private static func expect(_ condition: Bool, _ message: String) throws {
        guard condition else { throw TestFailure.failed(message) }
    }
}

private enum TestFailure: Error { case failed(String) }

@main
struct RunNativeOfflineServiceTests {
    @MainActor
    static func main() async throws {
        try await NativeOfflineServiceTests.testDraftFailureAndDiscardPreserveCommittedManifest()
        try await NativeOfflineServiceTests.testVerifyRecountsOnlyValidContiguousFiles()
        try await NativeOfflineServiceTests.testLocalReadAndHasDoNotRequireDNS()
        try await NativeOfflineServiceTests.testUncommittedDeleteTombstoneRestoresMetadataFormat()
        try await NativeOfflineServiceTests.testSharedTileIsReusedWithoutNetworkOrDoubleCounting()
        try NativeOfflineServiceTests.testRetryAfterIsNeverShortenedAndFinal429DoesNotRetry()
        try NativeOfflineServiceTests.testURLRulesCoverPrivateIPv4IPv6DNSAndLength()
        try await NativeOfflineServiceTests.testIntegerRejectsFractionsBooleansAndOverflow()
        print("NativeOfflineServiceTests passed")
    }
}
