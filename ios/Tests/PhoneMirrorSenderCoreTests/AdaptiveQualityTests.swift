import CoreVideo
import XCTest

@testable import PhoneMirrorSenderCore

final class AdaptiveQualityTests: XCTestCase {
  func testSustainedPressureCooldownAndRecovery() {
    var policy = SenderAdaptiveQualityPolicy()
    XCTAssertNil(policy.observe(nowMilliseconds: 1000, sendMilliseconds: 200))
    XCTAssertNil(policy.observe(nowMilliseconds: 2000, sendMilliseconds: 200))
    XCTAssertEqual(policy.observe(nowMilliseconds: 3000, sendMilliseconds: 200), 3_000_000)
    XCTAssertNil(policy.observe(nowMilliseconds: 3000, sendMilliseconds: 200))
    XCTAssertNil(policy.observe(nowMilliseconds: 18000, sendMilliseconds: .nan))
    for time in 19000...21000 {
      if time % 1000 == 0 {
        _ = policy.observe(nowMilliseconds: Double(time), sendMilliseconds: 200)
      }
    }
    XCTAssertEqual(policy.bitRate, 1_500_000)
    for time in stride(from: 22000, through: 70000, by: 1000) {
      _ = policy.observe(nowMilliseconds: Double(time), sendMilliseconds: 10)
    }
    XCTAssertGreaterThan(policy.bitRate, 1_500_000)
    XCTAssertLessThanOrEqual(policy.bitRate, 6_000_000)
  }
}
extension AdaptiveQualityTests {
  func testLegacyPreferencesAndEncoderBounds() throws {
    let defaults = UserDefaults(suiteName: "adaptive-" + UUID().uuidString)!
    defer { defaults.removeObject(forKey: "senderPreferences.v1") }
    let preferences = try SenderPreferences(
      connectionCode: "PMW1|127.0.0.1:1|" + String(repeating: "ab", count: 32),
      deviceId: UUID().uuidString, deviceName: "Mock iPhone", dimension: 1920, frameRate: 30,
      audio: true, adaptiveQuality: false)
    try preferences.save(defaults)
    XCTAssertEqual(try SenderPreferences.load(defaults).adaptiveQuality, false)
    var old =
      try JSONSerialization.jsonObject(with: defaults.data(forKey: "senderPreferences.v1")!)
      as! [String: Any]
    old.removeValue(forKey: "adaptiveQuality")
    defaults.set(try JSONSerialization.data(withJSONObject: old), forKey: "senderPreferences.v1")
    XCTAssertEqual(try SenderPreferences.load(defaults).adaptiveQuality, true)
    old["adaptiveQuality"] = "corrupt"
    defaults.set(try JSONSerialization.data(withJSONObject: old), forKey: "senderPreferences.v1")
    XCTAssertThrowsError(try SenderPreferences.load(defaults))
    let encoder = SenderVideoEncoder(
      settings: try SenderCaptureSettings(dimension: 1920, frameRate: 30), output: { _ in },
      failure: { XCTFail("encoding failed") })
    for rate in [1_500_000, 3_000_000, 6_000_000] {
      try encoder.setBitRate(rate)
      XCTAssertEqual(encoder.bitRate, rate)
    }
    for rate in [-1, 0, 1_499_999, 6_000_001, Int.max] {
      XCTAssertThrowsError(try encoder.setBitRate(rate))
    }
  }
}

extension AdaptiveQualityTests {
  func testActiveNativeEncoderAcceptsBitRateChangeWithoutRecreation() throws {
    var pixel: CVPixelBuffer?
    XCTAssertEqual(
      CVPixelBufferCreate(
        nil, 64, 32, kCVPixelFormatType_32BGRA,
        [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pixel), kCVReturnSuccess)
    let encoder = SenderVideoEncoder(
      settings: try SenderCaptureSettings(dimension: 720, frameRate: 30), output: { _ in },
      failure: { XCTFail("native encoder failed") })
    try encoder.encode(pixel!, timestamp: 0)
    try encoder.setBitRate(3_000_000)
    try encoder.encode(pixel!, timestamp: 40000)
    XCTAssertEqual(encoder.bitRate, 3_000_000)
    encoder.finish()
  }
}
