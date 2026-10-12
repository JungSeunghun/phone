import Foundation

public enum ApplicationLanguage: String, CaseIterable, Sendable {
    case korean = "ko"
    case english = "en"

    public var displayName: String { self == .korean ? "한국어" : "English" }
    private static let messages: [String: String] = {
        #if SWIFT_PACKAGE
        let resourceBundle = Bundle.main.resourceURL?.appendingPathComponent("PhoneMirrorLocalization_PhoneMirrorLocalization.bundle")
        let bundle = resourceBundle.flatMap { Bundle(url: $0) } ?? Bundle.module
        #else
        let bundle = Bundle.main
        #endif
        guard let url = bundle.url(forResource: "EnglishMessages", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let messages = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return messages
    }()
    private static let placeholderExpression = try! NSRegularExpression(pattern: "\\{([0-9]+)\\}")
    private static let templates: [(NSRegularExpression, String)] = messages.compactMap { key, value in
        guard key.contains("{0}") else { return nil }
        let parts = key.components(separatedBy: placeholderExpression)
        let pattern = "^" + parts.map(NSRegularExpression.escapedPattern(for:)).joined(separator: "([\\s\\S]*?)") + "$"
        guard let expression = try? NSRegularExpression(pattern: pattern) else { return nil }
        return (expression, value)
    }
    /// Apply only to app-owned copy. User names, input, and connection codes are never translated.
    public func translate(_ text: String) -> String {
        guard self == .english else { return text }
        if let translated = Self.messages[text] { return translated }
        let range = NSRange(text.startIndex..., in: text)
        for (expression, translation) in Self.templates {
            guard let match = expression.firstMatch(in: text, range: range) else { continue }
            let result = NSMutableString(string: translation)
            let placeholders = Self.placeholderExpression.matches(in: translation, range: NSRange(translation.startIndex..., in: translation))
            for placeholder in placeholders.reversed() {
                let identifier = (translation as NSString).substring(with: placeholder.range(at: 1))
                guard let index = Int(identifier), index + 1 < match.numberOfRanges,
                      let capture = Range(match.range(at: index + 1), in: text) else { continue }
                result.replaceCharacters(in: placeholder.range, with: String(text[capture]))
            }
            return result as String
        }
        return text
    }
}

public struct ApplicationLanguagePreferences {
    public static let storageKey = "phoneMirror.applicationLanguage.v1"
    private let defaults: UserDefaults
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }
    public func load() -> ApplicationLanguage {
        ApplicationLanguage(rawValue: defaults.string(forKey: Self.storageKey) ?? "") ?? .korean
    }
    public func save(_ language: ApplicationLanguage) { defaults.set(language.rawValue, forKey: Self.storageKey) }
}

private extension String {
    func components(separatedBy expression: NSRegularExpression) -> [String] {
        var start = startIndex
        var parts: [String] = []
        for match in expression.matches(in: self, range: NSRange(startIndex..., in: self)) {
            guard let range = Range(match.range, in: self) else { continue }
            parts.append(String(self[start..<range.lowerBound])); start = range.upperBound
        }
        parts.append(String(self[start...])); return parts
    }
}
