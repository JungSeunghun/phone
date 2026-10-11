import XCTest
import PhoneMirrorCore
@testable import PhoneMirrorApp

actor FakeADBCommandExecutor: ADBCommandExecuting {
    var commands: [[String]] = []
    var inputs: [String?] = []
    var responses: [ADBCommandResult] = []
    func enqueue(_ results: [ADBCommandResult]) { responses.append(contentsOf: results) }
    func execute(_ arguments: [String], standardInput: String?) async throws -> ADBCommandResult {
        commands.append(arguments); inputs.append(standardInput)
        return responses.isEmpty ? ADBCommandResult(exitCode: 0, output: "") : responses.removeFirst()
    }
}
final class FakeWirelessDeviceStore: WirelessDeviceStore {
    var bookmarks: [WirelessDeviceBookmark] = []
    func load() -> [WirelessDeviceBookmark] { bookmarks }
    func save(_ values: [WirelessDeviceBookmark]) throws { bookmarks = values }
}
final class WirelessServiceTests: XCTestCase {
    func testPairingUsesStandardInputAndDistinguishesSuccessFromExitCode() async throws {
        let executor = FakeADBCommandExecutor(), client = ADBWirelessConnectionService(executor: executor)
        await executor.enqueue([ADBCommandResult(exitCode: 0, output: "Successfully paired to 1.2.3.4:1 [guid=adb-A-guid]")])
        try await client.pair(address: "1.2.3.4:1", code: "000000")
        let commands = await executor.commands, inputs = await executor.inputs
        XCTAssertEqual(commands[0], ["pair", "1.2.3.4:1"]); XCTAssertEqual(inputs[0], "000000\n")
        XCTAssertFalse(commands.joined().contains("000000"))
        await executor.enqueue([ADBCommandResult(exitCode: 0, output: "Failed: code 123456 rejected")])
        do { try await client.pair(address: "1.2.3.4:1", code: "123456"); XCTFail("Must reject failure with exit zero") }
        catch { XCTAssertFalse(error.localizedDescription.contains("123456")) }
    }
    func testInvalidInputsNeverInvokeADB() async {
        let executor = FakeADBCommandExecutor(), client = ADBWirelessConnectionService(executor: executor)
        for (address, code) in [("1.2.3.4:0", "123456"), ("1.2.3.4:1", "12345"), ("1.2.3.4:1", "１２３４５６")] {
            do { try await client.pair(address: address, code: code); XCTFail() } catch {}
        }
        do { try await client.connect(address: "1.2.3.4:65536"); XCTFail() } catch {}
        let commands = await executor.commands; XCTAssertTrue(commands.isEmpty)
    }
    func testConnectRejectsADBFailureEvenWithSuccessfulExit() async {
        let executor = FakeADBCommandExecutor(), client = ADBWirelessConnectionService(executor: executor)
        for output in ["connected to 1.2.3.4:1", "already connected to 1.2.3.4:1"] {
            await executor.enqueue([ADBCommandResult(exitCode: 0, output: output)])
            do { try await client.connect(address: "1.2.3.4:1") } catch { XCTFail(error.localizedDescription) }
        }
        await executor.enqueue([ADBCommandResult(exitCode: 0, output: "failed to connect to 1.2.3.4:1")])
        do { try await client.connect(address: "1.2.3.4:1"); XCTFail() } catch {}
    }
    func testDiscoveryQueriesStableIdentityAndKeepsBothTransports() async throws {
        let executor = FakeADBCommandExecutor(), store = FakeWirelessDeviceStore()
        await executor.enqueue([
            ADBCommandResult(exitCode: 0, output: "A device usb:1 model:Galaxy\n192.168.0.44:40001 device model:Galaxy"),
            ADBCommandResult(exitCode: 0, output: "adb-A-guid _adb-tls-connect._tcp 192.168.0.44:40001"),
            ADBCommandResult(exitCode: 0, output: "A\n"), ADBCommandResult(exitCode: 0, output: "A-guid\n")
        ])
        let discovery = AndroidDeviceDiscovery(executor: executor, bookmarkStore: store)
        let devices = try await discovery.discoverDevices(for: .android)
        XCTAssertEqual(devices.count, 2); XCTAssertEqual(devices.map(\.identity.id), ["A", "A"])
        XCTAssertEqual(devices.map(\.endpoint.transport), [.usb, .wifi]); XCTAssertNotEqual(devices[0].id, devices[1].id)
        XCTAssertEqual(store.bookmarks.first?.serviceName, "adb-A-guid")
    }
    func testChangedEndpointIsRediscoveredByBookmarkInsteadOfOldAddress() async throws {
        let executor = FakeADBCommandExecutor(), store = FakeWirelessDeviceStore()
        store.bookmarks = [WirelessDeviceBookmark(identity: DeviceIdentity(platform: .android, id: "A"), name: "A", serviceName: "adb-A-guid")]
        await executor.enqueue([
            ADBCommandResult(exitCode: 0, output: ""),
            ADBCommandResult(exitCode: 0, output: "adb-A-guid _adb-tls-connect._tcp 192.168.0.99:65535\nadb-B-guid _adb-tls-connect._tcp 192.168.0.44:1"),
            ADBCommandResult(exitCode: 0, output: "connected to 192.168.0.99:65535"),
            ADBCommandResult(exitCode: 0, output: "192.168.0.99:65535 device model:Galaxy"),
            ADBCommandResult(exitCode: 0, output: "A"), ADBCommandResult(exitCode: 0, output: "A-guid")
        ])
        let devices = try await AndroidDeviceDiscovery(executor: executor, bookmarkStore: store).discoverDevices(for: .android)
        XCTAssertEqual(devices.first?.identity.id, "A"); XCTAssertEqual(devices.first?.endpoint.address, "192.168.0.99:65535")
        let commands = await executor.commands
        XCTAssertTrue(commands.contains(["connect", "192.168.0.99:65535"])); XCTAssertFalse(commands.contains(["connect", "192.168.0.44:1"]))
    }
    func testFailedWirelessDiscoveryPreservesUSBAndUnknownIdentityIsExcluded() async throws {
        let executor = FakeADBCommandExecutor()
        await executor.enqueue([
            ADBCommandResult(exitCode: 0, output: "A device usb:1\n1.2.3.4:1 device"),
            ADBCommandResult(exitCode: 1, output: "mDNS unavailable"),
            ADBCommandResult(exitCode: 1, output: "")
        ])
        let devices = try await AndroidDeviceDiscovery(executor: executor, bookmarkStore: FakeWirelessDeviceStore()).discoverDevices(for: .android)
        XCTAssertEqual(devices.map(\.id), ["A"])
    }
    func testDuplicateEndpointsResolveToOneDevicePerTransport() async throws {
        let executor = FakeADBCommandExecutor()
        await executor.enqueue([
            ADBCommandResult(exitCode: 0, output: "1.2.3.4:1 device\nadb-A-guid._adb-tls-connect._tcp device"),
            ADBCommandResult(exitCode: 0, output: "adb-A-guid _adb-tls-connect._tcp 1.2.3.4:1"),
            ADBCommandResult(exitCode: 0, output: "A"), ADBCommandResult(exitCode: 0, output: "A-guid"),
            ADBCommandResult(exitCode: 0, output: "A"), ADBCommandResult(exitCode: 0, output: "A-guid")
        ])
        let devices = try await AndroidDeviceDiscovery(executor: executor, bookmarkStore: FakeWirelessDeviceStore()).discoverDevices(for: .android)
        XCTAssertEqual(devices.count, 1)
    }
    func testChangedServiceSuffixResolvesVerifiedSamePhone() async throws {
        let executor = FakeADBCommandExecutor(), store = FakeWirelessDeviceStore()
        store.bookmarks = [WirelessDeviceBookmark(identity: DeviceIdentity(platform: .android, id: "A"), name: "Galaxy", serviceName: "adb-A-old")]
        await executor.enqueue([
            ADBCommandResult(exitCode: 0, output: ""), ADBCommandResult(exitCode: 0, output: "adb-A-new _adb-tls-connect._tcp 1.2.3.5:2"),
            ADBCommandResult(exitCode: 0, output: "connected to 1.2.3.5:2"), ADBCommandResult(exitCode: 0, output: "adb-A-new._adb-tls-connect._tcp device"),
            ADBCommandResult(exitCode: 0, output: "A"), ADBCommandResult(exitCode: 0, output: "")
        ])
        let devices = try await AndroidDeviceDiscovery(executor: executor, bookmarkStore: store).discoverDevices(for: .android)
        XCTAssertEqual(devices.first?.identity.id, "A"); XCTAssertEqual(devices.first?.endpoint.address, "1.2.3.5:2")
        XCTAssertEqual(devices.first?.endpoint.identifier, "adb-A-new._adb-tls-connect._tcp")
        XCTAssertEqual(store.bookmarks.first?.serviceName, "adb-A-new")
    }
    func testReusedServiceAddressCannotImpersonateBookmarkedPhone() async throws {
        let executor = FakeADBCommandExecutor(), store = FakeWirelessDeviceStore()
        store.bookmarks = [WirelessDeviceBookmark(identity: DeviceIdentity(platform: .android, id: "A"), name: "Galaxy", serviceName: "adb-A-guid")]
        await executor.enqueue([
            ADBCommandResult(exitCode: 0, output: "1.2.3.4:1 device"), ADBCommandResult(exitCode: 0, output: "adb-A-guid _adb-tls-connect._tcp 1.2.3.4:1"),
            ADBCommandResult(exitCode: 0, output: "B"), ADBCommandResult(exitCode: 0, output: "A-guid")
        ])
        let devices = try await AndroidDeviceDiscovery(executor: executor, bookmarkStore: store).discoverDevices(for: .android)
        XCTAssertTrue(devices.isEmpty); XCTAssertEqual(store.bookmarks[0].identity.id, "A")
    }

