import Foundation
import Darwin

public struct WirelessEndpoint: Hashable, Sendable {
    public let host: String
    public let port: Int
    public var address: String { "\(host.contains(":") ? "[\(host)]" : host):\(port)" }
    public init?(address: String) {
        let value = address.trimmingCharacters(in: .whitespacesAndNewlines)
        guard value.count <= 128, !value.contains(where: \.isWhitespace) else { return nil }
        let host: String, portText: String
        if value.hasPrefix("[") {
            guard let bracket = value.firstIndex(of: "]"), value[value.index(after: bracket)...].hasPrefix(":") else { return nil }
            host = String(value[value.index(after: value.startIndex)..<bracket]); portText = String(value[value.index(bracket, offsetBy: 2)...])
            var bytes = in6_addr()
            guard host.withCString({ inet_pton(AF_INET6, $0, &bytes) }) == 1 else { return nil }
        } else {
            let fields = value.split(separator: ":", omittingEmptySubsequences: false)
            guard fields.count == 2 else { return nil }
            host = String(fields[0]); portText = String(fields[1])
            let octets = host.split(separator: ".", omittingEmptySubsequences: false)
            guard octets.count == 4, octets.allSatisfy({ !$0.isEmpty && ($0.count == 1 || !$0.hasPrefix("0")) && $0.utf8.allSatisfy({ (48...57).contains($0) }) }) else { return nil }
            var bytes = in_addr()
            guard host.withCString({ inet_pton(AF_INET, $0, &bytes) }) == 1 else { return nil }
        }
        guard !portText.isEmpty, portText.utf8.allSatisfy({ (48...57).contains($0) }), let port = Int(portText), (1...65535).contains(port) else { return nil }
        self.host = host; self.port = port
    }
}
public struct WirelessPairingRequest: Sendable {
    public let endpoint: WirelessEndpoint
    public let code: String
    public init?(address: String, code: String) {
        guard let endpoint = WirelessEndpoint(address: address), Self.isValidCode(code) else { return nil }
        self.endpoint = endpoint; self.code = code
    }
    public static func isValidCode(_ code: String) -> Bool { code.utf8.count == 6 && code.utf8.allSatisfy { (48...57).contains($0) } }
}
public enum WirelessServiceKind: String, Sendable { case pairing, connection }
public struct WirelessService: Identifiable, Equatable, Sendable {
    public let name: String
    public let kind: WirelessServiceKind
    public let endpoint: WirelessEndpoint
    public var instanceNumber: Int {
        guard let suffix = name.split(separator: " ").last, suffix.hasPrefix("("), suffix.hasSuffix(")"), let number = Int(suffix.dropFirst().dropLast()), number >= 2 else { return 0 }
        return number
    }
    public func matchesIdentifier(_ identifier: String) -> Bool {
        identifier == endpoint.address || identifier == name + "._adb-tls-connect._tcp" || identifier == name + "._adb-tls-connect._tcp."
    }
    public var id: String { "\(name)|\(kind.rawValue)|\(endpoint.address)" }
    public init(name: String, kind: WirelessServiceKind, endpoint: WirelessEndpoint) { self.name = name; self.kind = kind; self.endpoint = endpoint }
}
public enum ADBServiceParser {
    public static func parse(_ output: String) -> [WirelessService] {
        var seen = Set<String>()
        return output.split(whereSeparator: \.isNewline).compactMap { line in
            let fields = line.split(whereSeparator: \.isWhitespace).map(String.init)
            guard fields.count >= 3, let endpoint = WirelessEndpoint(address: fields.last!) else { return nil }
            let name = fields.dropLast(2).joined(separator: " ")
            guard !name.isEmpty, name.count <= 256 else { return nil }
            let kind: WirelessServiceKind
            switch fields[fields.count - 2].trimmingCharacters(in: CharacterSet(charactersIn: ".")) {
            case "_adb-tls-pairing._tcp": kind = .pairing
            case "_adb-tls-connect._tcp": kind = .connection
            default: return nil
            }
            let service = WirelessService(name: name, kind: kind, endpoint: endpoint)
            return seen.insert(service.id).inserted ? service : nil
        }
    }
}
