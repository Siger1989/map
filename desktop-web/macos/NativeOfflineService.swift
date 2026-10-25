import Foundation
import CryptoKit
import CoreFoundation
import Darwin

/// Persistent native tile storage for the macOS WKWebView host.
@MainActor
final class NativeOfflineService {
    private struct Package: Codable {
        var id: String
        var name: String
        var urls: [String]
        var done: Int
        var bytes: Int64
        var state: String
        var error: String?
        var manifestToken: String
    }
    private struct Metadata: Codable {
        var id: String
        var name: String
        var done: Int
        var bytes: Int64
        var state: String
        var error: String?
        var manifestToken: String
    }
    private struct Draft: Codable {
        var id: String
        var name: String
        var expected: Int
        var urls: [String]
    }
    private struct DeletionRecord: Codable {
        var metadata: Metadata
        var urls: [String]
    }
    private struct FetchedTile: Sendable {
        var temporaryURL: URL?
        var bytes: Int
    }
    fileprivate enum FetchIssue: Error, Equatable { case invalidResponse, tooLarge, invalidImage, rateLimited }
    fileprivate enum RetryDecision: Equatable { case wait(Int), pause }

    private let root: URL
    private let tiles: URL
    private let manifests: URL
    private let draftsDirectory: URL
    private let changed: () -> Void
    private var packages: [String: Package] = [:]
    private var lastID: String?
    private var activeID: String?
    private var generations: [String: Int] = [:]
    private var workers: [String: Task<Void, Never>] = [:]
    private var workerGeneration: [String: Int] = [:]
    private var diskBytes: Int64 = 0
    private let maxItems = 250_000
    private let maxTileBytes = 8 * 1024 * 1024
    private let maxBudget: Int64 = 8 * 1024 * 1024 * 1024
    private let parallelism = 16
    private let maxAutomaticRetryAfter = 60

    init(storageRoot: URL, changed: @escaping () -> Void) {
        root = storageRoot.appendingPathComponent("NativeOffline", isDirectory: true)
        tiles = root.appendingPathComponent("tiles", isDirectory: true)
        manifests = root.appendingPathComponent("packages", isDirectory: true)
        draftsDirectory = root.appendingPathComponent("drafts", isDirectory: true)
        self.changed = changed
        try? FileManager.default.createDirectory(at: tiles, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: manifests, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: draftsDirectory, withIntermediateDirectories: true)
        diskBytes = inventoryTileBytes()
        loadPackages()
    }

    var hasActiveDownload: Bool { activeID != nil || !workers.isEmpty }

    var snapshot: [String: Any] {
        guard let id = activeID ?? lastID, let package = packages[id] else { return [:] }
        return stateObject(package)
    }

