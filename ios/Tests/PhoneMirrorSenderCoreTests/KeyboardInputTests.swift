import XCTest

@testable import PhoneMirrorSenderCore

final class KeyboardInputTests: XCTestCase {
  func testSetupRejectsRepeatedPreparationAndLateCompletionAfterCancellation() throws {
    let code = "PMK1|127.0.0.1:1|" + String(repeating: "ab", count: 32)
    var setup = KeyboardSetupState()
    let first = try setup.prepare(code)
    XCTAssertTrue(setup.isCurrent(first))
    XCTAssertThrowsError(try setup.prepare(code))
    XCTAssertTrue(setup.isCurrent(first))
    setup.invalidate()
    XCTAssertFalse(setup.checking)
    XCTAssertFalse(setup.isCurrent(first))
    let second = try setup.prepare(code)
    XCTAssertTrue(setup.isCurrent(second))
    XCTAssertFalse(setup.isCurrent(first))
    setup.invalidate()
    XCTAssertThrowsError(try setup.prepare("corrupt"))
    XCTAssertFalse(setup.checking)
  }
  func testCodeValidationAndPersistence() throws {
    let code = "PMK1|127.0.0.1:65535|" + String(repeating: "ab", count: 32)
    XCTAssertEqual(try KeyboardConnectionCode(code).endpoint.port, 65535)
    for invalid in [
      "", code.replacingOccurrences(of: "65535", with: "0"),
      code.replacingOccurrences(of: "PMK1", with: "PMW1"),
    ] {
      XCTAssertThrowsError(try KeyboardConnectionCode(invalid))
    }
    let defaults = UserDefaults(suiteName: UUID().uuidString)!
    let secrets = TestConnectionSecretStore()
    XCTAssertThrowsError(try KeyboardConnectionCode.load(defaults, secrets: secrets))
    try KeyboardConnectionCode(code).save(defaults, secrets: secrets)
    XCTAssertEqual(try KeyboardConnectionCode.load(defaults, secrets: secrets).rawValue, code)
    secrets.values.removeValue(forKey: "keyboardConnectionCode.v1")
    defaults.set("corrupt", forKey: "keyboardConnectionCode.v1")
    XCTAssertThrowsError(try KeyboardConnectionCode.load(defaults, secrets: secrets))
  }
  func testEncryptedUnicodeAndReplayRejection() throws {
    let secret = Data(repeating: 1, count: 32)
    let challenge = Data(repeating: 2, count: 16)
    let sender = try KeyboardPacketCipher(
      secret: secret, challenge: challenge, direction: "desktop")
    let receiver = try KeyboardPacketCipher(
      secret: secret, challenge: challenge, direction: "desktop")
    let text = "한日中ع😀e\u{301}\n"
    let frame = try sender.seal(Data(text.utf8))
    XCTAssertEqual(try receiver.open(frame), Data(text.utf8))
    XCTAssertThrowsError(try receiver.open(frame))
    let wrong = try KeyboardPacketCipher(
      secret: secret, challenge: challenge, direction: "keyboard")
    XCTAssertThrowsError(try wrong.open(frame))
    XCTAssertThrowsError(try sender.seal(Data()))
    XCTAssertThrowsError(try receiver.open(Data([0])))
  }
  func testCommandValidationAndEditing() throws {
    let target = FakeKeyboardDocument()
    let text = "한日中ع😀e\u{301}\n"
    try KeyboardInputCommand.decode(Data("{\"kind\":\"paste\",\"text\":\"한日中ع😀\"}".utf8)).apply(
      to: target)
    XCTAssertEqual(target.text, "한日中ع😀")
    try KeyboardInputCommand.paste(text).apply(to: target)
    try KeyboardInputCommand.key("backspace").apply(to: target)
    try KeyboardInputCommand.key("left").apply(to: target)
    try KeyboardInputCommand.key("delete").apply(to: target)
    XCTAssertEqual(target.deleted, 1)
    XCTAssertEqual(target.offsets, [-1])
    XCTAssertEqual(target.forwardDeleted, 1)
    for invalid in ["", "\u{0}", String(repeating: "x", count: 262131)] {
      XCTAssertThrowsError(try KeyboardInputCommand.paste(invalid).apply(to: target))
    }
    XCTAssertNoThrow(
      try KeyboardInputCommand.paste(String(repeating: "x", count: 262130)).apply(to: target))
    XCTAssertThrowsError(try KeyboardInputCommand.key("up").apply(to: target))
    XCTAssertThrowsError(try KeyboardInputCommand.decode(Data("{\"kind\":\"touch\"}".utf8)))
    XCTAssertThrowsError(
      try KeyboardInputCommand.decode(
        Data("{\"kind\":\"paste\",\"text\":\"x\",\"extra\":\"x\"}".utf8)))
  }
}
private final class FakeKeyboardDocument: KeyboardTextDocument {
  var text = "", deleted = 0, forwardDeleted = 0, offsets: [Int] = []
  func insertText(_ text: String) { self.text += text }
  func deleteBackward() { deleted += 1 }
  func deleteForward() { forwardDeleted += 1 }
  func adjustTextPosition(byCharacterOffset offset: Int) { offsets.append(offset) }
}
