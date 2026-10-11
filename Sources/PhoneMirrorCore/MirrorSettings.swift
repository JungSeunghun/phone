import Foundation

public struct SavedWindowPlacement: Codable, Equatable, Sendable {
    public var x: Double, y: Double, width: Double, height: Double
    public init(x: Double, y: Double, width: Double, height: Double) { self.x = x; self.y = y; self.width = width; self.height = height }
    public func validated() -> Self {
        Self(x: x.isFinite && (-100000...100000).contains(x) ? x : 0,
             y: y.isFinite && (-100000...100000).contains(y) ? y : 0,
             width: width.isFinite && (940...4096).contains(width) ? width : 1060,
             height: height.isFinite && (700...2160).contains(height) ? height : 780)
    }
}

public struct MirrorSettings: Codable, Equatable, Sendable {
    public static let allowedVideoDimensions = [1280, 1920, 2560]
    public static let allowedFrameRates = [30, 60]
    public var videoMaxDimension = 1920
    public var videoMaxFrameRate = 60
    public var audioEnabled = true
    public var controlEnabled = true
    public var keepScreenAwake = true
    public var alwaysOnTop = false
    public var autoReconnectEnabled = true
    public var preferredPlatform: PhonePlatform = .android
    public var windowPlacement: SavedWindowPlacement?
    private var preferredDeviceIDs: [String: String] = [:]
    public init() {}
    public func preferredDeviceID(for platform: PhonePlatform) -> String? { preferredDeviceIDs[platform.rawValue] }
    public mutating func rememberDevice(_ device: DeviceIdentity) {
        preferredDeviceIDs[device.platform.rawValue] = device.isValid ? device.id : nil
    }
    public mutating func rememberDevice(_ target: ConnectionTarget) {
        guard target.isValid else { return }; preferredDeviceIDs[target.identity.platform.rawValue] = target.selectionID
    }
    public func validated() -> Self {
        var copy = self
        if !Self.allowedVideoDimensions.contains(copy.videoMaxDimension) { copy.videoMaxDimension = 1920 }
        if !Self.allowedFrameRates.contains(copy.videoMaxFrameRate) { copy.videoMaxFrameRate = 60 }
        copy.windowPlacement = windowPlacement?.validated()
        copy.preferredDeviceIDs = preferredDeviceIDs.filter { key, value in
            guard let platform = PhonePlatform(rawValue: key) else { return false }
            return ConnectionTarget.isValidSelectionID(value, platform: platform)
        }
        return copy
    }
    private enum CodingKeys: String, CodingKey {
        case videoMaxDimension, videoMaxFrameRate, audioEnabled, controlEnabled, keepScreenAwake, alwaysOnTop
        case autoReconnectEnabled, preferredPlatform, windowPlacement, preferredDeviceIDs
    }
    public init(from decoder: Decoder) throws {
        self.init()
        let fields = try decoder.container(keyedBy: CodingKeys.self)
        videoMaxDimension = (try? fields.decode(Int.self, forKey: .videoMaxDimension)) ?? videoMaxDimension
        videoMaxFrameRate = (try? fields.decode(Int.self, forKey: .videoMaxFrameRate)) ?? videoMaxFrameRate
        audioEnabled = (try? fields.decode(Bool.self, forKey: .audioEnabled)) ?? audioEnabled
        controlEnabled = (try? fields.decode(Bool.self, forKey: .controlEnabled)) ?? controlEnabled
        keepScreenAwake = (try? fields.decode(Bool.self, forKey: .keepScreenAwake)) ?? keepScreenAwake
        alwaysOnTop = (try? fields.decode(Bool.self, forKey: .alwaysOnTop)) ?? alwaysOnTop
        autoReconnectEnabled = (try? fields.decode(Bool.self, forKey: .autoReconnectEnabled)) ?? autoReconnectEnabled
        preferredPlatform = (try? fields.decode(PhonePlatform.self, forKey: .preferredPlatform)) ?? preferredPlatform
        windowPlacement = try? fields.decode(SavedWindowPlacement.self, forKey: .windowPlacement)
        preferredDeviceIDs = (try? fields.decode([String: String].self, forKey: .preferredDeviceIDs)) ?? [:]
        self = validated()
    }
}

public enum SettingsCodec {
    private struct Document: Codable { let version: Int; let settings: MirrorSettings }
    public static func encode(_ settings: MirrorSettings) throws -> Data {
        try JSONEncoder().encode(Document(version: 1, settings: settings.validated()))
    }
    public static func decode(_ data: Data) throws -> MirrorSettings {
        let document = try JSONDecoder().decode(Document.self, from: data)
        guard document.version == 1 else { throw CocoaError(.coderReadCorrupt) }
        return document.settings.validated()
    }
}
