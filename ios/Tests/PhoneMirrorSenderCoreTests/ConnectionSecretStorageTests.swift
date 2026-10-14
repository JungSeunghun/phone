import Foundation
import XCTest

@testable import PhoneMirrorSenderCore

final class TestConnectionSecretStore: ConnectionSecretStore {
  var values: [String: Data] = [:]
  var failRead = false
  var failWrite = false
  func load(forKey key: String) throws -> Data? {
    if failRead { throw SenderError.invalidCode }
    return values[key]
  }
  func save(_ data: Data, forKey key: String) throws {
    if failWrite { throw SenderError.invalidCode }
    values[key] = data
  }
}

final class ConnectionSecretStorageTests: XCTestCase {
  func testMigrationValidatesAndRemovesLegacyOnlyAfterSuccessfulSecureWrite() throws {
    let name = "migration-" + UUID().uuidString
    let defaults = UserDefaults(suiteName: name)!
    defer { defaults.removePersistentDomain(forName: name) }
    let secrets = TestConnectionSecretStore()
    let code = "PMW1|127.0.0.1:65535|" + String(repeating: "ab", count: 32)
    let preferences = try SenderPreferences(
      connectionCode: code, deviceId: UUID().uuidString,
      deviceName: "Test", dimension: 720, frameRate: 30, audio: false)
    let legacy = try JSONEncoder().encode(preferences)
    defaults.set(legacy, forKey: "senderPreferences.v1")
    let keyboard = "PMK1|" + code.dropFirst(5)
    defaults.set(keyboard, forKey: "keyboardConnectionCode.v1")
    secrets.failWrite = true
    XCTAssertThrowsError(try SenderPreferences.load(defaults, secrets: secrets))
    XCTAssertThrowsError(try KeyboardConnectionCode.load(defaults, secrets: secrets))
    XCTAssertEqual(defaults.data(forKey: "senderPreferences.v1"), legacy)
    XCTAssertEqual(defaults.string(forKey: "keyboardConnectionCode.v1"), keyboard)
    XCTAssertTrue(secrets.values.isEmpty)
    secrets.failWrite = false
    for _ in 0..<2 {
      XCTAssertEqual(try SenderPreferences.load(defaults, secrets: secrets).connectionCode, code)
      XCTAssertEqual(try KeyboardConnectionCode.load(defaults, secrets: secrets).rawValue, keyboard)
      XCTAssertNil(defaults.object(forKey: "senderPreferences.v1"))
      XCTAssertNil(defaults.object(forKey: "keyboardConnectionCode.v1"))
    }
    secrets.failRead = true
    XCTAssertThrowsError(try SenderPreferences.load(defaults, secrets: secrets))
    XCTAssertThrowsError(try KeyboardConnectionCode.load(defaults, secrets: secrets))
  }
  func testLegacyValuesCannotReplaceExistingSecureCodesOrBypassReadFailure() throws {
    let name = "precedence-" + UUID().uuidString
    let defaults = UserDefaults(suiteName: name)!
    defer { defaults.removePersistentDomain(forName: name) }
    let secrets = TestConnectionSecretStore()
    let original = "PMW1|127.0.0.1:1|" + String(repeating: "ab", count: 32)
    let replacement = "PMW1|127.0.0.1:2|" + String(repeating: "cd", count: 32)
    let preferences = try SenderPreferences(
      connectionCode: original, deviceId: UUID().uuidString,
      deviceName: "Test", dimension: 720, frameRate: 30, audio: false)
    try preferences.save(defaults, secrets: secrets)
    let keyboard = try KeyboardConnectionCode("PMK1|" + original.dropFirst(5))
    try keyboard.save(defaults, secrets: secrets)
    let legacy = try SenderPreferences(
      connectionCode: replacement, deviceId: UUID().uuidString,
      deviceName: "Old", dimension: 720, frameRate: 30, audio: false)
    defaults.set(try JSONEncoder().encode(legacy), forKey: "senderPreferences.v1")
    defaults.set("PMK1|" + replacement.dropFirst(5), forKey: "keyboardConnectionCode.v1")
    XCTAssertEqual(try SenderPreferences.load(defaults, secrets: secrets).connectionCode, original)
    XCTAssertEqual(
      try KeyboardConnectionCode.load(defaults, secrets: secrets).rawValue, keyboard.rawValue)
    XCTAssertNil(defaults.object(forKey: "senderPreferences.v1"))
    XCTAssertNil(defaults.object(forKey: "keyboardConnectionCode.v1"))
    defaults.set(try JSONEncoder().encode(legacy), forKey: "senderPreferences.v1")
    defaults.set("PMK1|" + replacement.dropFirst(5), forKey: "keyboardConnectionCode.v1")
    secrets.failRead = true
    XCTAssertThrowsError(try SenderPreferences.load(defaults, secrets: secrets))
    XCTAssertThrowsError(try KeyboardConnectionCode.load(defaults, secrets: secrets))
  }
  func testMissingCorruptSecureValuesAndFailedSavesNeverFallBackToDefaults() throws {
    let name = "corrupt-" + UUID().uuidString
    let defaults = UserDefaults(suiteName: name)!
    defer { defaults.removePersistentDomain(forName: name) }
    let secrets = TestConnectionSecretStore()
    XCTAssertThrowsError(try SenderPreferences.load(defaults, secrets: secrets))
    XCTAssertThrowsError(try KeyboardConnectionCode.load(defaults, secrets: secrets))
    secrets.values["senderPreferences.v1"] = Data("{}".utf8)
    secrets.values["keyboardConnectionCode.v1"] = Data([0xff])
    XCTAssertThrowsError(try SenderPreferences.load(defaults, secrets: secrets))
    XCTAssertThrowsError(try KeyboardConnectionCode.load(defaults, secrets: secrets))
    defaults.set("corrupt", forKey: "keyboardConnectionCode.v1")
    XCTAssertThrowsError(try KeyboardConnectionCode.load(defaults, secrets: secrets))
    XCTAssertEqual(secrets.values["keyboardConnectionCode.v1"], Data([0xff]))
    defaults.removeObject(forKey: "keyboardConnectionCode.v1")
    secrets.failWrite = true
    let keyboard = try KeyboardConnectionCode(
      "PMK1|127.0.0.1:1|" + String(repeating: "ab", count: 32))
    XCTAssertThrowsError(try keyboard.save(defaults, secrets: secrets))
    XCTAssertNil(defaults.object(forKey: "keyboardConnectionCode.v1"))
  }
}
