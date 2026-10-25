import Foundation
import CoreLocation

@main
@MainActor
struct NativeLocationServiceSmokeCheck {
    static func main() async throws {
        try checkSamplingRules()
        try checkNativeSamplingFilters()
        try checkNativePositionSnapshotShape()
        try checkRestartRecoveryAndCorruptArchiveProtection()
        print("macOS native location checks passed")
    }

    private static func checkSamplingRules() throws {
        try require(!NativeLocationService.acceptsSample(
            distance: 10, seconds: 3, interval: 4,
            minimumDistance: 5, stationarySeconds: 30, distanceOnly: false),
            "sampling accepted a fix before its interval")
        try require(NativeLocationService.acceptsSample(
            distance: 5, seconds: 4, interval: 4,
            minimumDistance: 5, stationarySeconds: 30, distanceOnly: true),
            "sampling rejected a qualifying distance fix")
        try require(NativeLocationService.acceptsSample(
            distance: 0, seconds: 30, interval: 4,
            minimumDistance: 5, stationarySeconds: 30, distanceOnly: false),
            "sampling rejected the stationary interval")
        try require(!NativeLocationService.acceptsSample(
            distance: 0, seconds: 30, interval: 4,
            minimumDistance: 5, stationarySeconds: 30, distanceOnly: true),
            "distance-only sampling accepted a stationary fix")
    }

    private static func checkNativeSamplingFilters() throws {
        try require(NativeLocationService.effectiveDistanceFilter(
            distanceMetres: 1, adaptive: false, stationary: false,
            locationSubscribed: false) == 1,
            "custom one-meter recording filter was not applied")
        try require(NativeLocationService.effectiveDistanceFilter(
            distanceMetres: 1, adaptive: true, stationary: true,
            locationSubscribed: false) == 25,
            "adaptive stationary state did not reduce native update frequency")
        try require(NativeLocationService.effectiveDistanceFilter(
            distanceMetres: 1, adaptive: true, stationary: false,
            locationSubscribed: false) == 1,
            "native filter did not return to the configured distance after motion")
        try require(NativeLocationService.effectiveDistanceFilter(
            distanceMetres: 1, adaptive: true, stationary: true,
            locationSubscribed: true) == 1,
            "active map subscription did not preserve a one-meter recording filter")
        try require(NativeLocationService.effectiveDistanceFilter(
            distanceMetres: 10, adaptive: false, stationary: false,
            locationSubscribed: true) == 5,
            "active map subscription did not cap a ten-meter filter at five meters")
    }

    private static func checkNativePositionSnapshotShape() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("shantu-native-fix-check-\(UUID().uuidString)",
                                    isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let service = NativeLocationService(storageRoot: root, changed: {})
        let timestamp = Date()
        let location = CLLocation(coordinate: CLLocationCoordinate2D(latitude: 31.2, longitude: 121.5),
                                  altitude: 12.5,
                                  horizontalAccuracy: 4.0,
                                  verticalAccuracy: 6.0,
                                  course: -1,
                                  speed: -1,
                                  timestamp: timestamp)
        service.locationManager(CLLocationManager(), didUpdateLocations: [location])

        let snapshot = service.locationSnapshot
        let fix = snapshot["fix"] as? [String: Any]
        try require(fix != nil, "a fresh CLLocation was not exposed in the snapshot")
        try require((fix?["longitude"] as? NSNumber)?.doubleValue == 121.5,
                    "native fix is missing longitude")
        try require((fix?["latitude"] as? NSNumber)?.doubleValue == 31.2,
                    "native fix is missing latitude")
        try require((fix?["timestamp"] as? NSNumber)?.doubleValue ==
                    timestamp.timeIntervalSince1970 * 1000,
                    "native fix timestamp is not in JavaScript milliseconds")
        try require((fix?["accuracy"] as? NSNumber)?.doubleValue == 4.0,
                    "native fix is missing horizontal accuracy")
        try require(fix?["source"] as? String == "network",
                    "native Mac fix must identify its network source")
        try require(fix?["coordinates"] == nil && fix?["time"] == nil,
                    "location snapshot unexpectedly uses the track-record fix shape")
        service.shutdown()
    }

    private static func checkRestartRecoveryAndCorruptArchiveProtection() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("shantu-native-location-check-\(UUID().uuidString)",
                                    isDirectory: true)
        defer { try? FileManager.default.removeItem(at: root) }

