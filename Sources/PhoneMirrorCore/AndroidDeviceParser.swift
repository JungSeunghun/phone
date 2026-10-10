import Foundation

public enum AndroidDeviceParser {
    public static func parse(_ output: String) -> [PhoneDevice] {
        var seen = Set<String>()
        return output.split(whereSeparator: \.isNewline).compactMap { line in
            let fields = line.split(whereSeparator: \.isWhitespace).map(String.init)
            guard fields.count >= 2, !fields[0].hasPrefix("emulator-"), !fields[0].contains(":"), !fields[0].contains("._tcp") else { return nil }
            let identity = DeviceIdentity(platform: .android, id: fields[0])
            guard identity.isValid, !seen.contains(identity.id) else { return nil }
            let availability: DeviceAvailability
            switch fields[1] { case "device": availability = .ready; case "unauthorized": availability = .unauthorized; case "offline": availability = .offline; default: return nil }
            seen.insert(identity.id)
            let name = fields.first { $0.hasPrefix("model:") }.map { String($0.dropFirst(6)).replacingOccurrences(of: "_", with: " ") }
            return PhoneDevice(identity: identity, name: name.flatMap { $0.isEmpty ? nil : $0 } ?? "Android", availability: availability)
        }
    }
}
