import CoreLocation
import Foundation

/// macOS location and outdoor-recording bridge. The owner must call `shutdown`
/// before releasing the service; persisted active recordings are reopened paused.
@MainActor
final class NativeLocationService: NSObject, CLLocationManagerDelegate {
    private struct Fix {
        var longitude: Double
        var latitude: Double
        var time: Double
        var accuracy: Double
        var altitude: Double?

        var json: [String: Any] {
            ["coordinates": [longitude, latitude], "time": time,
             "accuracy": accuracy, "altitude": altitude.map { $0 as Any } ?? NSNull()]
        }
    }

    private struct Record {
        var id = ""
        var phase = "idle"
        var startedAt = 0.0
        var segments: [[Fix]] = []
        var error = ""

        var pointCount: Int { segments.reduce(0) { $0 + $1.count } }
        var json: [String: Any] {
            ["id": id, "phase": phase, "startedAt": startedAt,
             "segments": segments.map { $0.map(\.json) }, "error": error]
        }
    }

    private struct Sampling {
        var mode = "standard"
        var intervalSeconds = 4.0
        var distanceMetres = 5.0
        var stationarySeconds = 30.0
        var adaptive = false
        var distanceOnly = false
        var recordOnNavigation = false

        var json: [String: Any] {
            ["mode": mode, "intervalSeconds": intervalSeconds,
             "distanceMetres": distanceMetres, "stationarySeconds": stationarySeconds,
             "adaptive": adaptive, "distanceOnly": distanceOnly,
             "recordOnNavigation": recordOnNavigation]
        }
    }

    private enum ServiceError: LocalizedError {
        case invalidAction(String)
        case invalidArgument(String)
        case permission(String)
        case corruptArchive
        case storage(String)

        var errorDescription: String? {
            switch self {
            case .invalidAction(let action): return "不支持的原生定位操作：\(action)"
            case .invalidArgument(let message): return message
            case .permission(let message): return message
            case .corruptArchive: return "记录存档损坏，请先导出备份；原文件已保留"
            case .storage(let message): return "记录保存失败：\(message)"
            }
        }
    }

    private let manager = CLLocationManager()
    private let archiveURL: URL
    private let changed: () -> Void
    private var locationSubscribed = false
    private var requestedLocationMode = "auto"
    private var record = Record()
    private var sampling = Sampling()
    private var maximumAccuracy = 5.0
    private var latestLocation: CLLocation?
    private var locationError = ""
    private var archiveCorrupt = false
    private var needsNewSegment = false
    private var lastAcceptedAt: Double?
    private enum PendingRecordAuthorization: Equatable { case start, resume }
    private var pendingRecordAuthorization: PendingRecordAuthorization?

    init(storageRoot: URL, changed: @escaping () -> Void) {
        self.archiveURL = storageRoot
            .appendingPathComponent("OutdoorRecording", isDirectory: true)
            .appendingPathComponent("recording.json", isDirectory: false)
        self.changed = changed
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        manager.distanceFilter = 5
        loadArchive()
    }

    var hasActiveRecording: Bool { record.phase == "recording" }

    var locationSnapshot: [String: Any] {
        let authorization = Self.authorizationName(manager.authorizationStatus)
        var result: [String: Any] = [
            "active": locationSubscribed,
            "available": CLLocationManager.locationServicesEnabled(),
            "authorization": authorization,
            "source": "network",
            "mode": requestedLocationMode,
            "error": locationError,
        ]
        if let location = latestLocation, Self.isFreshAndValid(location, now: Date()) {
            result["fix"] = Self.fixJSON(location)
        } else {
            result["fix"] = NSNull()
        }
        return result
    }

    var recordingSnapshot: [String: Any] {
        var snapshot = record.json
        snapshot["archiveCorrupt"] = archiveCorrupt
        snapshot["maximumAccuracy"] = maximumAccuracy
        snapshot["sampling"] = sampling.json
        return snapshot
    }

    private var archiveJSON: [String: Any] {
        var value = record.json
        value["maximumAccuracy"] = maximumAccuracy
        value["sampling"] = sampling.json
        return value
    }

