import XCTest

@testable import PhoneMirrorSenderCore

final class UsbTests: XCTestCase {
  func testUsbCodeAndBoundaries() throws {
    let key = String(repeating: "ab", count: 32)
    for port in [1, 27483, 65535] {
      let code = try SenderConnectionCode("PMU1|\(port)|\(key)")
      XCTAssertEqual(code.transport, .usb)
      XCTAssertEqual(code.port, UInt16(port))
      XCTAssertEqual(code.host, "127.0.0.1")
    }
    for port in ["0", "65536", "-1", "1.0", "a", ""] {
      XCTAssertThrowsError(try SenderConnectionCode("PMU1|\(port)|\(key)"))
    }
    XCTAssertEqual(try SenderConnectionCode("PMW1|127.0.0.1:1|\(key)").transport, .wifi)
    XCTAssertThrowsError(try SenderConnectionCode("PMU1|27483|bad"))
  }
}
