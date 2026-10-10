import XCTest
@testable import PhoneMirrorCore

final class SettingsTests: XCTestCase {
    func testDefaultsAreValid() {
        let settings = MirrorSettings()
        XCTAssertEqual(settings.videoMaxDimension, 1920)
        XCTAssertEqual(settings.videoMaxFrameRate, 60)
        XCTAssertTrue(settings.autoReconnectEnabled)
        XCTAssertEqual(settings.validated(), settings)
    }
    func testAllAllowedVideoDimensionsAndFrameRatesRoundTrip() throws {
        for dimension in [1280, 1920, 2560] {
            for frameRate in [30, 60] {
                var settings = MirrorSettings()
                settings.videoMaxDimension = dimension; settings.videoMaxFrameRate = frameRate
                XCTAssertEqual(try SettingsCodec.decode(SettingsCodec.encode(settings)), settings)
            }
        }
    }
    func testInvalidVideoSettingsFallBackToDefaults() {
        for dimension in [Int.min, -1, 0, 1279, 1281, 1919, 1921, 2559, 2561, Int.max] {
            var settings = MirrorSettings(); settings.videoMaxDimension = dimension
            XCTAssertEqual(settings.validated().videoMaxDimension, 1920)
        }
        for frameRate in [Int.min, -1, 0, 29, 31, 59, 61, Int.max] {
            var settings = MirrorSettings(); settings.videoMaxFrameRate = frameRate
            XCTAssertEqual(settings.validated().videoMaxFrameRate, 60)
        }
    }
    func testMissingAndInvalidFieldsKeepOtherValidFields() throws {
        let data = Data(#"{"version":1,"settings":{"audioEnabled":false,"videoMaxDimension":2560,"videoMaxFrameRate":"bad"}}"#.utf8)
        let settings = try SettingsCodec.decode(data)
        XCTAssertFalse(settings.audioEnabled)
        XCTAssertEqual(settings.videoMaxDimension, 2560)
        XCTAssertEqual(settings.videoMaxFrameRate, 60)
        XCTAssertTrue(settings.autoReconnectEnabled)
    }
    func testCorruptAndUnsupportedDocumentsAreRejected() {
        for input in ["", "not-json", "[]", "null", "{}", #"{"version":2,"settings":{}}"#, #"{"version":1,"settings":null}"#] {
            XCTAssertThrowsError(try SettingsCodec.decode(Data(input.utf8)), input)
        }
    }
    func testAllPreferencesAndPerPlatformDeviceIDsRoundTrip() throws {
        var settings = MirrorSettings()
        settings.audioEnabled = false; settings.controlEnabled = false; settings.keepScreenAwake = false
        settings.alwaysOnTop = true; settings.autoReconnectEnabled = false; settings.preferredPlatform = .iOS
        settings.rememberDevice(DeviceIdentity(platform: .android, id: "android-A"))
        settings.rememberDevice(DeviceIdentity(platform: .iOS, id: "ios-B"))
        settings.windowPlacement = SavedWindowPlacement(x: -1920, y: 10, width: 1200, height: 800)
        XCTAssertEqual(try SettingsCodec.decode(SettingsCodec.encode(settings)), settings)
        XCTAssertEqual(settings.preferredDeviceID(for: .android), "android-A")
        XCTAssertEqual(settings.preferredDeviceID(for: .iOS), "ios-B")
    }
    func testDeviceIdentifierBoundaries() {
        for id in ["", "  ", String(repeating: "A", count: 257), "A\nB", "A\0B"] {
            var settings = MirrorSettings(); settings.rememberDevice(DeviceIdentity(platform: .android, id: id))
            XCTAssertNil(settings.validated().preferredDeviceID(for: .android))
        }
        for id in ["A", String(repeating: "A", count: 256), "ios-device_with.dashes"] {
            var settings = MirrorSettings(); settings.rememberDevice(DeviceIdentity(platform: .iOS, id: id))
            XCTAssertEqual(settings.validated().preferredDeviceID(for: .iOS), id)
        }
    }
    func testWindowSizeAndCoordinateBoundaries() {
        let valid = SavedWindowPlacement(x: -100000, y: 100000, width: 940, height: 700)
        XCTAssertEqual(valid.validated(), valid)
        let max = SavedWindowPlacement(x: 100000, y: -100000, width: 4096, height: 2160)
        XCTAssertEqual(max.validated(), max)
        for value in [Double.nan, Double.infinity, -Double.infinity, -1, 0, 939, 4097] {
            let placement = SavedWindowPlacement(x: 0, y: 0, width: value, height: 780).validated()
            XCTAssertEqual(placement.width, 1060)
        }
        for value in [Double.nan, Double.infinity, -1, 0, 699, 2161] {
            XCTAssertEqual(SavedWindowPlacement(x: 0, y: 0, width: 1060, height: value).validated().height, 780)
        }
        XCTAssertEqual(SavedWindowPlacement(x: .nan, y: 100001, width: 1060, height: 780).validated().x, 0)
        XCTAssertEqual(SavedWindowPlacement(x: .nan, y: 100001, width: 1060, height: 780).validated().y, 0)
    }
    func testUserDefaultsStoreRoundTripAndCorruptFallback() throws {
        let suite = "PhoneMirrorTests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = UserDefaultsSettingsStore(defaults: defaults)
        XCTAssertEqual(store.load(), MirrorSettings())
        var settings = MirrorSettings(); settings.videoMaxDimension = 2560
        try store.save(settings)
        XCTAssertEqual(UserDefaultsSettingsStore(defaults: defaults).load(), settings)
        defaults.set(Data("broken".utf8), forKey: UserDefaultsSettingsStore.storageKey)
        XCTAssertEqual(store.load(), MirrorSettings())
    }
}
