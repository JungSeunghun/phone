import XCTest
import PhoneMirrorCore
@testable import PhoneMirrorApp

final class FakeWirelessConnectionService: WirelessConnectionService {
    var services: [WirelessService] = []
    var pairCalls: [(String, String)] = []
    var connectCalls: [String] = []
    var fails = false
    var suspendPairing = false
    var continuation: CheckedContinuation<Void, Error>?
    func discoverServices() async throws -> [WirelessService] { if fails { throw CocoaError(.fileReadUnknown) }; return services }
    func pair(address: String, code: String) async throws {
        pairCalls.append((address, code))
        if suspendPairing { try await withCheckedThrowingContinuation { continuation = $0 } }
        if fails { throw CocoaError(.fileReadUnknown) }
    }
    func connect(address: String) async throws { connectCalls.append(address); if fails { throw CocoaError(.fileReadUnknown) } }
}
@MainActor
final class WirelessPairingBehaviorTests: XCTestCase {
    func settle() async { for _ in 0..<5 { await Task.yield() }; try? await Task.sleep(nanoseconds: 10_000_000) }
    func testValidationBoundariesDisableInvalidFrontendActions() {
        let model = WirelessPairingViewModel(service: FakeWirelessConnectionService())
        model.pairingAddress = "1.2.3.4:1"
        for code in ["", "12345", "1234567", "１２３４５６"] { model.pairingCode = code; XCTAssertFalse(model.canPair) }
        model.pairingCode = "000000"; XCTAssertTrue(model.canPair)
        model.pairingAddress = "1.2.3.4:0"; XCTAssertFalse(model.canPair)
        model.connectionAddress = "1.2.3.4:65535"; XCTAssertTrue(model.canConnect)
        model.connectionAddress = "1.2.3.4:65536"; XCTAssertFalse(model.canConnect)
    }
    func testBrowseSelectsCorrectPortForPairingAndConnection() async {
        let service = FakeWirelessConnectionService()
        service.services = [WirelessService(name: "adb-A", kind: .pairing, endpoint: WirelessEndpoint(address: "1.2.3.4:1")!), WirelessService(name: "adb-A", kind: .connection, endpoint: WirelessEndpoint(address: "1.2.3.4:2")!)]
        let actual = WirelessPairingViewModel(service: service); await actual.refreshServices()
        actual.selectService(service.services[0]); XCTAssertEqual(actual.pairingAddress, "1.2.3.4:1"); XCTAssertTrue(actual.connectionAddress.isEmpty)
        actual.selectService(service.services[1]); XCTAssertEqual(actual.connectionAddress, "1.2.3.4:2")
    }
    func testPairSuccessClearsSecretAndConnectsOnlyMatchingAdvertisedDevice() async {
        let service = FakeWirelessConnectionService(); service.services = [WirelessService(name: "adb-A", kind: .pairing, endpoint: WirelessEndpoint(address: "1.2.3.4:1")!), WirelessService(name: "adb-A", kind: .connection, endpoint: WirelessEndpoint(address: "1.2.3.4:2")!), WirelessService(name: "adb-B", kind: .connection, endpoint: WirelessEndpoint(address: "1.2.3.5:3")!)]
        var readyCount = 0
        let model = WirelessPairingViewModel(service: service, onDevicesChanged: { readyCount += 1 })
        await model.refreshServices(); model.selectService(service.services[0]); model.pairingCode = "123456"
        model.pair(); model.pair(); await settle()
        XCTAssertEqual(service.pairCalls.count, 1); XCTAssertTrue(model.pairingCode.isEmpty); XCTAssertFalse(model.isBusy)
        XCTAssertEqual(service.connectCalls, ["1.2.3.4:2"]); XCTAssertEqual(readyCount, 1)
        XCTAssertFalse(model.statusMessage.contains("123456"))
    }
    func testCancelIgnoresLatePairingCompletionAndPreventsAutoConnect() async {
        let service = FakeWirelessConnectionService(); service.suspendPairing = true
        let model = WirelessPairingViewModel(service: service); model.pairingAddress = "1.2.3.4:1"; model.pairingCode = "123456"
        model.pair(); await settle(); model.cancel(); service.continuation?.resume(); await settle()
        XCTAssertTrue(model.pairingCode.isEmpty); XCTAssertFalse(model.isBusy); XCTAssertEqual(model.state, .idle); XCTAssertTrue(service.connectCalls.isEmpty)
    }
    func testFailureAndInvalidActionsNeverLeakPairingSecret() async {
        let service = FakeWirelessConnectionService(); service.fails = true
        let model = WirelessPairingViewModel(service: service); model.pair(); model.connect(); XCTAssertTrue(service.pairCalls.isEmpty)
        model.pairingAddress = "1.2.3.4:1"; model.pairingCode = "123456"; model.pair(); await settle()
        XCTAssertEqual(model.state, .failed); XCTAssertTrue(model.pairingCode.isEmpty); XCTAssertFalse(model.statusMessage.contains("123456"))
    }
    func testManualConnectNotifiesDeviceListAndRepeatedActionsAreIgnored() async {
        let service = FakeWirelessConnectionService(); var count = 0
        let model = WirelessPairingViewModel(service: service, onDevicesChanged: { count += 1 }); model.connectionAddress = "1.2.3.4:1"
        model.connect(); model.connect(); await settle()
        XCTAssertEqual(service.connectCalls, ["1.2.3.4:1"]); XCTAssertEqual(model.state, .connected); XCTAssertEqual(count, 1)
    }
}
