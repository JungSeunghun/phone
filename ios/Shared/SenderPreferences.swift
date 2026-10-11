import Foundation

public enum SenderSharedContainer { public static let identifier = "group.local.phone.sender" }
public struct SenderPreferences: Codable {
  public let connectionCode: String
  public let deviceId: String
  public let deviceName: String
  public let dimension: Int
  public let frameRate: Int
  public let adaptiveQuality: Bool?
  public let audio: Bool
  public init(
    connectionCode: String, deviceId: String, deviceName: String, dimension: Int, frameRate: Int,
    audio: Bool, adaptiveQuality: Bool = true
  ) throws {
    _ = try SenderConnectionCode(connectionCode)
    _ = try SenderCaptureSettings(dimension: dimension, frameRate: frameRate)
    guard UUID(uuidString: deviceId) != nil, !deviceName.isEmpty,
      deviceName.unicodeScalars.count <= 80,
      deviceName.trimmingCharacters(in: .whitespacesAndNewlines) == deviceName,
      !deviceName.unicodeScalars.contains(where: CharacterSet.controlCharacters.contains)
    else { throw SenderError.invalidCode }
    self.connectionCode = connectionCode
    self.deviceId = deviceId
    self.deviceName = deviceName
    self.dimension = dimension
    self.frameRate = frameRate
    self.audio = audio
    self.adaptiveQuality = adaptiveQuality
  }
  public static func load(_ defaults: UserDefaults) throws -> SenderPreferences {
    guard let data = defaults.data(forKey: "senderPreferences.v1") else {
      throw SenderError.invalidCode
    }
    let v = try JSONDecoder().decode(Self.self, from: data)
    return try Self(
      connectionCode: v.connectionCode, deviceId: v.deviceId, deviceName: v.deviceName,
      dimension: v.dimension, frameRate: v.frameRate, audio: v.audio,
      adaptiveQuality: v.adaptiveQuality ?? true)
  }
  public func save(_ defaults: UserDefaults) throws {
    defaults.set(try JSONEncoder().encode(self), forKey: "senderPreferences.v1")
  }
}
