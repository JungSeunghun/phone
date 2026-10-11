import XCTest
@testable import PhoneMirrorCore

final class WirelessDomainTests: XCTestCase {
    func testEndpointPortBoundariesAndCanonicalAddresses() {
        for port in [1, 65535] {
            XCTAssertEqual(WirelessEndpoint(address: "192.168.0.44:\(port)")?.port, port)
            XCTAssertEqual(WirelessEndpoint(address: "[2001:db8::1]:\(port)")?.port, port)
        }
        XCTAssertEqual(WirelessEndpoint(address: " 192.168.0.44:00001 ")?.address, "192.168.0.44:1")
        for value in ["", "192.168.0.44", "192.168.0.44:0", "192.168.0.44:65536", "192.168.0.44:-1", "192.168.0.44:+1", "256.1.1.1:22", "1.2.3:22", "01.2.3.4:22", "[invalid]:1", "2001:db8::1:22", "host;rm:22", "1.2.3.4:２２", "1.2.3.4:1\nother", String(repeating: "x", count: 1024)] {
            XCTAssertNil(WirelessEndpoint(address: value), value)
        }
    }
    func testPairingCodeAcceptsExactlySixASCIIDigits() {
        for code in ["000000", "999999", "123456"] { XCTAssertTrue(WirelessPairingRequest.isValidCode(code)) }
        for code in ["", "12345", "1234567", "１２３４５６", "123 45", "123456\n", "abcdef"] { XCTAssertFalse(WirelessPairingRequest.isValidCode(code)) }
        XCTAssertNil(WirelessPairingRequest(address: "192.168.0.44:0", code: "123456"))
        XCTAssertNotNil(WirelessPairingRequest(address: "192.168.0.44:1", code: "000000"))
    }
    func testMDNSDiscoverySeparatesPairingAndConnectionPorts() {
        let services = ADBServiceParser.parse("""
        List of discovered mdns services
        adb-A-guid _adb-tls-pairing._tcp 192.168.0.44:43315
        adb-A-guid _adb-tls-connect._tcp. 192.168.0.44:40001
        adb-A-guid _adb-tls-connect._tcp 192.168.0.44:40001
        old _adb._tcp 192.168.0.44:5555
        broken _adb-tls-connect._tcp 1.2.3.4:0
        """)
        XCTAssertEqual(services.count, 2)
        XCTAssertEqual(services.map(\.kind), [.pairing, .connection])
        XCTAssertEqual(services.map(\.endpoint.port), [43315, 40001])
        XCTAssertTrue(ADBServiceParser.parse("malformed\nA unknown 1.2.3.4:1").isEmpty)
    }
    func testTransportParserKeepsUSBAndWirelessAndExcludesEmulators() {
        let transports = AndroidDeviceParser.parseTransports("""
        A device usb:1 model:Galaxy_S24
        192.168.0.44:40001 device model:Galaxy_S24
        adb-A-guid._adb-tls-connect._tcp device
        B unauthorized usb:2
        emulator-5554 device
        invalid:70000 device
        """)
        XCTAssertEqual(transports.count, 4)
        XCTAssertEqual(transports.map(\.transport), [.usb, .wifi, .wifi, .usb])
        XCTAssertEqual(transports[0].name, "Galaxy S24")
        XCTAssertEqual(transports[3].availability, .unauthorized)
    }
    func testStableIdentityAndTransportAreSeparateFromMutableAddress() {
        let identity = DeviceIdentity(platform: .android, id: "A")
        let usb = PhoneDevice(identity: identity, name: "A", availability: .ready)
        let first = PhoneDevice(identity: identity, name: "A", availability: .ready, endpoint: DeviceEndpoint(transport: .wifi, address: "192.168.0.44:1"))
        let moved = PhoneDevice(identity: identity, name: "A", availability: .ready, endpoint: DeviceEndpoint(transport: .wifi, address: "192.168.0.99:65535"))
        XCTAssertEqual(first.identity, moved.identity); XCTAssertEqual(first.id, moved.id); XCTAssertEqual(first.target, moved.target)
        XCTAssertNotEqual(usb.id, first.id); XCTAssertNotEqual(usb.target, first.target)
        XCTAssertTrue(usb.status.contains("USB")); XCTAssertTrue(first.status.contains("Wi-Fi"))
        var policy = ReconnectionPolicy(); policy.userStarted(first.target); policy.streamEnded(at: 100)
        XCTAssertNil(policy.nextAttempt(devices: [usb.target: .ready], at: 101))
        XCTAssertEqual(policy.nextAttempt(devices: [moved.target: .ready], at: 101), moved.target)
    }
    func testBookmarkStorePersistsIdentityButNeverEndpointOrPairingCode() throws {
        let suite = "WirelessTests." + UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let store = UserDefaultsWirelessDeviceStore(defaults: defaults)
        let bookmark = WirelessDeviceBookmark(identity: DeviceIdentity(platform: .android, id: "A"), name: "Galaxy", serviceName: "adb-A-guid")
        try store.save([bookmark]); XCTAssertEqual(UserDefaultsWirelessDeviceStore(defaults: defaults).load(), [bookmark])
        let data = defaults.data(forKey: UserDefaultsWirelessDeviceStore.storageKey)!
        let text = String(decoding: data, as: UTF8.self)
        XCTAssertFalse(text.contains("pairingCode")); XCTAssertFalse(text.contains("address"))
        defaults.set(Data("broken".utf8), forKey: UserDefaultsWirelessDeviceStore.storageKey); XCTAssertTrue(store.load().isEmpty)
    }
    func testMaximumLengthWirelessSelectionPersistsWithoutChangingPhysicalIDLimit() throws {
        let target = ConnectionTarget(identity: DeviceIdentity(platform: .android, id: String(repeating: "A", count: 256)), transport: .wifi)
        var settings = MirrorSettings(); settings.rememberDevice(target)
        XCTAssertEqual(try SettingsCodec.decode(SettingsCodec.encode(settings)).preferredDeviceID(for: .android), target.selectionID)
    }
    func testBookmarkValidationRejectsMalformedAndUnsupportedRecords() throws {
        for id in ["", String(repeating: "A", count: 257), "A\nB"] {
            XCTAssertFalse(WirelessDeviceBookmark(identity: DeviceIdentity(platform: .android, id: id), name: "A", serviceName: "adb-A-guid").isValid)
        }
        for service in ["", "adb-", "adb-A-guid ", "adb-A\0guid", String(repeating: "A", count: 257)] {
            XCTAssertFalse(WirelessDeviceBookmark(identity: DeviceIdentity(platform: .android, id: "A"), name: "A", serviceName: service).isValid)
        }
        XCTAssertFalse(WirelessDeviceBookmark(identity: DeviceIdentity(platform: .iOS, id: "A"), name: "A", serviceName: "adb-A-guid").isValid)
    }

    func testBonjourCollisionSuffixAndSpacedTransportIdentifiers() {
        let services = ADBServiceParser.parse("adb-A-guid (2)\t_adb-tls-connect._tcp\t1.2.3.4:2")
        XCTAssertEqual(services.first?.name, "adb-A-guid (2)")
        let transports = AndroidDeviceParser.parseTransports("adb-A-guid (2)._adb-tls-connect._tcp device model:Galaxy")
        XCTAssertEqual(transports.first?.identifier, "adb-A-guid (2)._adb-tls-connect._tcp")
        XCTAssertTrue(WirelessDeviceBookmark(identity: DeviceIdentity(platform: .android, id: "A"), name: "Galaxy", serviceName: "adb-A-guid (2)").isValid)
    }

}
