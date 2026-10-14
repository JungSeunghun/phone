import Foundation
import Security

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
  public static func load(
    _ defaults: UserDefaults, secrets: ConnectionSecretStore = KeychainConnectionSecretStore()
  ) throws -> SenderPreferences {
    let secured = try secrets.load(forKey: "senderPreferences.v1")
    let legacy = defaults.data(forKey: "senderPreferences.v1")
    guard let data = secured ?? legacy else {
      throw SenderError.invalidCode
    }
    let v = try JSONDecoder().decode(Self.self, from: data)
    let validated = try Self(
      connectionCode: v.connectionCode, deviceId: v.deviceId, deviceName: v.deviceName,
      dimension: v.dimension, frameRate: v.frameRate, audio: v.audio,
      adaptiveQuality: v.adaptiveQuality ?? true)
    if secured == nil {
      try validated.save(defaults, secrets: secrets)
    } else {
      defaults.removeObject(forKey: "senderPreferences.v1")
    }
    return validated
  }
  public func save(
    _ defaults: UserDefaults, secrets: ConnectionSecretStore = KeychainConnectionSecretStore()
  ) throws {
    try secrets.save(JSONEncoder().encode(self), forKey: "senderPreferences.v1")
    defaults.removeObject(forKey: "senderPreferences.v1")
  }
}

/// Injected storage keeps migration and validation independent of Keychain and extension entitlements.
public protocol ConnectionSecretStore {
  func load(forKey key: String) throws -> Data?
  func save(_ data: Data, forKey key: String) throws
}

public struct KeychainConnectionSecretStore: ConnectionSecretStore {
  private let service: String
  public init(service: String = "local.phone.sender.connection-secrets") { self.service = service }
  private func query(_ key: String) -> [String: Any] {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service, kSecAttrAccount as String: key,
      kSecAttrSynchronizable as String: false,
      kSecUseDataProtectionKeychain as String: true,
    ]
    #if os(iOS)
      // Registered App Groups are also Keychain access groups, shared by all three targets.
      query[kSecAttrAccessGroup as String] = SenderSharedContainer.identifier
    #endif
    return query
  }
  public func load(forKey key: String) throws -> Data? {
    var query = query(key)
    query[kSecReturnData as String] = true
    query[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecItemNotFound { return nil }
    guard status == errSecSuccess, let data = result as? Data else {
      throw ConnectionSecretStorageError(status: status)
    }
    return data
  }
  public func save(_ data: Data, forKey key: String) throws {
    let query = query(key)
    let attributes: [String: Any] = [
      kSecValueData as String: data,
      // Broadcast/keyboard extensions may run in the background; never sync or migrate to another device.
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
    ]
    var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
      status = SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil)
      if status == errSecDuplicateItem {
        status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
      }
    }
    guard status == errSecSuccess else { throw ConnectionSecretStorageError(status: status) }
  }
}
public struct ConnectionSecretStorageError: LocalizedError {
  public let status: OSStatus
  public var errorDescription: String? { "연결 코드를 안전하게 저장하거나 읽을 수 없습니다. (\(status))" }
}
