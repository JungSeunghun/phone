import CryptoKit
import Darwin
import Foundation

public enum SenderError: Error {
  case invalidCode, invalidPacket, overflow, invalidSettings, inactive
}
public enum SenderTransport: Equatable { case wifi, usb }
public struct SenderConnectionCode {
  public let transport: SenderTransport
  public let host: String
  public let port: UInt16
  public let secret: Data
  public init(_ input: String) throws {
    let parts = input.trimmingCharacters(in: .whitespacesAndNewlines).split(
      separator: "|", omittingEmptySubsequences: false)
    guard parts.count == 3, parts[0] == "PMW1" || parts[0] == "PMU1", input.utf8.count <= 256 else {
      throw SenderError.invalidCode
    }
    if parts[0] == "PMU1" {
      guard !parts[1].isEmpty, parts[1].utf8.allSatisfy({ (48...57).contains($0) }),
        let port = UInt16(parts[1]), port > 0,
        parts[2].count == 64, let secret = Data(hex: String(parts[2]))
      else { throw SenderError.invalidCode }
      transport = .usb
      host = "127.0.0.1"
      self.port = port
      self.secret = secret
      return
    }
    transport = .wifi
    let endpoint = String(parts[1])
    guard let colon = endpoint.lastIndex(of: ":"),
      !endpoint[endpoint.index(after: colon)...].isEmpty,
      endpoint[endpoint.index(after: colon)...].utf8.allSatisfy({ (48...57).contains($0) }),
      let port = UInt16(endpoint[endpoint.index(after: colon)...]), port > 0
    else { throw SenderError.invalidCode }
    let original = String(endpoint[..<colon])
    let bracketed = original.hasPrefix("[") && original.hasSuffix("]")
    let host = bracketed ? String(original.dropFirst().dropLast()) : original
    var address4 = in_addr()
    var address6 = in6_addr()
    let valid = host.withCString { p in
      bracketed ? inet_pton(AF_INET6, p, &address6) == 1 : inet_pton(AF_INET, p, &address4) == 1
    }
    guard valid, parts[2].count == 64, let secret = Data(hex: String(parts[2])) else {
      throw SenderError.invalidCode
    }
    self.host = host
    self.port = port
    self.secret = secret
  }
}
extension Data {
  public init?(hex: String) {
    guard hex.count % 2 == 0 else { return nil }
    var data = Data()
    var i = hex.startIndex
    while i < hex.endIndex {
      let j = hex.index(i, offsetBy: 2)
      guard let byte = UInt8(hex[i..<j], radix: 16) else { return nil }
      data.append(byte)
      i = j
    }
    self = data
  }
  public var hex: String { map { String(format: "%02x", $0) }.joined() }
  public mutating func appendInteger<T: FixedWidthInteger>(_ value: T) {
    var big = value.bigEndian
    Swift.withUnsafeBytes(of: &big) { append(contentsOf: $0) }
  }
}
public final class SenderPacketCipher {
  private let key: SymmetricKey
  public private(set) var counter: UInt64 = 0
  public init(secret: Data, challenge: Data) throws {
    guard secret.count == 32, challenge.count == 16 else { throw SenderError.invalidCode }
    key = HKDF<SHA256>.deriveKey(
      inputKeyMaterial: SymmetricKey(data: secret), salt: challenge,
      info: Data("PhoneMirrorWiFi/v1".utf8), outputByteCount: 32)
  }
  public func seal(kind: UInt8, payload: Data) throws -> Data {
    guard (1...4).contains(kind), payload.count <= 4 * 1024 * 1024, counter < UInt64.max else {
      throw SenderError.invalidPacket
    }
    var header = Data()
    header.appendInteger(UInt32(payload.count + 25))
    header.appendInteger(counter)
    var nonce = Data(repeating: 0, count: 4)
    nonce.appendInteger(counter)
    var plain = Data([kind])
    plain.append(payload)
    let box = try AES.GCM.seal(
      plain, using: key, nonce: AES.GCM.Nonce(data: nonce), authenticating: header)
    header.append(box.ciphertext)
    header.append(box.tag)
    counter += 1
    return header
  }
}
public final class SenderSendBudget {
  private let limit: Int
  private var used = 0
  private let lock = NSLock()
  public init(limit: Int = 4 * 1024 * 1024) { self.limit = max(0, limit) }
  public func reserve(_ size: Int) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    guard size > 0, size <= limit - used else { return false }
    used += size
    return true
  }
  public func release(_ size: Int) {
    lock.lock()
    defer { lock.unlock() }
    if size > 0, size <= used { used -= size }
  }
}
public struct SenderCaptureSettings: Codable {
  public let dimension: Int
  public let frameRate: Int
  public init(dimension: Int = 1920, frameRate: Int = 30) throws {
    guard [720, 1280, 1920].contains(dimension), [15, 30, 60].contains(frameRate) else {
      throw SenderError.invalidSettings
    }
    self.dimension = dimension
    self.frameRate = frameRate
  }
  public func dimensions(width: Int, height: Int) throws -> (width: Int, height: Int) {
    guard (1...8192).contains(width), (1...8192).contains(height) else {
      throw SenderError.invalidSettings
    }
    let scale = min(1, Double(dimension) / Double(max(width, height)))
    return (max(2, Int(Double(width) * scale) & ~1), max(2, Int(Double(height) * scale) & ~1))
  }
}
public struct SenderLifecycle {
  private var generation: UInt64 = 0
  private var active = false
  public init() {}
  public mutating func start() -> UInt64? {
    guard !active else { return nil }
    generation &+= 1
    active = true
    return generation
  }
  public mutating func stop() {
    generation &+= 1
    active = false
  }
  public func isCurrent(_ token: UInt64) -> Bool { active && token == generation }
}
public struct SenderHello: Encodable {
  public let version = 1
  public let deviceId: String
  public let name: String
  public let audio: Bool
  public init(deviceId: String, name: String, audio: Bool) {
    self.deviceId = deviceId
    self.name = String(name.unicodeScalars.prefix(80))
    self.audio = audio
  }
}
public func senderMediaPacket(
  payload: Data, timestamp: UInt64, configuration: Bool = false, keyFrame: Bool = false
) throws -> Data {
  guard !payload.isEmpty, payload.count <= 4 * 1024 * 1024 - 12, timestamp < 1 << 53 else {
    throw SenderError.invalidPacket
  }
  var packet = Data()
  packet.appendInteger(timestamp | (configuration ? 1 << 62 : 0) | (keyFrame ? 1 << 61 : 0))
  packet.appendInteger(UInt32(payload.count))
  packet.append(payload)
  return packet
}
