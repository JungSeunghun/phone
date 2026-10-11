import Foundation

public struct WirelessDeviceBookmark: Codable, Equatable, Sendable {
    public let identity: DeviceIdentity
    public let name: String
    public let serviceName: String
    public init(identity: DeviceIdentity, name: String, serviceName: String) { self.identity = identity; self.name = name; self.serviceName = serviceName }
    public func matchesServiceName(_ candidate: String) -> Bool {
        candidate == serviceName || candidate.hasPrefix("adb-" + identity.id + "-")
    }
    public var isValid: Bool {
        identity.platform == .android && identity.isValid && serviceName.hasPrefix("adb-") && serviceName.count > 4 && serviceName.count <= 256 && serviceName == serviceName.trimmingCharacters(in: .whitespacesAndNewlines) && !serviceName.unicodeScalars.contains(where: { CharacterSet.controlCharacters.contains($0) })
    }
}
public protocol WirelessDeviceStore {
    func load() -> [WirelessDeviceBookmark]
    func save(_ bookmarks: [WirelessDeviceBookmark]) throws
}
public final class UserDefaultsWirelessDeviceStore: WirelessDeviceStore {
    public static let storageKey = "phoneMirror.wirelessDevices.v1"
    private let defaults: UserDefaults
    public init(defaults: UserDefaults = .standard) { self.defaults = defaults }
    public func load() -> [WirelessDeviceBookmark] {
        guard let data = defaults.data(forKey: Self.storageKey), let values = try? JSONDecoder().decode([WirelessDeviceBookmark].self, from: data) else { return [] }
        return values.filter(\.isValid)
    }
    public func save(_ bookmarks: [WirelessDeviceBookmark]) throws { defaults.set(try JSONEncoder().encode(bookmarks.filter(\.isValid)), forKey: Self.storageKey) }
}