    func testTemporaryMDNSLossDoesNotChangeAnAuthenticatedEndpoint() async throws {
        let executor = FakeADBCommandExecutor(), store = FakeWirelessDeviceStore()
        let discovery = AndroidDeviceDiscovery(executor: executor, bookmarkStore: store)
        let alias = "adb-A-guid (2)._adb-tls-connect._tcp"
        for serviceOutput in ["adb-A-guid (2) _adb-tls-connect._tcp 1.2.3.4:2", "", "adb-A-guid (2) _adb-tls-connect._tcp 1.2.3.5:3"] {
            await executor.enqueue([
                ADBCommandResult(exitCode: 0, output: "\(alias) device"),
                ADBCommandResult(exitCode: 0, output: serviceOutput),
                ADBCommandResult(exitCode: 0, output: "A"), ADBCommandResult(exitCode: 0, output: "")
            ])
        }
        let original = try await discovery.discoverDevices(for: .android)
        let missing = try await discovery.discoverDevices(for: .android)
        let changed = try await discovery.discoverDevices(for: .android)
        XCTAssertEqual(missing.first?.endpoint, original.first?.endpoint)
        XCTAssertEqual(changed.first?.endpoint.address, "1.2.3.5:3")
        XCTAssertNotEqual(changed.first?.endpoint, original.first?.endpoint)
    }