    func handle(_ action: String, _ args: [String: Any]) throws -> Any {
        switch action {
        case "location.start":
            let mode = args["mode"] as? String ?? "auto"
            guard mode == "auto" || mode == "network" else {
                throw ServiceError.invalidArgument("Mac 原生定位只支持自动或网络定位模式")
            }
            requestedLocationMode = mode
            locationSubscribed = true
            locationError = ""
            do { try ensureAuthorizationAndUpdates() }
            catch { changed(); throw error }
            changed()
            return locationSnapshot
        case "location.stop":
            locationSubscribed = false
            stopUpdatesIfUnused()
            changed()
            return locationSnapshot
        case "location.state":
            return locationSnapshot
        case "record.command":
            guard let command = args["command"] as? String else {
                throw ServiceError.invalidArgument("缺少记录操作命令")
            }
            do { try commandRecording(command, args: args) }
            catch {
                if (command == "start" || command == "resume") && hasActiveRecording {
                    record.phase = "paused"
                    record.error = (error as? LocalizedError)?.errorDescription ?? "记录无法继续"
                    pendingRecordAuthorization = nil
                    needsNewSegment = true
                    persistArchive()
                    stopUpdatesIfUnused()
                }
                changed()
                throw error
            }
            changed()
            return recordingSnapshot
        case "record.configure":
            try configure(args)
            changed()
            return recordingSnapshot
        case "record.state":
            return recordingSnapshot
        default:
            throw ServiceError.invalidAction(action)
        }
    }

