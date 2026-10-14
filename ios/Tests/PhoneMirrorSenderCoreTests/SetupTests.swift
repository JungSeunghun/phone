import XCTest

@testable import PhoneMirrorSenderCore

final class SetupTests: XCTestCase {
  func testSetupRequiresNetworkConfirmationAndIgnoresLateCallbacks() throws {
    var setup = SenderSetupState()
    XCTAssertFalse(setup.canBroadcast)
    XCTAssertThrowsError(try setup.prepare(code: "bad"))
    let code = "PMW1|127.0.0.1:1|" + String(repeating: "a", count: 64)
    let token = try setup.prepare(code: code)
    XCTAssertFalse(setup.canBroadcast)
    setup.invalidate()
    setup.complete(token: token, connected: true)
    XCTAssertFalse(setup.canBroadcast)
    let second = try setup.prepare(code: code)
    setup.complete(token: second, connected: false)
    XCTAssertFalse(setup.canBroadcast)
    let third = try setup.prepare(code: code)
    setup.complete(token: third, connected: true)
    XCTAssertTrue(setup.canBroadcast)
    setup.invalidate()
    XCTAssertFalse(setup.canBroadcast)
  }
  func testConnectionSecretsAreNotSavedInDefaults() throws {
    let name = "secure-storage-" + UUID().uuidString
    let defaults = UserDefaults(suiteName: name)!
    let secrets = TestConnectionSecretStore()
    defer { defaults.removePersistentDomain(forName: name) }
    let code = "PMW1|127.0.0.1:1|" + String(repeating: "ab", count: 32)
    let preferences = try SenderPreferences(
      connectionCode: code, deviceId: UUID().uuidString,
      deviceName: "Test", dimension: 720, frameRate: 30, audio: false)
    try preferences.save(defaults, secrets: secrets)
    XCTAssertNil(defaults.object(forKey: "senderPreferences.v1"))
    try KeyboardConnectionCode("PMK1|" + code.dropFirst(5)).save(defaults, secrets: secrets)
    XCTAssertNil(defaults.object(forKey: "keyboardConnectionCode.v1"))
  }
  func testRetryBoundsAndReset() {
    var retry = SenderRetryPolicy()
    for delay in [1, 2, 4, 8, 16] { XCTAssertEqual(retry.nextDelay(), delay) }
    XCTAssertNil(retry.nextDelay())
    retry.reset()
    XCTAssertEqual(retry.nextDelay(), 1)
  }
}