    func testDuplicateAliasesPreferNewCollisionServiceRegardlessOfADBOrder() async throws {
        for reversed in [false, true] {
            let executor = FakeADBCommandExecutor(), store = FakeWirelessDeviceStore()
            let aliases = ["adb-A-guid._adb-tls-connect._tcp device", "adb-A-guid (2)._adb-tls-connect._tcp device", "1.2.3.4:1 device"]
            await executor.enqueue([
                ADBCommandResult(exitCode: 0, output: (reversed ? aliases.reversed().map { $0 } : aliases).joined(separator: "\n")),
                ADBCommandResult(exitCode: 0, output: "adb-A-guid _adb-tls-connect._tcp 1.2.3.4:1\nadb-A-guid (2) _adb-tls-connect._tcp 1.2.3.4:2"),
                ADBCommandResult(exitCode: 0, output: "A"), ADBCommandResult(exitCode: 0, output: ""),
                ADBCommandResult(exitCode: 0, output: "A"), ADBCommandResult(exitCode: 0, output: ""),
                ADBCommandResult(exitCode: 0, output: "A"), ADBCommandResult(exitCode: 0, output: "")
            ])
            let devices = try await AndroidDeviceDiscovery(executor: executor, bookmarkStore: store).discoverDevices(for: .android)
            XCTAssertEqual(devices.count, 1); XCTAssertEqual(devices.first?.endpoint.address, "1.2.3.4:2")
            XCTAssertEqual(devices.first?.endpoint.identifier, "adb-A-guid (2)._adb-tls-connect._tcp")
        }
    }

}