    /// Stops native callbacks while keeping the last recording durable.
    func shutdown() {
        manager.stopUpdatingLocation()
        locationSubscribed = false
        pendingRecordAuthorization = nil
        if record.phase == "recording" {
            record.phase = "paused"
            record.error = "应用已关闭，记录已暂停并保存"
            persistArchive()
        }
        manager.delegate = nil
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            locationError = ""
            if locationSubscribed || hasActiveRecording || pendingRecordAuthorization != nil {
                manager.startUpdatingLocation()
            }
            continuePendingRecordAfterAuthorization()
        case .denied:
            failForPermission("macOS 已拒绝山兔定位权限；请在系统设置中允许定位后重新启动")
        case .restricted:
            failForPermission("此 Mac 的系统策略限制定位权限")
        case .notDetermined:
            break
        @unknown default:
            locationError = "无法识别 macOS 定位授权状态"
        }
        changed()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last else { return }
        guard Self.isFreshAndValid(location, now: Date()) else { return }
        latestLocation = location
        locationError = ""
        if hasActiveRecording { append(location) }
        changed()
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let clError = error as? CLError
        if clError?.code == .denied {
            failForPermission("macOS 已拒绝山兔定位权限；请在系统设置中允许定位后重新启动")
        } else {
            locationError = "系统定位暂不可用：\(error.localizedDescription)"
            if hasActiveRecording { record.error = locationError; persistArchive() }
        }
        changed()
    }

    private func ensureAuthorizationAndUpdates() throws {
        guard CLLocationManager.locationServicesEnabled() else {
            locationSubscribed = false
            latestLocation = nil
            manager.stopUpdatingLocation()
            locationError = "此 Mac 已关闭系统定位服务"
            throw ServiceError.permission(locationError)
        }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            manager.startUpdatingLocation()
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied:
            locationSubscribed = false
            latestLocation = nil
            manager.stopUpdatingLocation()
            locationError = "macOS 已拒绝山兔定位权限；请在系统设置中允许定位后重试"
            throw ServiceError.permission(locationError)
        case .restricted:
            locationSubscribed = false
            latestLocation = nil
            manager.stopUpdatingLocation()
            locationError = "此 Mac 的系统策略限制定位权限"
            throw ServiceError.permission(locationError)
        @unknown default:
            locationError = "无法识别 macOS 定位授权状态"
            throw ServiceError.permission(locationError)
        }
    }

    @discardableResult
    private func ensureUpdatesForRecording() throws -> Bool {
        guard CLLocationManager.locationServicesEnabled() else {
            let message = "此 Mac 已关闭系统定位服务，记录未开始"
            locationSubscribed = false
            latestLocation = nil
            manager.stopUpdatingLocation()
            record.error = message
            record.phase = "paused"
            pendingRecordAuthorization = nil
            throw ServiceError.permission(message)
        }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            record.error = ""
            manager.startUpdatingLocation()
            return true
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
            record.phase = "paused"
            record.error = "正在等待 macOS 定位授权；授权后会继续本次操作"
            return false
        case .denied:
            let message = "macOS 已拒绝山兔定位权限，记录未开始；请在系统设置中允许定位后重试"
            locationSubscribed = false
            latestLocation = nil
            manager.stopUpdatingLocation()
            record.error = message
            record.phase = "paused"
            pendingRecordAuthorization = nil
            throw ServiceError.permission(message)
        case .restricted:
            let message = "此 Mac 的系统策略限制定位权限，记录未开始"
            locationSubscribed = false
            latestLocation = nil
            manager.stopUpdatingLocation()
            record.error = message
            record.phase = "paused"
            pendingRecordAuthorization = nil
            throw ServiceError.permission(message)
        @unknown default:
            let message = "无法识别 macOS 定位授权状态，记录未开始"
            record.error = message
            record.phase = "paused"
            pendingRecordAuthorization = nil
            throw ServiceError.permission(message)
        }
    }

    private func commandRecording(_ command: String, args: [String: Any]) throws {
        try updateConfiguration(args)

        switch command {
        case "start":
            guard !archiveCorrupt else { throw ServiceError.corruptArchive }
            guard record.phase != "recording" else { return }
            if record.phase == "paused" && !record.id.isEmpty {
                guard try ensureUpdatesForRecording() else {
                    pendingRecordAuthorization = .resume
                    return
                }
                record.phase = "recording"
                record.error = ""
                needsNewSegment = !record.segments.isEmpty
                lastAcceptedAt = record.segments.last?.last?.time
            } else {
                guard try ensureUpdatesForRecording() else {
                    pendingRecordAuthorization = .start
                    return
                }
                record = Record(id: UUID().uuidString, phase: "recording",
                                startedAt: Self.nowMilliseconds(), segments: [], error: "")
                needsNewSegment = false
                lastAcceptedAt = nil
            }
            archiveCorrupt = false
            do { try writeArchive() }
            catch {
                record.phase = "paused"
                record.error = (error as? LocalizedError)?.errorDescription ?? "记录保存失败"
                stopUpdatesIfUnused()
                throw error
            }
        case "pause":
            if pendingRecordAuthorization != nil {
                pendingRecordAuthorization = nil
                record.phase = "paused"
                record.error = ""
                try writeArchive()
                return
            }
            guard record.phase == "recording" else { return }
            record.phase = "paused"
            record.error = ""
            needsNewSegment = true
            try writeArchive()
            stopUpdatesIfUnused()
        case "resume":
            guard record.phase == "paused", !record.id.isEmpty else { return }
            guard !archiveCorrupt else { throw ServiceError.corruptArchive }
            guard try ensureUpdatesForRecording() else {
                pendingRecordAuthorization = .resume
                return
            }
            record.phase = "recording"
            record.error = ""
            needsNewSegment = !record.segments.isEmpty
            lastAcceptedAt = record.segments.last?.last?.time
            do { try writeArchive() }
            catch {
                record.phase = "paused"
                record.error = (error as? LocalizedError)?.errorDescription ?? "记录保存失败"
                stopUpdatesIfUnused()
                throw error
            }
        case "finish":
            pendingRecordAuthorization = nil
            guard !archiveCorrupt else { throw ServiceError.corruptArchive }
            if !record.id.isEmpty {
                record.phase = "finished"
                record.error = ""
                try writeArchive()
            }
            stopUpdatesIfUnused()
        case "clear":
            pendingRecordAuthorization = nil
            record = Record()
            archiveCorrupt = false
            needsNewSegment = false
            lastAcceptedAt = nil
            try writeArchive()
            stopUpdatesIfUnused()
        default:
            throw ServiceError.invalidArgument("不支持的记录操作：\(command)")
        }
    }

    private func configure(_ args: [String: Any]) throws {
        try updateConfiguration(args, requireAny: true)
    }

    private func updateConfiguration(_ args: [String: Any], requireAny: Bool = false) throws {
        guard !archiveCorrupt else { throw ServiceError.corruptArchive }
        guard !requireAny || args["maximumAccuracy"] != nil || args["sampling"] != nil else {
            throw ServiceError.invalidArgument("请提供记录误差或采样参数")
        }
        let newAccuracy: Double
        if let rawAccuracy = args["maximumAccuracy"] {
            guard let accuracy = Self.number(rawAccuracy), accuracy >= 5,
                  accuracy <= 80, accuracy.rounded() == accuracy else {
                throw ServiceError.invalidArgument("记录最大误差必须是 5 至 80 米的整数")
            }
            newAccuracy = accuracy
        } else {
            newAccuracy = maximumAccuracy
        }
        let newSampling: Sampling
        if let rawSampling = args["sampling"] {
            guard let supplied = rawSampling as? [String: Any] else {
                throw ServiceError.invalidArgument("记录采样参数无效")
            }
            newSampling = try Self.parseSampling(supplied)
        } else {
            newSampling = sampling
        }
        let oldAccuracy = maximumAccuracy
        let oldSampling = sampling
        maximumAccuracy = newAccuracy
        sampling = newSampling
        if args["maximumAccuracy"] != nil || args["sampling"] != nil {
            do { try writeArchive() }
            catch {
                maximumAccuracy = oldAccuracy
                sampling = oldSampling
                throw error
            }
        }
    }

    private func append(_ location: CLLocation) {
        let now = Self.nowMilliseconds()
        let timestamp = location.timestamp.timeIntervalSince1970 * 1000
        let accuracy = location.horizontalAccuracy
        guard record.phase == "recording",
              timestamp.isFinite, now - timestamp <= 20_000, timestamp <= now + 5_000,
              accuracy >= 0, accuracy <= min(80, maximumAccuracy),
              location.coordinate.latitude.isFinite,
              location.coordinate.longitude.isFinite,
              abs(location.coordinate.latitude) <= 85,
              abs(location.coordinate.longitude) <= 180 else { return }

        guard record.pointCount < 6000 else {
            record.phase = "paused"
            record.error = "已达 6000 点，请结束保存后开始新记录"
            needsNewSegment = true
            persistArchive()
            stopUpdatesIfUnused()
            return
        }

        let altitude = location.verticalAccuracy.isFinite && location.verticalAccuracy >= 0 &&
            location.altitude.isFinite ? location.altitude : nil
        let fix = Fix(longitude: location.coordinate.longitude,
                      latitude: location.coordinate.latitude,
                      time: timestamp,
                      accuracy: accuracy,
                      altitude: altitude)
        if let previous = record.segments.last?.last {
            let elapsed = (fix.time - previous.time) / 1000
            let distance = Self.distanceMetres(previous.longitude, previous.latitude,
                                               fix.longitude, fix.latitude)
            guard elapsed > 0, distance / elapsed <= 80 else { return }
            guard Self.acceptsSample(distance: distance, seconds: elapsed,
                                     interval: sampling.intervalSeconds,
                                     minimumDistance: sampling.distanceMetres,
                                     stationarySeconds: sampling.stationarySeconds,
                                     distanceOnly: sampling.distanceOnly) else { return }
            if elapsed > 120 { needsNewSegment = true }
        } else if let previousTime = lastAcceptedAt, fix.time <= previousTime {
            return
        }

        if needsNewSegment || record.segments.isEmpty {
            guard record.segments.count < 100 else {
                record.phase = "paused"
                record.error = "记录分段已达上限，请结束保存"
                persistArchive()
                stopUpdatesIfUnused()
                return
            }
            record.segments.append([fix])
            needsNewSegment = false
        } else {
            record.segments[record.segments.count - 1].append(fix)
        }
        lastAcceptedAt = fix.time
        record.error = ""
        persistArchive()
    }

    private func failForPermission(_ message: String) {
        locationError = message
        locationSubscribed = false
        latestLocation = nil
        pendingRecordAuthorization = nil
        if hasActiveRecording {
            record.phase = "paused"
            record.error = message
            needsNewSegment = true
            persistArchive()
        }
        manager.stopUpdatingLocation()
    }

    private func continuePendingRecordAfterAuthorization() {
        guard let pending = pendingRecordAuthorization else { return }
        pendingRecordAuthorization = nil
        switch pending {
        case .start:
            guard record.phase == "paused", record.id.isEmpty else { return }
            record = Record(id: UUID().uuidString, phase: "recording",
                            startedAt: Self.nowMilliseconds(), segments: [], error: "")
            needsNewSegment = false
            lastAcceptedAt = nil
        case .resume:
            guard record.phase == "paused", !record.id.isEmpty else { return }
            record.phase = "recording"
            record.error = ""
            needsNewSegment = !record.segments.isEmpty
            lastAcceptedAt = record.segments.last?.last?.time
        }
        do { try writeArchive() }
        catch {
            record.phase = "paused"
            record.error = (error as? LocalizedError)?.errorDescription ?? "记录保存失败"
            stopUpdatesIfUnused()
        }
    }

    private func stopUpdatesIfUnused() {
        if !locationSubscribed && !hasActiveRecording { manager.stopUpdatingLocation() }
    }

    private func loadArchive() {
        guard FileManager.default.fileExists(atPath: archiveURL.path) else { return }
        do {
            let data = try Data(contentsOf: archiveURL)
            guard let object = try JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let id = object["id"] as? String,
                  let phase = object["phase"] as? String,
                  ["idle", "recording", "paused", "finished"].contains(phase),
                  let startedAt = object["startedAt"] as? NSNumber,
                  let savedError = object["error"] as? String,
                  let rawSegments = object["segments"] as? [[[String: Any]]],
                  rawSegments.count <= 100 else { throw ServiceError.corruptArchive }
            var loadedAccuracy = maximumAccuracy
            var loadedSampling = sampling
            if let rawAccuracy = object["maximumAccuracy"] {
                guard let value = Self.number(rawAccuracy), value >= 5,
                      value <= 80, value.rounded() == value else {
                    throw ServiceError.corruptArchive
                }
                loadedAccuracy = value
            }
            if let rawSampling = object["sampling"] {
                guard let value = rawSampling as? [String: Any] else {
                    throw ServiceError.corruptArchive
                }
                loadedSampling = try Self.parseSampling(value)
            }
            var segments: [[Fix]] = []
            for rawSegment in rawSegments {
                var segment: [Fix] = []
                for rawFix in rawSegment {
                    guard let coordinates = rawFix["coordinates"] as? [NSNumber], coordinates.count >= 2,
                          let time = rawFix["time"] as? NSNumber,
                          let accuracy = rawFix["accuracy"] as? NSNumber,
                          coordinates[0].doubleValue.isFinite, coordinates[1].doubleValue.isFinite,
                          abs(coordinates[0].doubleValue) <= 180, abs(coordinates[1].doubleValue) <= 85,
                          time.doubleValue.isFinite, accuracy.doubleValue.isFinite,
                          accuracy.doubleValue >= 0, accuracy.doubleValue <= 80 else {
                        throw ServiceError.corruptArchive
                    }
                    let altitudeNumber = rawFix["altitude"] as? NSNumber
                    let altitude = altitudeNumber?.doubleValue
                    if let altitude, !altitude.isFinite { throw ServiceError.corruptArchive }
                    segment.append(Fix(longitude: coordinates[0].doubleValue,
                                       latitude: coordinates[1].doubleValue,
                                       time: time.doubleValue,
                                       accuracy: accuracy.doubleValue,
                                       altitude: altitude))
                }
                segments.append(segment)
            }
            guard segments.reduce(0, { $0 + $1.count }) <= 6000 else {
                throw ServiceError.corruptArchive
            }
            maximumAccuracy = loadedAccuracy
            sampling = loadedSampling
            let loadedPhase = phase == "recording" ? "paused" : phase
            record = Record(id: id, phase: loadedPhase,
                            startedAt: startedAt.doubleValue,
                            segments: segments,
                            error: phase == "recording" ? "应用重新启动，记录已暂停并保存" : savedError)
            lastAcceptedAt = segments.last?.last?.time
            needsNewSegment = phase == "recording" || phase == "paused"
            if phase == "recording" { persistArchive() }
        } catch {
            archiveCorrupt = true
            record.error = (error as? LocalizedError)?.errorDescription ?? "记录存档损坏，请先导出备份；原文件已保留"
        }
    }

    private func writeArchive() throws {
        guard !archiveCorrupt else { throw ServiceError.corruptArchive }
        do {
            try FileManager.default.createDirectory(at: archiveURL.deletingLastPathComponent(),
                                                    withIntermediateDirectories: true)
            let data = try JSONSerialization.data(withJSONObject: archiveJSON,
                                                  options: [.sortedKeys, .fragmentsAllowed])
            try data.write(to: archiveURL, options: .atomic)
        } catch {
            record.error = "记录保存失败：\(error.localizedDescription)"
            throw ServiceError.storage(error.localizedDescription)
        }
    }

    private func persistArchive() {
        do { try writeArchive() }
        catch { record.error = (error as? LocalizedError)?.errorDescription ?? "记录保存失败" }
    }

    private static func parseSampling(_ value: [String: Any]) throws -> Sampling {
        guard let mode = value["mode"] as? String,
              ["power", "standard", "accuracy", "custom"].contains(mode),
              let interval = number(value["intervalSeconds"]),
              let distance = number(value["distanceMetres"]),
              let stationary = number(value["stationarySeconds"]),
              let adaptive = value["adaptive"] as? Bool,
              let distanceOnly = value["distanceOnly"] as? Bool,
              let recordOnNavigation = value["recordOnNavigation"] as? Bool,
              interval >= 1, interval <= 30, interval.rounded() == interval,
              distance >= 1, distance <= 100, distance.rounded() == distance,
              stationary >= 10, stationary <= 90, stationary.rounded() == stationary,
              stationary >= interval else {
            throw ServiceError.invalidArgument("记录采样参数无效")
        }
        return Sampling(mode: mode, intervalSeconds: interval, distanceMetres: distance,
                        stationarySeconds: stationary, adaptive: adaptive,
                        distanceOnly: distanceOnly, recordOnNavigation: recordOnNavigation)
    }

    private static func number(_ value: Any?) -> Double? {
        guard let number = value as? NSNumber else { return nil }
        let result = number.doubleValue
        return result.isFinite ? result : nil
    }

    private static func fixJSON(_ location: CLLocation) -> [String: Any] {
        ["longitude": location.coordinate.longitude,
         "latitude": location.coordinate.latitude,
         "timestamp": location.timestamp.timeIntervalSince1970 * 1000,
         "accuracy": max(0, location.horizontalAccuracy),
         "altitude": location.verticalAccuracy.isFinite && location.verticalAccuracy >= 0 &&
            location.altitude.isFinite ? location.altitude as Any : NSNull(),
         "source": "network"]
    }

    private static func isFreshAndValid(_ location: CLLocation, now: Date) -> Bool {
        let age = now.timeIntervalSince(location.timestamp)
        let coordinate = location.coordinate
        return age.isFinite && age <= 30 && age >= -5 &&
            coordinate.latitude.isFinite && coordinate.longitude.isFinite &&
            abs(coordinate.latitude) <= 85 && abs(coordinate.longitude) <= 180 &&
            location.horizontalAccuracy.isFinite && location.horizontalAccuracy >= 0
    }

    private static func authorizationName(_ status: CLAuthorizationStatus) -> String {
        switch status {
        case .notDetermined: return "not-determined"
        case .restricted: return "restricted"
        case .denied: return "denied"
        case .authorizedAlways, .authorizedWhenInUse: return "authorized"
        @unknown default: return "unknown"
        }
    }

    private static func nowMilliseconds() -> Double { Date().timeIntervalSince1970 * 1000 }

    private static func distanceMetres(_ lon1: Double, _ lat1: Double,
                                       _ lon2: Double, _ lat2: Double) -> Double {
        let radians = Double.pi / 180
        let dLat = (lat2 - lat1) * radians
        let dLon = (lon2 - lon1) * radians
        let a = pow(sin(dLat / 2), 2) + cos(lat1 * radians) * cos(lat2 * radians) * pow(sin(dLon / 2), 2)
        return 6_371_000 * 2 * asin(sqrt(min(1, a)))
    }

    nonisolated static func acceptsSample(distance: Double, seconds: Double,
                                          interval: Double, minimumDistance: Double,
                                          stationarySeconds: Double, distanceOnly: Bool) -> Bool {
        guard seconds >= interval else { return false }
        return distance >= minimumDistance || (!distanceOnly && seconds >= stationarySeconds)
    }
}