    func handle(_ action: String, _ args: [String: Any]) async throws -> Any {
        switch action {
        case "offline.begin":
            let id = try string(args, "id"), name = try string(args, "name")
            let total = try integer(args, "total")
            guard total > 0, total <= maxItems, id.count <= 128 else { throw failure("缓存清单数量或标识无效") }
            guard activeID == nil else { throw failure("已有后台缓存正在下载，请先暂停") }
            let draft = Draft(id: id, name: String(name.prefix(160)), expected: total, urls: [])
            try persistDraft(draft)
            lastID = id
            return "ok"

        case "offline.append":
            let id = try string(args, "id"), offset = try integer(args, "offset")
            guard var draft = try loadDraft(id), activeID == nil else { throw failure("没有可追加的缓存任务") }
            guard let urls = args["urls"] as? [String], urls.count <= 1000, offset == draft.urls.count else { throw failure("缓存清单分段顺序无效") }
            guard draft.urls.count + urls.count <= draft.expected, draft.urls.count + urls.count <= maxItems else { throw failure("缓存清单超过声明数量或25万项上限") }
            for raw in urls { try validatePublicURL(raw) }
            draft.urls.append(contentsOf: urls)
            try persistDraft(draft)
            return "ok"

        case "offline.commit":
            let id = try string(args, "id")
            guard activeID == nil, workers.isEmpty else { throw failure("已有下载任务正在安全暂停，请稍后继续") }
            guard var draft = try loadDraft(id), draft.expected == draft.urls.count, !draft.urls.isEmpty else { throw failure("缓存清单尚未完整") }
            var previous = packages[id]
            if var existing = previous {
                let checked = verifyFiles(existing.urls)
                existing.done = checked.done
                existing.bytes = checked.bytes
                if existing.done != existing.urls.count, existing.state == "complete" { existing.state = "paused" }
                packages[id] = existing
                try persistMetadata(existing)
                previous = existing
            }
            let token = UUID().uuidString
            var package: Package
            if let previous, previous.urls == draft.urls {
                package = previous
                package.state = "downloading"; package.error = nil
                draft.name = draft.name.isEmpty ? previous.name : draft.name
                package.name = draft.name
            } else {
                package = Package(id: id, name: draft.name, urls: draft.urls, done: 0, bytes: 0,
                                  state: "downloading", error: nil, manifestToken: token)
            }
            if previous?.urls != draft.urls {
                package.manifestToken = token
                try writeManifest(draft.urls, id: id, token: token)
            }
            try ensureBudget()
            try persistMetadata(package)
            packages[id] = package
            try? removeDraft(id)
            if let old = previous, old.manifestToken != package.manifestToken { try? removeManifest(id: id, token: old.manifestToken) }
            lastID = id
            generations[id, default: 0] += 1
            let generation = generations[id]!
            activeID = id
            changed()
            let worker = Task { [weak self] in
                guard let self else { return }
                await self.download(id: id, generation: generation)
            }
            workers[id] = worker
            workerGeneration[id] = generation
            return "ok"

        case "offline.discard":
            let id = try string(args, "id")
            try removeDraft(id)
            return "ok"

        case "offline.pause":
            let id = activeID
            let pauseError = pauseCurrent(error: "下载已暂停，可继续")
            if let id, let worker = workers[id] { await worker.value }
            if let pauseError { throw pauseError }
            return "ok"

        case "offline.state": return snapshot

        case "offline.verify":
            let id = try string(args, "id")
            guard packages[id] != nil else { throw failure("缓存包不存在") }
            guard var package = packages[id] else { throw failure("缓存包不存在") }
            // Progress is persisted after each installed tile. Avoid blocking the UI on
            // a long-running download or racing its in-flight batch reconciliation.
            if workers[id] != nil { return stateObject(package) }
            let verified = verifyFiles(package.urls)
            package.done = verified.done
            package.bytes = verified.bytes
            if package.state == "complete", package.done != package.urls.count { package.state = "paused"; package.error = "缓存文件缺失或损坏，可继续下载" }
            if package.done == package.urls.count { package.state = "complete"; package.error = nil }
            packages[id] = package
            try persistMetadata(package)
            changed()
            return stateObject(package)

        case "offline.remove":
            let id = try string(args, "id")
            if activeID == id { pauseCurrent(error: "下载已暂停，可继续") }
            if let worker = workers[id] { await worker.value }
            guard let package = packages[id], package.state != "downloading" else { return false }
            let tombstone = try moveMetadataToTombstone(id)
            do {
                let metadata = Metadata(id: package.id, name: package.name, done: package.done, bytes: package.bytes,
                                        state: package.state, error: package.error, manifestToken: package.manifestToken)
                try atomicWrite(try JSONEncoder().encode(DeletionRecord(metadata: metadata, urls: package.urls)), to: tombstone)
                try removeManifest(id: id, token: package.manifestToken)
            } catch {
                do {
                    try persistMetadata(package)
                    try? FileManager.default.removeItem(at: tombstone)
                } catch { throw failure("删除未提交，但缓存清单恢复失败；请检查磁盘空间后重启应用") }
                throw error
            }
            // Manifest removal is the logical-delete commit point. Do not restore the package
            // after this point: some unreferenced tiles may already have been collected.
            packages.removeValue(forKey: id)
            let referenced = Set(packages.values.flatMap(\.urls))
            do {
                for raw in Set(package.urls) where !referenced.contains(raw) {
                    try removeTileIfPresent(raw)
                }
                try FileManager.default.removeItem(at: tombstone)
            } catch {
                if lastID == id { lastID = packages.keys.first }
                changed()
                throw failure("缓存包已删除，存储清理失败；稍后重试或重启应用可继续清理")
            }
            if lastID == id { lastID = packages.keys.first }
            changed()
            return true

        case "offline.read":
            guard let raw = args["url"] as? String else { return NSNull() }
            try Self.validateTileKey(raw)
            let file = tileURL(raw)
            guard let data = try? Data(contentsOf: file), data.count <= maxTileBytes,
                  Self.validImage(data, mime: Self.mimeType(data)) else { return NSNull() }
            return ["base64": data.base64EncodedString(), "mime": Self.mimeType(data)]

        case "offline.has":
            guard let raw = args["url"] as? String else { return false }
            try Self.validateTileKey(raw)
            return validTile(at: tileURL(raw))

        case "offline.availableBytes": return availableBytes()
        default: throw failure("不支持的原生离线操作")
        }
    }