        let archiveURL = root.appendingPathComponent("OutdoorRecording", isDirectory: true)
            .appendingPathComponent("recording.json")
        try FileManager.default.createDirectory(at: archiveURL.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        let fixture: [String: Any] = [
            "id": "fixture-recording",
            "phase": "recording",
            "startedAt": 1_800_000_000_000.0,
            "segments": [[[
                "coordinates": [120.0, 30.0],
                "time": 1_800_000_000_000.0,
                "accuracy": 4.0,
                "altitude": NSNull(),
            ]]],
            "error": "",
            "maximumAccuracy": 25,
            "sampling": [
                "mode": "accuracy", "intervalSeconds": 1,
                "distanceMetres": 2, "stationarySeconds": 10,
                "adaptive": false, "distanceOnly": false,
                "recordOnNavigation": false,
            ],
        ]
        try JSONSerialization.data(withJSONObject: fixture, options: [.sortedKeys])
            .write(to: archiveURL, options: .atomic)

        let recovered = NativeLocationService(storageRoot: root, changed: {})
        let recoveredSnapshot = recovered.recordingSnapshot
        try require(recoveredSnapshot["phase"] as? String == "paused",
                    "a recording reopened in the active phase")
        try require(recoveredSnapshot["id"] as? String == "fixture-recording",
                    "restart recovery changed the recording id")
        try require(recoveredSnapshot["archiveCorrupt"] as? Bool == false,
                    "a valid fixture was marked corrupt")
        try require((recoveredSnapshot["maximumAccuracy"] as? NSNumber)?.intValue == 25,
                    "restart did not restore the maximum accuracy")
        let restoredSampling = recoveredSnapshot["sampling"] as? [String: Any]
        try require(restoredSampling?["mode"] as? String == "accuracy",
                    "restart did not restore the sampling mode")
        try require((restoredSampling?["distanceMetres"] as? NSNumber)?.intValue == 2,
                    "restart did not restore the sampling distance")

        let updatedSampling: [String: Any] = [
            "mode": "custom", "intervalSeconds": 3,
            "distanceMetres": 7, "stationarySeconds": 15,
            "adaptive": true, "distanceOnly": true,
            "recordOnNavigation": true,
        ]
        _ = try recovered.handle("record.configure", [
            "maximumAccuracy": 35, "sampling": updatedSampling,
        ])
        let beforeInvalidConfig = recovered.recordingSnapshot
        do {
            _ = try recovered.handle("record.configure", [
                "maximumAccuracy": 40,
                "sampling": ["mode": "invalid"],
            ])
            throw CheckFailure(description: "invalid configuration unexpectedly succeeded")
        } catch is CheckFailure {
            throw CheckFailure(description: "invalid configuration unexpectedly succeeded")
        } catch {
            // Invalid updates must leave both preference values unchanged.
        }
        try require((recovered.recordingSnapshot["maximumAccuracy"] as? NSNumber)?.intValue ==
                    (beforeInvalidConfig["maximumAccuracy"] as? NSNumber)?.intValue,
                    "invalid configuration changed maximum accuracy")
        try require((recovered.recordingSnapshot["sampling"] as? [String: Any])?["mode"] as? String == "custom",
                    "invalid configuration changed the sampling policy")
        recovered.shutdown()

        let reopened = NativeLocationService(storageRoot: root, changed: {})
        let reopenedSnapshot = reopened.recordingSnapshot
        try require((reopenedSnapshot["maximumAccuracy"] as? NSNumber)?.intValue == 35,
                    "configured maximum accuracy was not persisted")
        try require((reopenedSnapshot["sampling"] as? [String: Any])?["mode"] as? String == "custom",
                    "configured sampling policy was not persisted")
        reopened.shutdown()

        let corruptRoot = root.appendingPathComponent("corrupt", isDirectory: true)
        let corruptURL = corruptRoot.appendingPathComponent("OutdoorRecording", isDirectory: true)
            .appendingPathComponent("recording.json")
        try FileManager.default.createDirectory(at: corruptURL.deletingLastPathComponent(),
                                                withIntermediateDirectories: true)
        let corruptBytes = Data("{ invalid saved data".utf8)
        try corruptBytes.write(to: corruptURL, options: .atomic)

        let corruptService = NativeLocationService(storageRoot: corruptRoot, changed: {})
        try require(corruptService.recordingSnapshot["archiveCorrupt"] as? Bool == true,
                    "a malformed archive was not reported")
        do {
            _ = try corruptService.handle("record.command", ["command": "start"])
            throw CheckFailure(description: "start unexpectedly replaced a corrupt archive")
        } catch is CheckFailure {
            throw CheckFailure(description: "start unexpectedly replaced a corrupt archive")
        } catch {
            // The service must return an explicit error and leave the fixture untouched.
        }
        let preserved = try Data(contentsOf: corruptURL)
        try require(preserved == corruptBytes, "the corrupt archive was overwritten")
        corruptService.shutdown()
    }

    private static func require(_ condition: @autoclosure () -> Bool,
                                _ message: String) throws {
        if !condition() { throw CheckFailure(description: message) }
    }
}

private struct CheckFailure: Error, CustomStringConvertible {
    let description: String
    init(description: String) { self.description = description }
}
