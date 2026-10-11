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

public enum ConnectionTransport: String, Codable, Sendable {
    case usb, wifi
    public var displayName: String { self == .usb ? "USB" : "Wi-Fi" }
}
public struct DeviceEndpoint: Equatable, Sendable {
    public let transport: ConnectionTransport
    public let address: String
    public let identifier: String
    public init(transport: ConnectionTransport, address: String, identifier: String? = nil) { self.transport = transport; self.address = address; self.identifier = identifier ?? address }
}
public struct ConnectionTarget: Hashable, Sendable {
    public let identity: DeviceIdentity
    public let transport: ConnectionTransport
    public var isValid: Bool { identity.isValid && (transport == .usb || identity.platform == .android) }
    public static func isValidSelectionID(_ id: String, platform: PhonePlatform) -> Bool {
        if platform == .android && id.hasPrefix("wifi:") { return DeviceIdentity(platform: platform, id: String(id.dropFirst(5))).isValid }
        return DeviceIdentity(platform: platform, id: id).isValid
    }
    public var selectionID: String { transport == .usb ? identity.id : "wifi:" + identity.id }
    public init(identity: DeviceIdentity, transport: ConnectionTransport) { self.identity = identity; self.transport = transport }
}
public struct PhoneDevice: Identifiable, Equatable, Sendable {
    public let identity: DeviceIdentity
    public let name: String
    public let availability: DeviceAvailability
    public let endpoint: DeviceEndpoint
    public var target: ConnectionTarget { ConnectionTarget(identity: identity, transport: endpoint.transport) }
    public var id: String { target.selectionID }
    public init(identity: DeviceIdentity, name: String, availability: DeviceAvailability, endpoint: DeviceEndpoint? = nil) {
        self.identity = identity; self.name = name; self.availability = availability
        self.endpoint = endpoint ?? DeviceEndpoint(transport: .usb, address: identity.id)
    }
    public var status: String {
        switch availability {
        case .ready: return "\(endpoint.transport.displayName) 연결됨"
        case .unauthorized: return "\(endpoint.transport.displayName) 디버깅 승인 필요"
        case .offline: return "\(endpoint.transport.displayName) 연결 응답 없음"
        }
    }
}
