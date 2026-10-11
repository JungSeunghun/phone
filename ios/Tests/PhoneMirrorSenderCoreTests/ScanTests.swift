import XCTest

@testable import PhoneMirrorSenderCore

final class ScanTests: XCTestCase {
  func testPermissionCancellationAndLateCallbacks() throws {
    var scan = SenderConnectionScanState()
    let first = scan.begin()
    scan.cancel()
    XCTAssertFalse(scan.completePermission(token: first, granted: true))
    XCTAssertNil(
      scan.receive(token: first, payload: "PMU1|1|" + String(repeating: "ab", count: 32)))
    let second = scan.begin()
    XCTAssertFalse(scan.completePermission(token: first, granted: true))
    XCTAssertFalse(scan.completePermission(token: second, granted: false))
    XCTAssertEqual(scan.phase, .denied)
    XCTAssertNil(scan.receive(token: second, payload: "invalid"))
    let third = scan.begin()
    XCTAssertTrue(scan.completePermission(token: third, granted: true))
    XCTAssertFalse(scan.completePermission(token: third, granted: true))
    scan.fail(token: second)
    XCTAssertEqual(scan.phase, .scanning)
    scan.fail(token: third)
    XCTAssertEqual(scan.phase, .unavailable)
  }
  func testValidationDuplicateScanAndPersistedCode() throws {
    let defaults = UserDefaults(suiteName: "scan-test-" + UUID().uuidString)!
    defer { defaults.removeObject(forKey: "senderPreferences.v1") }
    for code in ["PMU1|1|", "PMU1|65535|", "PMW1|192.168.0.44:43315|", "PMW1|[::1]:1|"] {
      let payload = code + String(repeating: "ab", count: 32)
      var scan = SenderConnectionScanState()
      let token = scan.begin()
      XCTAssertNil(scan.receive(token: token, payload: payload))
      XCTAssertTrue(scan.completePermission(token: token, granted: true))
      for invalid in [
        "", "https://example.com", "PMU1|0|" + String(repeating: "ab", count: 32),
        String(repeating: "a", count: 257),
      ] {
        XCTAssertNil(scan.receive(token: token, payload: invalid))
        XCTAssertEqual(scan.phase, .scanning)
      }
      XCTAssertEqual(
        scan.receive(
          token: token, payload: String(repeating: " ", count: 256 - payload.utf8.count) + payload),
        payload)
      XCTAssertEqual(scan.phase, .accepted)
      XCTAssertNil(scan.receive(token: token, payload: payload))
      XCTAssertNil(defaults.data(forKey: "senderPreferences.v1"))
      let preferences = try SenderPreferences(
        connectionCode: payload, deviceId: UUID().uuidString, deviceName: "Mock iPhone",
        dimension: 1920, frameRate: 30, audio: true)
      try preferences.save(defaults)
      XCTAssertEqual(try SenderPreferences.load(defaults).connectionCode, payload)
      defaults.removeObject(forKey: "senderPreferences.v1")
      defaults.set(Data("corrupt".utf8), forKey: "senderPreferences.v1")
      XCTAssertThrowsError(try SenderPreferences.load(defaults))
      defaults.removeObject(forKey: "senderPreferences.v1")
    }
  }
}