    func shutdown() { _ = pauseCurrent(error: "应用已退出，下载已暂停，可继续") }

    private func download(id: String, generation: Int) async {
        defer {
            if workerGeneration[id] == generation {
                workers.removeValue(forKey: id)
                workerGeneration.removeValue(forKey: id)
            }
        }
        guard let original = packages[id], original.state == "downloading" else { return }
        let urls = original.urls
        var cursor = original.done
        var counted = Set(urls.prefix(cursor))

        while cursor < urls.count, !Task.isCancelled, isCurrent(id, generation) {
            let end = min(cursor + parallelism, urls.count)
            let batch = Array(urls[cursor..<end])
            let results = await fetchBatch(batch)
            defer {
                for result in results {
                    if case .success(let fetched) = result, let temporary = fetched.temporaryURL {
                        try? FileManager.default.removeItem(at: temporary)
                    }
                }
            }
            var stoppedAtGap = false
            for (index, result) in results.enumerated() {
                guard !Task.isCancelled, isCurrent(id, generation) else { return }
                guard case .success(let fetched) = result else {
                    let error = failureMessage(for: result)
                    pauseIfCurrent(id, generation, error: error)
                    stoppedAtGap = true
                    break
                }
                let raw = batch[index]
                let destination = tileURL(raw)
                do {
                    if let temporary = fetched.temporaryURL {
                        let oldSize = (try? destination.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
                        let projected = diskBytes - Int64(oldSize) + Int64(fetched.bytes)
                        guard projected <= maxBudget, availableBytes() > Int64(fetched.bytes) + 1_048_576 else {
                            pauseIfCurrent(id, generation, error: "磁盘剩余空间不足，缓存任务已暂停")
                            stoppedAtGap = true
                            break
                        }
                        do {
                            try replaceTile(temporary, destination: destination)
                            diskBytes = projected
                        } catch {
                            diskBytes = inventoryTileBytes()
                            throw error
                        }
                    } else if !validTile(at: destination) {
                        pauseIfCurrent(id, generation, error: "缓存文件校验失败，任务已暂停")
                        stoppedAtGap = true
                        break
                    }
                    guard var package = packages[id], isCurrent(id, generation) else { return }
                    package.done += 1
                    if counted.insert(raw).inserted { package.bytes += Int64(fetched.bytes) }
                    package.state = "downloading"; package.error = nil
                    try persistMetadata(package)
                    packages[id] = package
                    changed()
                } catch {
                    pauseIfCurrent(id, generation, error: "缓存存储失败，任务已暂停")
                    stoppedAtGap = true
                    break
                }
            }
            if stoppedAtGap { return }
            cursor = packages[id]?.done ?? cursor
        }

        guard var package = packages[id], isCurrent(id, generation) else { return }
        if package.done == package.urls.count {
            package.state = "complete"; package.error = nil
        } else {
            package.state = "paused"; package.error = "下载已暂停，可继续"
        }
        packages[id] = package
        activeID = nil
        do { try persistMetadata(package) }
        catch { package.state = "paused"; package.error = "缓存存储失败，任务已暂停"; packages[id] = package }
        changed()
    }

    private func fetchBatch(_ urls: [String]) async -> [Result<FetchedTile, Error>] {
        await withTaskGroup(of: (Int, Result<FetchedTile, Error>).self) { group in
            for (index, raw) in urls.enumerated() {
                let existing = tileURL(raw)
                group.addTask { [weak self] in
                    guard let self else { return (index, .failure(CancellationError())) }
                    return (index, await self.fetchTile(raw, cachedPath: existing.path))
                }
            }
            var results = Array<Result<FetchedTile, Error>?>(repeating: nil, count: urls.count)
            for await (index, result) in group { results[index] = result }
            return results.map { $0 ?? .failure(CancellationError()) }
        }
    }

    private nonisolated func fetchTile(_ raw: String, cachedPath: String) async -> Result<FetchedTile, Error> {
        do {
            let cachedURL = URL(fileURLWithPath: cachedPath)
            if Self.validTileFile(at: cachedURL), let values = try? cachedURL.resourceValues(forKeys: [.fileSizeKey]), let size = values.fileSize {
                return .success(FetchedTile(temporaryURL: nil, bytes: size))
            }
            try Self.validateURL(raw)
            guard let url = URL(string: raw) else { throw FetchIssue.invalidResponse }
            var request = URLRequest(url: url, timeoutInterval: 40)
            request.cachePolicy = .reloadIgnoringLocalCacheData
            var lastError: Error = FetchIssue.invalidResponse
            for attempt in 0..<4 {
                let delegate = BoundedPublicDownloadDelegate(maximumBytes: 8 * 1024 * 1024)
                var temporaryURL: URL?
                do {
                    let (temporary, response) = try await URLSession.shared.download(for: request, delegate: delegate)
                    temporaryURL = temporary
                    guard let http = response as? HTTPURLResponse else { try? FileManager.default.removeItem(at: temporary); throw FetchIssue.invalidResponse }
                    guard (200..<300).contains(http.statusCode) else {
                        try? FileManager.default.removeItem(at: temporary)
                        if http.statusCode == 429 {
                            if attempt == 3 { throw FetchIssue.rateLimited }
                            switch Self.retryDecision(http, attempt: attempt) {
                            case .pause: throw FetchIssue.rateLimited
                            case .wait(let seconds): try await Task.sleep(for: .seconds(seconds)); continue
                            }
                        }
                        throw FetchIssue.invalidResponse
                    }
                    if delegate.exceededLimit { try? FileManager.default.removeItem(at: temporary); throw FetchIssue.tooLarge }
                    let values = try temporary.resourceValues(forKeys: [.fileSizeKey])
                    guard let size = values.fileSize, size > 0, size <= 8 * 1024 * 1024 else { try? FileManager.default.removeItem(at: temporary); throw FetchIssue.tooLarge }
                    let data = try Data(contentsOf: temporary, options: .mappedIfSafe)
                    guard Self.validImage(data, mime: http.value(forHTTPHeaderField: "Content-Type")) else { try? FileManager.default.removeItem(at: temporary); throw FetchIssue.invalidImage }
                    return .success(FetchedTile(temporaryURL: temporary, bytes: size))
                } catch {
                    if let temporaryURL { try? FileManager.default.removeItem(at: temporaryURL) }
                    lastError = delegate.exceededLimit ? FetchIssue.tooLarge : error
                    if delegate.exceededLimit { return .failure(lastError) }
                    if (error as? FetchIssue) == .rateLimited || (error as? FetchIssue) == .tooLarge || (error as? FetchIssue) == .invalidImage { return .failure(error) }
                    if attempt < 3 { try await Task.sleep(for: .seconds(min(8, 1 << attempt))) }
                }
            }
            return .failure(lastError)
        } catch { return .failure(error) }
    }

    @discardableResult
    private func pauseCurrent(error: String?) -> Error? {
        guard let id = activeID, var package = packages[id] else { return nil }
        generations[id, default: 0] += 1
        workers[id]?.cancel()
        activeID = nil
        package.state = "paused"; package.error = error
        packages[id] = package
        var persistenceError: Error?
        do { try persistMetadata(package) } catch { persistenceError = error }
        changed()
        return persistenceError
    }

    private func pauseIfCurrent(_ id: String, _ generation: Int, error: String) {
        guard isCurrent(id, generation), var package = packages[id] else { return }
        package.state = "paused"; package.error = error
        packages[id] = package
        activeID = nil
        generations[id, default: 0] += 1
        try? persistMetadata(package)
        changed()
    }

    private func isCurrent(_ id: String, _ generation: Int) -> Bool {
        activeID == id && generations[id] == generation
    }

    private func stateObject(_ package: Package) -> [String: Any] {
        ["id": package.id, "done": package.done, "bytes": package.bytes, "total": package.urls.count,
         "state": package.state, "error": package.error as Any? ?? NSNull()]
    }

    private func loadPackages() {
        guard let files = try? FileManager.default.contentsOfDirectory(at: manifests, includingPropertiesForKeys: nil) else { return }
        for file in files where file.pathExtension == "meta" {
            guard let data = try? Data(contentsOf: file), let metadata = try? JSONDecoder().decode(Metadata.self, from: data),
                  let urls = try? readManifest(id: metadata.id, token: metadata.manifestToken) else { continue }
            var package = Package(id: metadata.id, name: metadata.name, urls: urls, done: metadata.done, bytes: metadata.bytes,
                                  state: metadata.state, error: metadata.error, manifestToken: metadata.manifestToken)
            if package.state == "downloading" { package.state = "paused"; package.error = "应用已重启，下载已暂停，可继续" }
            packages[package.id] = package
            lastID = package.id
            try? persistMetadata(package)
        }
        retryPendingDeletionCleanup()
    }

    private func retryPendingDeletionCleanup() {
        guard let files = try? FileManager.default.contentsOfDirectory(at: manifests, includingPropertiesForKeys: nil) else { return }
        var referenced = Set(packages.values.flatMap(\.urls))
        for file in files where file.lastPathComponent.contains(".deleting-") {
            guard let data = try? Data(contentsOf: file), let record = try? JSONDecoder().decode(DeletionRecord.self, from: data) else { continue }
            do {
                let manifest = manifestURL(record.metadata.id, record.metadata.manifestToken)
                if FileManager.default.fileExists(atPath: manifest.path) {
                    try atomicWrite(try JSONEncoder().encode(record.metadata), to: metadataURL(record.metadata.id))
                    packages[record.metadata.id] = Package(id: record.metadata.id, name: record.metadata.name,
                        urls: record.urls, done: record.metadata.done, bytes: record.metadata.bytes,
                        state: record.metadata.state, error: record.metadata.error, manifestToken: record.metadata.manifestToken)
                    referenced.formUnion(record.urls)
                    lastID = record.metadata.id
                    try FileManager.default.removeItem(at: file)
                    continue
                }
                try removeManifest(id: record.metadata.id, token: record.metadata.manifestToken)
                for raw in Set(record.urls) where !referenced.contains(raw) { try removeTileIfPresent(raw) }
                try FileManager.default.removeItem(at: file)
            } catch {
                // Keep the tombstone for a later retry; the package is already logically removed.
            }
        }
    }

    private func verifyFiles(_ urls: [String]) -> (done: Int, bytes: Int64) {
        var done = 0
        var bytes: Int64 = 0
        var seen = Set<String>()
        for raw in urls {
            let file = tileURL(raw)
            guard validTile(at: file), let values = try? file.resourceValues(forKeys: [.fileSizeKey]), let size = values.fileSize else { break }
            done += 1
            if seen.insert(raw).inserted { bytes += Int64(size) }
        }
        return (done, bytes)
    }

    private func persistMetadata(_ package: Package) throws {
        let metadata = Metadata(id: package.id, name: package.name, done: package.done, bytes: package.bytes,
                                state: package.state, error: package.error, manifestToken: package.manifestToken)
        try atomicWrite(try JSONEncoder().encode(metadata), to: metadataURL(package.id))
    }
    private func persistDraft(_ draft: Draft) throws { try atomicWrite(try JSONEncoder().encode(draft), to: draftURL(draft.id)) }
    private func loadDraft(_ id: String) throws -> Draft? {
        let file = draftURL(id)
        guard FileManager.default.fileExists(atPath: file.path) else { return nil }
        return try JSONDecoder().decode(Draft.self, from: Data(contentsOf: file))
    }
    private func removeDraft(_ id: String) throws {
        let file = draftURL(id)
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
    private func writeManifest(_ urls: [String], id: String, token: String) throws {
        try atomicWrite(try JSONEncoder().encode(urls), to: manifestURL(id, token))
    }
    private func readManifest(id: String, token: String) throws -> [String] {
        try JSONDecoder().decode([String].self, from: Data(contentsOf: manifestURL(id, token)))
    }
    private func removeManifest(id: String, token: String) throws {
        let file = manifestURL(id, token)
        if FileManager.default.fileExists(atPath: file.path) { try FileManager.default.removeItem(at: file) }
    }
    private func moveMetadataToTombstone(_ id: String) throws -> URL {
        let file = metadataURL(id)
        guard FileManager.default.fileExists(atPath: file.path) else { throw failure("缓存清单文件不存在") }
        let tombstone = manifests.appendingPathComponent(safeID(id) + ".deleting-\(UUID().uuidString)")
        try FileManager.default.moveItem(at: file, to: tombstone)
        return tombstone
    }
    private func metadataURL(_ id: String) -> URL { manifests.appendingPathComponent(safeID(id) + ".meta") }
    private func manifestURL(_ id: String, _ token: String) -> URL { manifests.appendingPathComponent(safeID(id) + "." + safeID(token) + ".urls") }
    private func draftURL(_ id: String) -> URL { draftsDirectory.appendingPathComponent(safeID(id) + ".draft") }
    private func atomicWrite(_ data: Data, to url: URL) throws { try data.write(to: url, options: .atomic) }
    private func tileURL(_ raw: String) -> URL { tiles.appendingPathComponent(Self.sha256(raw)) }
    private func safeID(_ value: String) -> String { Self.sha256(value) }
    private func availableBytes() -> Int64 {
        let attrs = try? FileManager.default.attributesOfFileSystem(forPath: root.path)
        return (attrs?[.systemFreeSize] as? NSNumber)?.int64Value ?? 0
    }
    private func inventoryTileBytes() -> Int64 {
        guard let files = try? FileManager.default.contentsOfDirectory(at: tiles, includingPropertiesForKeys: [.fileSizeKey]) else { return 0 }
        return files.reduce(Int64(0)) { total, file in total + Int64((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0) }
    }
    private func ensureBudget() throws {
        guard diskBytes <= maxBudget, availableBytes() >= 1_048_576 else { throw failure("磁盘剩余空间不足，缓存任务已暂停") }
    }
    private func replaceTile(_ source: URL, destination: URL) throws {
        guard FileManager.default.fileExists(atPath: destination.path) else {
            try FileManager.default.moveItem(at: source, to: destination)
            return
        }
        let backup = destination.deletingLastPathComponent().appendingPathComponent(".replace-\(UUID().uuidString)")
        try FileManager.default.moveItem(at: destination, to: backup)
        do {
            try FileManager.default.moveItem(at: source, to: destination)
            try FileManager.default.removeItem(at: backup)
        } catch {
            if !FileManager.default.fileExists(atPath: destination.path) {
                try? FileManager.default.moveItem(at: backup, to: destination)
            }
            throw error
        }
    }
    private func removeTileIfPresent(_ raw: String) throws {
        let file = tileURL(raw)
        if FileManager.default.fileExists(atPath: file.path) {
            let size = Int64((try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0)
            try FileManager.default.removeItem(at: file)
            diskBytes = max(0, diskBytes - size)
        }
    }
    private func validTile(at url: URL) -> Bool { Self.validTileFile(at: url) }
    private func string(_ args: [String: Any], _ key: String) throws -> String {
        guard let value = args[key] as? String, !value.isEmpty else { throw failure("参数无效") }
        return value
    }
    private func integer(_ args: [String: Any], _ key: String) throws -> Int {
        guard let number = args[key] as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else { throw failure("参数无效") }
        let value = number.doubleValue
        guard value.isFinite, value.rounded(.towardZero) == value, value >= Double(Int.min), value < Double(Int.max) else { throw failure("参数无效") }
        return Int(value)
    }
    private func validatePublicURL(_ raw: String) throws { try Self.validateURL(raw) }
    private func failureMessage(for result: Result<FetchedTile, Error>) -> String {
        guard case .failure(let error) = result else { return "下载已暂停，可继续" }
        if let issue = error as? FetchIssue {
            switch issue {
            case .rateLimited: return "图源请求过于频繁，服务要求稍后重试；下载已暂停"
            case .tooLarge: return "图源瓦片超过8MiB上限，下载已暂停"
            case .invalidImage: return "图源内容不是有效地图瓦片，下载已暂停"
            case .invalidResponse: return "图源请求失败，下载已暂停，可继续"
            }
        }
        return "瓦片下载失败，任务已暂停，可继续"
    }
    private func failure(_ message: String) -> NSError { Self.makeError(message) }

    fileprivate nonisolated static func validateURL(_ raw: String) throws {
        guard raw.utf8.count <= 16_384, let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let rawHost = url.host?.lowercased(), !rawHost.isEmpty,
              url.user == nil, url.password == nil else { throw makeError("仅允许有效的公网 HTTP(S) 图源地址") }
        let host = rawHost.trimmingCharacters(in: CharacterSet(charactersIn: "[]")).trimmingCharacters(in: CharacterSet(charactersIn: "."))
        guard !host.isEmpty, host != "localhost", !host.hasSuffix(".localhost"), !host.hasSuffix(".local") else { throw makeError("拒绝访问本地或私有网络") }
        guard PublicHostResolver.shared.isPublic(host) else { throw makeError("拒绝访问本地或私有网络") }
    }
    fileprivate nonisolated static func validateTileKey(_ raw: String) throws {
        guard raw.utf8.count <= 16_384, let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https",
              let host = url.host, !host.isEmpty, url.user == nil, url.password == nil else {
            throw makeError("缓存瓦片地址无效")
        }
    }
    fileprivate nonisolated static func validateRedirect(_ url: URL) throws { try validateURL(url.absoluteString) }
    fileprivate nonisolated static func retryDecision(_ response: HTTPURLResponse, attempt: Int, now: Date = Date()) -> RetryDecision {
        if attempt >= 3 { return .pause }
        if let header = response.value(forHTTPHeaderField: "Retry-After") {
            let seconds: Int?
            let cleanHeader = header.trimmingCharacters(in: .whitespacesAndNewlines)
            if cleanHeader.allSatisfy(\.isNumber) {
                if let integer = Int64(cleanHeader), integer <= Int64(Int.max) { seconds = max(0, Int(integer)) }
                else { return .pause }
            }
            else if let date = HTTPDate.date(from: header) { seconds = max(0, Int(date.timeIntervalSince(now).rounded(.up))) }
            else { seconds = nil }
            if let seconds { return seconds <= 60 ? .wait(seconds) : .pause }
        }
        return .wait(min(30, 1 << min(attempt, 5)))
    }
    fileprivate nonisolated static func isPrivateIPv6(_ bytes: [UInt8]) -> Bool {
        guard bytes.count == 16 else { return true }
        if bytes.allSatisfy({ $0 == 0 }) { return true }
        if bytes[0..<15].allSatisfy({ $0 == 0 }) && bytes[15] == 1 { return true }
        if bytes[0] & 0xfe == 0xfc || bytes[0] == 0xff || (bytes[0] == 0xfe && bytes[1] & 0xc0 == 0x80) { return true }
        if bytes[0..<4].elementsEqual([0x20,0x01,0x0d,0xb8]) { return true }
        if bytes[0..<12].allSatisfy({ $0 == 0 }) { return IPv4Address(Array(bytes[12..<16]))?.isPublic == false }
        if bytes[0..<10].allSatisfy({ $0 == 0 }) && bytes[10] == 0xff && bytes[11] == 0xff {
            return IPv4Address(Array(bytes[12..<16]))?.isPublic == false
        }
        return false
    }
    fileprivate nonisolated static func validImage(_ data: Data, mime: String?) -> Bool {
        let bytes = [UInt8](data.prefix(12))
        let mimeType = mime?.split(separator: ";", maxSplits: 1).first?.trimmingCharacters(in: .whitespaces).lowercased()
        guard mimeType?.hasPrefix("image/") == true else { return false }
        let pngSignature: [UInt8] = [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a]
        if data.starts(with: pngSignature) {
            guard data.count >= 24, data[12..<16].elementsEqual([0x49,0x48,0x44,0x52]), mimeType == "image/png" else { return false }
            let width = data[16..<20].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
            let height = data[20..<24].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
            return width > 0 && height > 0
        }
        if bytes.starts(with: [0xff,0xd8,0xff]) { return data.count >= 4 && data.suffix(2).elementsEqual([0xff,0xd9]) && mimeType == "image/jpeg" }
        if bytes.count >= 12, bytes[0...3].elementsEqual([0x52,0x49,0x46,0x46]), bytes[8...11].elementsEqual([0x57,0x45,0x42,0x50]) {
            return data.count >= 20 && mimeType == "image/webp"
        }
        if bytes.starts(with: [0x47,0x49,0x46,0x38]) {
            let gif = data.starts(with: Array("GIF87a".utf8)) || data.starts(with: Array("GIF89a".utf8))
            return gif && data.count >= 14 && data.last == 0x3b && mimeType == "image/gif"
        }
        return false
    }
    fileprivate nonisolated static func validTileFile(at url: URL) -> Bool {
        guard let attrs = try? url.resourceValues(forKeys: [.fileSizeKey]), let size = attrs.fileSize,
              size > 0, size <= 8 * 1024 * 1024, let data = try? Data(contentsOf: url, options: .mappedIfSafe) else { return false }
        return validImage(data, mime: mimeType(data))
    }
    fileprivate nonisolated static func mimeType(_ data: Data) -> String {
        let b = [UInt8](data.prefix(12))
        if b.starts(with: [0x89,0x50,0x4e,0x47]) { return "image/png" }
        if b.starts(with: [0xff,0xd8]) { return "image/jpeg" }
        if b.count >= 12, b[0...3].elementsEqual([0x52,0x49,0x46,0x46]), b[8...11].elementsEqual([0x57,0x45,0x42,0x50]) { return "image/webp" }
        if b.starts(with: [0x47,0x49,0x46,0x38]) { return "image/gif" }
        return "application/octet-stream"
    }
    fileprivate nonisolated static func sha256(_ value: String) -> String {
        SHA256.hash(data: Data(value.utf8)).map { String(format: "%02x", $0) }.joined()
    }
    fileprivate nonisolated static func exceedsTileLimit(written: Int64, expected: Int64, maximum: Int64 = 8 * 1024 * 1024) -> Bool {
        written > maximum || expected > maximum
    }
    private nonisolated static func makeError(_ message: String) -> NSError { NSError(domain: "ShantuOffline", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
}

private struct IPv4Address {
    let octets: [UInt8]
    init?(_ host: String) {
        let parts = host.split(separator: ".")
        guard parts.count == 4 else { return nil }
        var parsed: [UInt8] = []
        for part in parts { guard let value = UInt8(part) else { return nil }; parsed.append(value) }
        octets = parsed
    }
    init?(_ bytes: [UInt8]) { guard bytes.count == 4 else { return nil }; octets = bytes }
    var isPublic: Bool {
        let a = octets[0], b = octets[1]
        return !(a == 0 || a == 10 || a == 127 || (a == 100 && (64...127).contains(b)) ||
                 (a == 169 && b == 254) || (a == 172 && (16...31).contains(b)) ||
                 (a == 192 && (b == 0 || b == 168 || (b == 88 && octets[2] == 99))) ||
                 (a == 198 && (b == 18 || b == 19 || (b == 51 && octets[2] == 100))) ||
                 (a == 203 && b == 0 && octets[2] == 113) || a >= 224)
    }
}

private final class PublicHostResolver: @unchecked Sendable {
    static let shared = PublicHostResolver()
    private let lock = NSLock()
    private var cache: [String: (expires: Date, allowed: Bool)] = [:]
    private var order: [String] = []

    func isPublic(_ host: String) -> Bool {
        lock.lock()
        let saved = cache[host]
        lock.unlock()
        if let saved, saved.expires > Date() { return saved.allowed }
        let result = resolve(host)
        lock.lock()
        if !cache.keys.contains(host) { order.append(host) }
        cache[host] = (Date().addingTimeInterval(30), result)
        if order.count > 256 { cache.removeValue(forKey: order.removeFirst()) }
        lock.unlock()
        return result
    }

    private func resolve(_ host: String) -> Bool {
        if let ipv4 = IPv4Address(host) { return ipv4.isPublic }
        var hints = addrinfo(ai_flags: AI_ADDRCONFIG, ai_family: AF_UNSPEC, ai_socktype: SOCK_STREAM,
                             ai_protocol: 0, ai_addrlen: 0, ai_canonname: nil, ai_addr: nil, ai_next: nil)
        var result: UnsafeMutablePointer<addrinfo>?
        let lookupStatus = host.withCString { getaddrinfo($0, nil, &hints, &result) }
        guard lookupStatus == 0, let first = result else { return false }
        defer { freeaddrinfo(first) }
        var current: UnsafeMutablePointer<addrinfo>? = first
        var found = false
        while let item = current {
            let info = item.pointee
            if info.ai_family == AF_INET, let address = info.ai_addr?.withMemoryRebound(to: sockaddr_in.self, capacity: 1, { $0.pointee.sin_addr }) {
                let bytes = withUnsafeBytes(of: address.s_addr) { Array($0.prefix(4)) }
                found = true
                if IPv4Address(bytes)?.isPublic != true { return false }
            } else if info.ai_family == AF_INET6, let address = info.ai_addr?.withMemoryRebound(to: sockaddr_in6.self, capacity: 1, { $0.pointee.sin6_addr }) {
                var address = address
                let bytes = withUnsafeBytes(of: &address) { Array($0.prefix(16)) }
                found = true
                if NativeOfflineService.isPrivateIPv6(bytes) { return false }
            }
            current = info.ai_next
        }
        return found
    }
}

private enum HTTPDate {
    static func date(from value: String) -> Date? {
        let formatter = DateFormatter(); formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0); formatter.dateFormat = "EEE',' dd MMM yyyy HH':'mm':'ss z"
        return formatter.date(from: value)
    }
}

private final class BoundedPublicDownloadDelegate: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private let maximumBytes: Int
    private var didExceed = false
    var exceededLimit: Bool { lock.lock(); defer { lock.unlock() }; return didExceed }

    init(maximumBytes: Int) { self.maximumBytes = maximumBytes }

    // `URLSession.download(for:delegate:)` returns ownership of the temporary file to
    // the async caller. Leave the callback URL untouched so the caller can validate
    // and then install or remove the returned file.
    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {}

    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        guard let url = request.url else { completionHandler(nil); return }
        do { try NativeOfflineService.validateRedirect(url); completionHandler(request) }
        catch { completionHandler(nil) }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64,
                    totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        enforceLimit(downloadTask, count: totalBytesWritten, expected: totalBytesExpectedToWrite)
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didResumeAtOffset fileOffset: Int64,
                    expectedTotalBytes: Int64) {
        enforceLimit(downloadTask, count: fileOffset, expected: expectedTotalBytes)
    }

    private func enforceLimit(_ task: URLSessionDownloadTask, count: Int64, expected: Int64) {
        guard NativeOfflineService.exceedsTileLimit(written: count, expected: expected, maximum: Int64(maximumBytes)) else { return }
        lock.lock(); didExceed = true; lock.unlock()
        task.cancel()
    }
}
