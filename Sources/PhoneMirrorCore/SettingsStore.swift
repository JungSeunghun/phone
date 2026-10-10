import Foundation

public protocol SettingsStore {
    func load() -> MirrorSettings
    func save(_ settings: MirrorSettings) throws
}

public final class UserDefaultsSettingsStore: SettingsStore {
    public static let storageKey = "phoneMirror.settings.v1"
    private let defaults: UserDefaults
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }
    public func load() -> MirrorSettings {
        guard let data = defaults.data(forKey: Self.storageKey), let settings = try? SettingsCodec.decode(data) else { return MirrorSettings() }
        return settings
    }
    public func save(_ settings: MirrorSettings) throws { defaults.set(try SettingsCodec.encode(settings), forKey: Self.storageKey) }
}
