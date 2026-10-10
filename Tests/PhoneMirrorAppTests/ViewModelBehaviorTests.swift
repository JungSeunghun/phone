import XCTest
import CoreVideo
import PhoneMirrorCore
@testable import PhoneMirrorApp

final class FakeSettingsStore: SettingsStore {
    var settings: MirrorSettings
    var writes: [MirrorSettings] = []
    var failsWrites = false
    init(_ settings: MirrorSettings = MirrorSettings()) { self.settings = settings }
    func load() -> MirrorSettings { settings }
    func save(_ settings: MirrorSettings) throws {
        if failsWrites { throw CocoaError(.fileWriteNoPermission) }
        self.settings = settings; writes.append(settings)
    }
}
final class FakeTimeProvider: TimeProvider { var now: TimeInterval = 100 }
final class FakeDeviceDiscovery: DeviceDiscovery {
    var devices: [PhoneDevice] = []
    var calls = 0
    var suspended: CheckedContinuation<[PhoneDevice], Error>?
    var delayNextDiscovery = false
    func discoverDevices(for platform: PhonePlatform) async throws -> [PhoneDevice] {
        calls += 1
        if delayNextDiscovery {
            delayNextDiscovery = false
            return try await withCheckedThrowingContinuation { suspended = $0 }
        }
        return devices.filter { $0.identity.platform == platform }
    }
}
final class FakeMirrorSession: MirrorSession {
    var callbacks = MirrorSessionCallbacks()
    var startCount = 0, stopCount = 0
    var keys: [UInt32] = []
    var texts: [String] = []
    var touches: [(UInt8, CGPoint, CGSize)] = []
    func start() { startCount += 1 }
    func stop() { stopCount += 1 }
    func sendKey(_ code: UInt32) { keys.append(code) }
    func sendText(_ text: String) { texts.append(text) }
    func sendTouch(action: UInt8, point: CGPoint, size: CGSize) { touches.append((action, point, size)) }
    func interruptForTest() { callbacks.onEnd?("Transport disconnected") }
    func emitFrame() {
        var buffer: CVPixelBuffer?
        CVPixelBufferCreate(nil, 16, 16, kCVPixelFormatType_32BGRA, [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &buffer)
        callbacks.onFrame?(buffer!)
    }
}
final class FakeMirrorSessionFactory: MirrorSessionFactory {
    var sessions: [FakeMirrorSession] = []
    var identities: [DeviceIdentity] = []
    var fails = false
    func makeSession(for device: DeviceIdentity, settings: MirrorSettings) throws -> any MirrorSession {
        if fails { throw CocoaError(.fileReadNoSuchFile) }
        let session = FakeMirrorSession(); sessions.append(session); identities.append(device); return session
    }
}

@MainActor
final class ViewModelBehaviorTests: XCTestCase {
    let deviceA = PhoneDevice(identity: DeviceIdentity(platform: .android, id: "A"), name: "Android A", availability: .ready)
    let deviceB = PhoneDevice(identity: DeviceIdentity(platform: .android, id: "B"), name: "Android B", availability: .ready)
    func fixture(_ settings: MirrorSettings = MirrorSettings()) -> (PhoneMirrorViewModel, FakeDeviceDiscovery, FakeMirrorSessionFactory, FakeTimeProvider, FakeSettingsStore) {
        let discovery = FakeDeviceDiscovery(), factory = FakeMirrorSessionFactory(), time = FakeTimeProvider(), store = FakeSettingsStore(settings)
        let model = PhoneMirrorViewModel(settingsStore: store, deviceDiscovery: discovery, sessionFactory: factory, timeProvider: time, automaticallyPoll: false)
        return (model, discovery, factory, time, store)
    }
    func settle() async { for _ in 0..<5 { await Task.yield() }; try? await Task.sleep(nanoseconds: 10_000_000) }
    func connect(_ model: PhoneMirrorViewModel, _ discovery: FakeDeviceDiscovery, _ factory: FakeMirrorSessionFactory) async {
        discovery.devices = [deviceA]; await model.refreshDevices(); model.startMirroring(); factory.sessions.last!.emitFrame(); await settle()
        XCTAssertEqual(model.connectionState, .live)
    }
    func testLaunchRestoresPreferencesAndDeviceWithoutStartingSession() async {
        var settings = MirrorSettings(); settings.videoMaxDimension = 2560; settings.audioEnabled = false
        settings.rememberDevice(deviceB.identity)
        let (model, discovery, factory, _, store) = fixture(settings)
        discovery.devices = [deviceA, deviceB]; await model.refreshDevices()
        XCTAssertEqual(model.settings, settings); XCTAssertEqual(model.selectedDeviceID, "B")
        XCTAssertTrue(model.canStartMirroring); XCTAssertTrue(factory.sessions.isEmpty); XCTAssertTrue(store.writes.isEmpty)
    }
    func testAbsentPreferredDeviceIsRememberedUntilItReturns() async {
        var settings = MirrorSettings(); settings.rememberDevice(deviceB.identity)
        let (model, discovery, _, _, store) = fixture(settings)
        discovery.devices = [deviceA]; await model.refreshDevices()
        XCTAssertEqual(model.settings.preferredDeviceID(for: .android), "B")
        discovery.devices = [deviceA, deviceB]; await model.refreshDevices()
        XCTAssertEqual(model.selectedDeviceID, "B"); XCTAssertTrue(store.writes.isEmpty)
    }
    func testSettingsChangeSavesAndRejectsInvalidInput() {
        let (model, _, _, _, store) = fixture()
        var settings = model.settings; settings.videoMaxDimension = -1; settings.videoMaxFrameRate = Int.max; settings.alwaysOnTop = true
        model.updateSettings(settings)
        XCTAssertEqual(model.settings.videoMaxDimension, 1920); XCTAssertEqual(model.settings.videoMaxFrameRate, 60)
        XCTAssertTrue(store.settings.alwaysOnTop)
    }
    func testSettingsWriteFailureIsVisibleAndDoesNotChangeConnectionState() {
        let (model, _, _, _, store) = fixture(); store.failsWrites = true
        var settings = model.settings; settings.audioEnabled = false; model.updateSettings(settings)
        XCTAssertFalse(model.settings.audioEnabled); XCTAssertFalse(model.settingsStatusMessage.isEmpty)
        XCTAssertEqual(model.connectionState, .idle)
    }
    func testSavedWindowPlacementSavesValidatedBounds() {
        let (model, _, _, _, store) = fixture()
        model.saveWindowPlacement(SavedWindowPlacement(x: .nan, y: .infinity, width: 939, height: 699))
        XCTAssertEqual(store.settings.windowPlacement, SavedWindowPlacement(x: 0, y: 0, width: 1060, height: 780))
    }
    func testRepeatedStartStartsOnlyOneSessionAndFirstFrameEnablesMediaActions() async {
        let (model, discovery, factory, _, _) = fixture(); discovery.devices = [deviceA]; await model.refreshDevices()
        XCTAssertFalse(model.canSaveFrame); model.startMirroring(); model.startMirroring()
        XCTAssertEqual(factory.sessions.count, 1); XCTAssertEqual(model.connectionState, .connecting); XCTAssertFalse(model.canSaveFrame)
        factory.sessions[0].emitFrame(); await settle(); XCTAssertTrue(model.canSaveFrame)
    }
    func testDisconnectAutomaticallyReconnectsSameDeviceAfterDelay() async {
        let (model, discovery, factory, time, _) = fixture(); await connect(model, discovery, factory)
        factory.sessions[0].callbacks.onEnd?("USB lost"); await settle()
        XCTAssertEqual(model.connectionState, .reconnecting)
        time.now = 100.999; await model.refreshDevices(); XCTAssertEqual(factory.sessions.count, 1)
        time.now = 101; await model.refreshDevices(); XCTAssertEqual(factory.sessions.count, 2)
        XCTAssertEqual(factory.identities.last, deviceA.identity); XCTAssertEqual(model.connectionState, .connecting)
        factory.sessions[1].emitFrame(); await settle(); XCTAssertEqual(model.connectionState, .live)
    }
    func testOtherPhoneNeverReplacesReconnectTarget() async {
        let (model, discovery, factory, time, _) = fixture(); await connect(model, discovery, factory)
        factory.sessions[0].callbacks.onEnd?("lost"); await settle()
        discovery.devices = [deviceB]; time.now = 200; await model.refreshDevices()
        XCTAssertEqual(model.selectedDeviceID, "A"); XCTAssertEqual(factory.sessions.count, 1)
        discovery.devices = [deviceB, deviceA]; await model.refreshDevices(); XCTAssertEqual(factory.identities.last, deviceA.identity)
    }
    func testManualStopWhileWaitingCancelsRetryAndLateCallbacks() async {
        let (model, discovery, factory, time, _) = fixture(); await connect(model, discovery, factory)
        let old = factory.sessions[0]; old.callbacks.onEnd?("lost"); await settle(); model.stopMirroring()
        old.emitFrame(); old.callbacks.onEnd?("late error"); await settle()
        time.now = 1000; await model.refreshDevices()
        XCTAssertEqual(model.connectionState, .stopped); XCTAssertEqual(factory.sessions.count, 1)
        XCTAssertFalse(model.canSaveFrame)
    }
    func testManualStopWhileLiveAndRepeatedStopsAreIdempotent() async {
        let (model, discovery, factory, time, _) = fixture(); await connect(model, discovery, factory)
        model.stopMirroring(); model.stopMirroring(); time.now = 1000; await model.refreshDevices()
        XCTAssertEqual(factory.sessions[0].stopCount, 1); XCTAssertEqual(factory.sessions.count, 1)
        XCTAssertEqual(model.connectionState, .stopped)
    }
    func testDisabledAutomaticReconnectAndToggleDuringWait() async {
        let (model, discovery, factory, time, _) = fixture(); await connect(model, discovery, factory)
        factory.sessions[0].callbacks.onEnd?("lost"); await settle()
        var settings = model.settings; settings.autoReconnectEnabled = false; model.updateSettings(settings)
        time.now = 101; await model.refreshDevices(); XCTAssertEqual(factory.sessions.count, 1)
        settings.autoReconnectEnabled = true; model.updateSettings(settings); await model.refreshDevices()
        XCTAssertEqual(factory.sessions.count, 2)
    }
    func testDeviceSelectionCancelsOldReconnectAndPersistsNewDevice() async {
        let (model, discovery, factory, time, store) = fixture(); await connect(model, discovery, factory)
        factory.sessions[0].callbacks.onEnd?("lost"); await settle()
        discovery.devices = [deviceA, deviceB]; model.selectDevice("B"); await model.refreshDevices(); model.selectDevice("B")
        time.now = 200; await model.refreshDevices()
        XCTAssertEqual(model.selectedDeviceID, "B"); XCTAssertEqual(store.settings.preferredDeviceID(for: .android), "B")
        XCTAssertEqual(factory.sessions.count, 1)
    }
    func testInvalidDeviceSelectionIsIgnored() async {
        let (model, discovery, _, _, store) = fixture(); discovery.devices = [deviceA]; await model.refreshDevices()
        for id in ["", " ", "unknown", String(repeating: "A", count: 257)] { model.selectDevice(id) }
        XCTAssertEqual(model.selectedDeviceID, "A"); XCTAssertTrue(store.writes.isEmpty)
    }
    func testPlatformChangeCancelsPendingReconnect() async {
        let (model, discovery, factory, time, store) = fixture(); await connect(model, discovery, factory)
        factory.sessions[0].callbacks.onEnd?("lost"); await settle(); model.selectPlatform(.iOS)
        time.now = 200; await model.refreshDevices()
        XCTAssertEqual(model.platform, .iOS); XCTAssertEqual(store.settings.preferredPlatform, .iOS)
        XCTAssertEqual(factory.sessions.count, 1)
    }
    func testStaleDiscoveryFromPreviousPlatformIsIgnored() async {
        let (model, discovery, _, _, _) = fixture(); discovery.delayNextDiscovery = true
        let old = Task { await model.refreshDevices() }; await settle(); model.selectPlatform(.iOS)
        discovery.suspended?.resume(returning: [deviceA]); await old.value
        XCTAssertTrue(model.availableDevices.isEmpty); XCTAssertEqual(model.platform, .iOS)
    }
    func testConnectionTimeoutAndStallTimeBoundaries() async {
        let (model, discovery, factory, time, _) = fixture(); discovery.devices = [deviceA]; await model.refreshDevices(); model.startMirroring()
        time.now = 114.999; model.tick(); XCTAssertEqual(model.connectionState, .connecting)
        time.now = 115; model.tick(); XCTAssertEqual(model.connectionState, .reconnecting)
        model.stopMirroring(); model.startMirroring(); factory.sessions.last!.emitFrame(); await settle()
        time.now = 118.999; model.tick(); XCTAssertEqual(model.connectionState, .live)
        time.now = 119; model.tick(); XCTAssertEqual(model.connectionState, .stalled)
        factory.sessions.last!.emitFrame(); await settle(); XCTAssertEqual(model.connectionState, .live)
    }
    func testSessionFactoryFailureDoesNotCrashAndCanBeStopped() async {
        let (model, discovery, factory, _, _) = fixture(); discovery.devices = [deviceA]; await model.refreshDevices(); factory.fails = true
        model.startMirroring(); XCTAssertEqual(model.connectionState, .reconnecting)
        model.stopMirroring(); XCTAssertEqual(model.connectionState, .stopped)
    }
    func testFrontendControlActionsAreBlockedBeforeLiveAndAfterStop() async {
        let (model, discovery, factory, _, _) = fixture(); discovery.devices = [deviceA]; await model.refreshDevices(); model.startMirroring()
        model.sendKey(3); XCTAssertTrue(factory.sessions[0].keys.isEmpty)
        factory.sessions[0].emitFrame(); await settle(); model.sendKey(3); XCTAssertEqual(factory.sessions[0].keys, [3])
        var settings = model.settings; settings.controlEnabled = false; model.updateSettings(settings); model.sendKey(4)
        XCTAssertEqual(factory.sessions[0].keys, [3]); model.stopMirroring(); model.sendKey(3); XCTAssertEqual(factory.sessions[0].keys, [3])
    }
    func testDeviceUnavailableAndUnauthorizedDisableStartAction() async {
        let (model, discovery, factory, _, _) = fixture(); await model.refreshDevices()
        XCTAssertFalse(model.canStartMirroring); model.startMirroring(); XCTAssertTrue(factory.sessions.isEmpty)
        discovery.devices = [PhoneDevice(identity: deviceA.identity, name: "A", availability: .unauthorized)]
        await model.refreshDevices(); XCTAssertEqual(model.connectionState, .unauthorized); XCTAssertFalse(model.canStartMirroring)
    }
    func testShutdownCancelsPollingAndReconnectIntent() async {
        let (model, discovery, factory, time, _) = fixture(); await connect(model, discovery, factory)
        factory.sessions[0].callbacks.onEnd?("lost"); await settle(); model.shutdown(); time.now = 1000; await model.refreshDevices()
        XCTAssertEqual(factory.sessions.count, 1); XCTAssertEqual(model.connectionState, .stopped)
    }
    func testDisabledReconnectAllowsDirectManualRestart() async {
        var settings = MirrorSettings(); settings.autoReconnectEnabled = false
        let (model, discovery, factory, _, _) = fixture(settings); await connect(model, discovery, factory)
        factory.sessions[0].interruptForTest(); await settle()
        XCTAssertEqual(model.connectionState, .disconnected); XCTAssertFalse(model.canStopMirroring); XCTAssertTrue(model.canStartMirroring)
        model.startMirroring(); XCTAssertEqual(factory.sessions.count, 2)
    }
    func testExhaustedRetriesExposeManualStartAction() async {
        let (model, discovery, factory, time, _) = fixture(); discovery.devices = [deviceA]; await model.refreshDevices(); model.startMirroring()
        for delay in ReconnectionPolicy.retryDelays {
            factory.sessions.last!.interruptForTest(); await settle(); time.now += delay; await model.refreshDevices()
        }
        XCTAssertEqual(factory.sessions.count, 6)
        factory.sessions.last!.interruptForTest(); await settle(); time.now += 100; await model.refreshDevices()
        XCTAssertEqual(factory.sessions.count, 6); XCTAssertFalse(model.canStopMirroring); XCTAssertTrue(model.canStartMirroring)
        XCTAssertTrue(model.connectionMessage.contains("5회 실패")); model.startMirroring(); XCTAssertEqual(factory.sessions.count, 7)
    }
    func testEmptyTextIsIgnoredAndUnicodeTextIsForwarded() async {
        let (model, discovery, factory, _, _) = fixture(); await connect(model, discovery, factory)
        model.sendText(""); model.sendText("A한글🙂")
        XCTAssertEqual(factory.sessions[0].texts, ["A한글🙂"])
    }
    func testTouchActionsValidateAndClampCoordinates() async {
        let (model, discovery, factory, _, _) = fixture(); await connect(model, discovery, factory)
        for action: UInt8 in [0, 1, 2] { model.sendTouch(action: action, point: CGPoint(x: -1, y: 16)) }
        for action: UInt8 in [3, 255] { model.sendTouch(action: action, point: .zero) }
        model.sendTouch(action: 0, point: CGPoint(x: CGFloat.nan, y: 0)); model.sendTouch(action: 0, point: CGPoint(x: 0, y: CGFloat.infinity))
        XCTAssertEqual(factory.sessions[0].touches.count, 3)
        for event in factory.sessions[0].touches { XCTAssertEqual(event.1, CGPoint(x: 0, y: 15)); XCTAssertEqual(event.2, CGSize(width: 16, height: 16)) }
    }
    func testLateCallbacksCannotReplaceNewSessionState() async {
        let (model, discovery, factory, time, _) = fixture(); await connect(model, discovery, factory)
        let old = factory.sessions[0]; old.interruptForTest(); await settle(); time.now += 1; await model.refreshDevices()
        old.emitFrame(); old.callbacks.onAudioReady?(); old.callbacks.onLog?("STALE"); old.interruptForTest(); await settle()
        XCTAssertEqual(model.connectionState, .connecting); XCTAssertFalse(model.isAudioAvailable); XCTAssertFalse(model.connectionLog.contains("STALE"))
        factory.sessions[1].emitFrame(); await settle(); XCTAssertEqual(model.connectionState, .live)
    }
    func testScreenshotWritesActualFrameAndInvalidDestinationReportsError() async throws {
        let (model, discovery, factory, _, _) = fixture(); await connect(model, discovery, factory)
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true); defer { try? FileManager.default.removeItem(at: directory) }
        let url = directory.appendingPathComponent("test.png"); model.captureScreenshot(to: url)
        XCTAssertTrue(FileManager.default.fileExists(atPath: url.path)); XCTAssertEqual(model.lastSavedURL, url)
        model.captureScreenshot(to: directory.appendingPathComponent("missing/test.png"))
        XCTAssertNil(model.lastSavedURL); XCTAssertFalse(model.mediaStatusMessage.isEmpty); XCTAssertEqual(model.connectionState, .live)
        model.stopMirroring(); model.captureScreenshot(to: directory.appendingPathComponent("stopped.png"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: directory.appendingPathComponent("stopped.png").path))
    }

}
