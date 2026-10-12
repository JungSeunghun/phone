import XCTest
import PhoneMirrorLocalization

final class ApplicationLanguageTests: XCTestCase {
  func testSenderAndKeyboardUseTheSameSavedLanguageWithoutChangingCodes() {
    let suite = UUID().uuidString
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    defaults.set("existing-code", forKey: "keyboardConnectionCode.v1")
    let sender = ApplicationLanguagePreferences(defaults: defaults)
    XCTAssertEqual(sender.load(), .korean)
    sender.save(.english)
    let keyboard = ApplicationLanguagePreferences(defaults: UserDefaults(suiteName: suite)!)
    XCTAssertEqual(keyboard.load(), .english)
    XCTAssertEqual(keyboard.load().translate("컴퓨터 키보드 입력"), "Computer keyboard input")
    XCTAssertEqual(defaults.string(forKey: "keyboardConnectionCode.v1"), "existing-code")
    defaults.set("invalid", forKey: ApplicationLanguagePreferences.storageKey)
    XCTAssertEqual(sender.load(), .korean)
  }
}
