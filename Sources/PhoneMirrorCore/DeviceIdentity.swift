import Foundation

public enum PhonePlatform: String, Codable, CaseIterable, Sendable {
    case android, iOS
    public var displayName: String { self == .android ? "Android" : "iPhone / iPad" }
}

public struct DeviceIdentity: Codable, Hashable, Sendable {
    public let platform: PhonePlatform
    public let id: String
    public init(platform: PhonePlatform, id: String) { self.platform = platform; self.id = id }
    public var isValid: Bool {
        !id.isEmpty && id.count <= 256 && id == id.trimmingCharacters(in: .whitespacesAndNewlines)
            && !id.unicodeScalars.contains { CharacterSet.controlCharacters.contains($0) }
    }
}

public enum DeviceAvailability: String, Codable, Sendable { case ready, unauthorized, offline }

public struct PhoneDevice: Identifiable, Equatable, Sendable {
    public let identity: DeviceIdentity
    public let name: String
    public let availability: DeviceAvailability
    public var id: String { identity.id }
    public init(identity: DeviceIdentity, name: String, availability: DeviceAvailability) {
        self.identity = identity; self.name = name; self.availability = availability
    }
    public var status: String {
        switch availability {
        case .ready: return "USB 연결됨"
        case .unauthorized: return "USB 디버깅 승인 필요"
        case .offline: return "연결 응답 없음"
        }
    }
}
