import XCTest

@testable import PhoneMirrorSenderCore

final class ConnectionTests: XCTestCase {
  func testConnectionCodeBoundaries() throws {
    let secret = String(repeating: "a", count: 64)
    let code = try SenderConnectionCode("PMW1|192.168.0.2:65535|\(secret)")
    XCTAssertEqual(code.host, "192.168.0.2")
    XCTAssertEqual(code.port, 65535)
    XCTAssertEqual(try SenderConnectionCode("PMW1|[::1]:1|\(secret)").port, 1)
    for endpoint in [
      "192.168.0.2:0", "192.168.0.2:65536", "example.com:12", "256.1.1.1:12", "1.2.3.4:abc",
      "[1.2.3.4]:12",
    ] { XCTAssertThrowsError(try SenderConnectionCode("PMW1|\(endpoint)|\(secret)")) }
    for text in [
      "", "PMW2|1.2.3.4:1|\(secret)", "PMW1|1.2.3.4:1|abc",
      "PMW1|1.2.3.4:1|\(String(repeating:"z",count:64))",
    ] { XCTAssertThrowsError(try SenderConnectionCode(text)) }
  }
  func testEncryptedPacketCounterBudgetAndTamper() throws {
    let secret = Data(repeating: 7, count: 32)
    let challenge = Data(repeating: 9, count: 16)
    let writer = try SenderPacketCipher(secret: secret, challenge: challenge)
    let first = try writer.seal(kind: 1, payload: Data("hello".utf8))
    XCTAssertEqual(first.count, 34)
    XCTAssertEqual(writer.counter, 1)
    XCTAssertNotEqual(first, try writer.seal(kind: 1, payload: Data("hello".utf8)))
    XCTAssertThrowsError(try writer.seal(kind: 9, payload: Data()))
    XCTAssertThrowsError(try SenderPacketCipher(secret: Data(), challenge: challenge))
    let b = SenderSendBudget(limit: 10)
    XCTAssertTrue(b.reserve(10))
    XCTAssertFalse(b.reserve(1))
    XCTAssertFalse(b.reserve(Int.max))
    b.release(11)
    XCTAssertFalse(b.reserve(1))
    b.release(10)
    XCTAssertTrue(b.reserve(1))
  }
  func testCaptureSettingsAndLifecycleLateCompletion() throws {
    XCTAssertThrowsError(try SenderCaptureSettings(dimension: 0, frameRate: 30))
    XCTAssertThrowsError(try SenderCaptureSettings(dimension: 1920, frameRate: 31))
    let settings = try SenderCaptureSettings(dimension: 720, frameRate: 60)
    XCTAssertEqual(try settings.dimensions(width: 1920, height: 1080).width, 720)
    XCTAssertEqual(try settings.dimensions(width: 1, height: 8192).width, 2)
    XCTAssertThrowsError(try settings.dimensions(width: 8193, height: 1))
    var state = SenderLifecycle()
    let old = state.start()
    XCTAssertNil(state.start())
    state.stop()
    XCTAssertFalse(state.isCurrent(old!))
    XCTAssertNotNil(state.start())
  }
}
