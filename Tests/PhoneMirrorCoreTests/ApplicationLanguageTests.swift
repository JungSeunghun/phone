import XCTest
import PhoneMirrorLocalization
@testable import PhoneMirrorCore

final class ApplicationLanguageTests: XCTestCase {
    func testMissingCorruptAndUnsupportedPreferencesFallBackToKorean() {
        for value: Any? in [nil, "", "ja", 42, "EN"] {
            let suite = UUID().uuidString
            let defaults = UserDefaults(suiteName: suite)!
            defer { defaults.removePersistentDomain(forName: suite) }
            defaults.set(value, forKey: ApplicationLanguagePreferences.storageKey)
            XCTAssertEqual(ApplicationLanguagePreferences(defaults: defaults).load(), .korean)
        }
    }
    func testLanguageIsSavedIndependentlyOfMirrorSettings() {
        let suite = UUID().uuidString
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        defaults.set(Data([1, 2]), forKey: UserDefaultsSettingsStore.storageKey)
        let preferences = ApplicationLanguagePreferences(defaults: defaults)
        preferences.save(.english)
        XCTAssertEqual(preferences.load(), .english)
        preferences.save(.english)
        preferences.save(.korean)
        XCTAssertEqual(preferences.load(), .korean)
        XCTAssertEqual(defaults.data(forKey: UserDefaultsSettingsStore.storageKey), Data([1, 2]))
    }
    func testTranslationAndParametersPreserveUserData() {
        XCTAssertEqual(ApplicationLanguage.english.translate("연결된 기기"), "Connected devices")
        XCTAssertEqual(ApplicationLanguage.korean.translate("연결된 기기"), "연결된 기기")
        XCTAssertEqual(ApplicationLanguage.english.translate("설정 저장 실패: disk error"), "Could not save settings: disk error")
        XCTAssertEqual(ApplicationLanguage.english.translate("Unknown device"), "Unknown device")
    }
    func testTemplateValuesAreNotReinterpretedAndBroadcastErrorsAreTranslated() {
        XCTAssertEqual(ApplicationLanguage.english.translate("영상 크기: value{1} × 2"), "Video size: value{1} × 2")
        XCTAssertEqual(ApplicationLanguage.english.translate("영상을 인코딩할 수 없습니다."), "Could not encode video.")
    }

}
