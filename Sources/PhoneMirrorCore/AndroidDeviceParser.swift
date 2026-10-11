import Foundation

public enum AndroidDeviceParser {
    public static func parseUSBDevices(_ output: String) -> [PhoneDevice] {
        parseTransports(output).filter { $0.transport == .usb }.map {
            PhoneDevice(identity: DeviceIdentity(platform: .android, id: $0.identifier), name: $0.name, availability: $0.availability)
        }
    }
}

public struct AndroidDeviceTransport: Equatable, Sendable {
    public let identifier: String
    public let name: String
    public let availability: DeviceAvailability
    public let transport: ConnectionTransport
}
extension AndroidDeviceParser {
    public static func parseTransports(_ output: String) -> [AndroidDeviceTransport] {
        var seen = Set<String>()
        return output.split(whereSeparator: \.isNewline).compactMap { line in
            let fields = line.split(whereSeparator: \.isWhitespace).map(String.init)
            guard let stateIndex = fields.firstIndex(where: { ["device", "unauthorized", "offline"].contains($0) }), stateIndex > 0 else { return nil }
            let address = fields[..<stateIndex].joined(separator: " ")
            guard !address.hasPrefix("emulator-"), address.count <= 256 else { return nil }
            let availability: DeviceAvailability
            switch fields[stateIndex] { case "device": availability = .ready; case "unauthorized": availability = .unauthorized; case "offline": availability = .offline; default: return nil }
            let transport: ConnectionTransport
            if WirelessEndpoint(address: address) != nil || address.hasSuffix("._adb-tls-connect._tcp") || address.hasSuffix("._adb-tls-connect._tcp.") { transport = .wifi }
            else { guard !address.contains(":"), !address.contains("._tcp"), DeviceIdentity(platform: .android, id: address).isValid else { return nil }; transport = .usb }
            guard seen.insert(address).inserted else { return nil }
            let name = fields.first { $0.hasPrefix("model:") }.map { String($0.dropFirst(6)).replacingOccurrences(of: "_", with: " ") } ?? "Android"
            return AndroidDeviceTransport(identifier: address, name: name, availability: availability, transport: transport)
        }
    }
}
