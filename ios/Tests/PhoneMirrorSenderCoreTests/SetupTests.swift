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
  func testRetryBoundsAndReset() {
    var retry = SenderRetryPolicy()
    for delay in [1, 2, 4, 8, 16] { XCTAssertEqual(retry.nextDelay(), delay) }
    XCTAssertNil(retry.nextDelay())
    retry.reset()
    XCTAssertEqual(retry.nextDelay(), 1)
  }
}
