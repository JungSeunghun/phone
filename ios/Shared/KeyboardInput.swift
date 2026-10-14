import CryptoKit
import Foundation

public struct KeyboardConnectionCode {
  public let rawValue: String
  public let endpoint: SenderConnectionCode
  public init(_ value: String) throws {
    let value = value.trimmingCharacters(in: .whitespacesAndNewlines)
    guard value.hasPrefix("PMK1|") else { throw SenderError.invalidCode }
    endpoint = try SenderConnectionCode("PMW1|" + value.dropFirst(5))
    rawValue = value
  }
  public static func load(
    _ defaults: UserDefaults, secrets: ConnectionSecretStore = KeychainConnectionSecretStore()
  ) throws -> Self {
    let secured = try secrets.load(forKey: "keyboardConnectionCode.v1")
    let legacy = defaults.string(forKey: "keyboardConnectionCode.v1")
    let stored = secured ?? legacy.map { Data($0.utf8) }
    guard let stored, let value = String(data: stored, encoding: .utf8) else {
      throw SenderError.invalidCode
    }
    let validated = try Self(value)
    if secured == nil {
      try validated.save(defaults, secrets: secrets)
    } else {
      defaults.removeObject(forKey: "keyboardConnectionCode.v1")
    }
    return validated
  }
  public func save(
    _ defaults: UserDefaults, secrets: ConnectionSecretStore = KeychainConnectionSecretStore()
  ) throws {
    try secrets.save(Data(rawValue.utf8), forKey: "keyboardConnectionCode.v1")
    defaults.removeObject(forKey: "keyboardConnectionCode.v1")
  }
}
public struct KeyboardSetupState {
  private var generation: UInt64 = 0
  public private(set) var checking = false
  public init() {}
  public mutating func prepare(_ code: String) throws -> UInt64 {
    _ = try KeyboardConnectionCode(code)
    guard !checking else { throw SenderError.inactive }
    generation &+= 1
    checking = true
    return generation
  }
  public func isCurrent(_ token: UInt64) -> Bool { checking && token == generation }
  public mutating func invalidate() {
    generation &+= 1
    checking = false
  }
}
public final class KeyboardPacketCipher {
  private let key: SymmetricKey
  private var counter: UInt64 = 0
  public init(secret: Data, challenge: Data, direction: String) throws {
    guard secret.count == 32, challenge.count == 16, ["desktop", "keyboard"].contains(direction)
    else { throw SenderError.invalidCode }
    key = HKDF<SHA256>.deriveKey(
      inputKeyMaterial: SymmetricKey(data: secret), salt: challenge,
      info: Data("PhoneMirrorKeyboard/v1/\(direction)".utf8), outputByteCount: 32)
  }
  public func seal(_ payload: Data) throws -> Data {
    guard !payload.isEmpty, payload.count <= 2 * 1024 * 1024 - 24, counter < UInt64.max else {
      throw SenderError.invalidPacket
    }
    var header = Data()
    header.appendInteger(UInt32(payload.count + 24))
    header.appendInteger(counter)
    var nonce = Data(repeating: 0, count: 4)
    nonce.appendInteger(counter)
    let box = try AES.GCM.seal(
      payload, using: key, nonce: AES.GCM.Nonce(data: nonce), authenticating: header)
    header.append(box.ciphertext)
    header.append(box.tag)
    counter += 1
    return header
  }
  public func open(_ frame: Data) throws -> Data {
    guard frame.count >= 29, frame.count <= 2 * 1024 * 1024 + 4, counter < UInt64.max else {
      throw SenderError.invalidPacket
    }
    let size = frame.prefix(4).reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
    let sequence = frame.dropFirst(4).prefix(8).reduce(UInt64(0)) { ($0 << 8) | UInt64($1) }
    guard Int(size) == frame.count - 4, sequence == counter else { throw SenderError.invalidPacket }
    var nonce = Data(repeating: 0, count: 4)
    nonce.appendInteger(counter)
    let box = try AES.GCM.SealedBox(
      nonce: AES.GCM.Nonce(data: nonce), ciphertext: frame.dropFirst(12).dropLast(16),
      tag: frame.suffix(16))
    let payload = try AES.GCM.open(box, using: key, authenticating: frame.prefix(12))
    counter += 1
    return payload
  }
}
public protocol KeyboardTextDocument: AnyObject {
  func insertText(_ text: String)
  func deleteBackward()
  func deleteForward()
  func adjustTextPosition(byCharacterOffset offset: Int)
}
public enum KeyboardInputCommand {
  case paste(String)
  case key(String)
  public static func decode(_ data: Data) throws -> Self {
    guard let object = try JSONSerialization.jsonObject(with: data) as? [String: String] else {
      throw SenderError.invalidPacket
    }
    switch object["kind"] {
    case "paste":
      guard object.count == 2, let text = object["text"] else { throw SenderError.invalidPacket }
      return .paste(text)
    case "key":
      guard object.count == 2, let key = object["key"] else { throw SenderError.invalidPacket }
      return .key(key)
    default: throw SenderError.invalidPacket
    }
  }
  public func apply(to document: KeyboardTextDocument) throws {
    switch self {
    case .paste(let text):
      guard !text.isEmpty, !text.contains("\0"), text.utf8.count <= 262130 else {
        throw SenderError.invalidPacket
      }
      document.insertText(text)
    case .key(let key):
      switch key {
      case "backspace": document.deleteBackward()
      case "delete": document.deleteForward()
      case "enter": document.insertText("\n")
      case "left": document.adjustTextPosition(byCharacterOffset: -1)
      case "right": document.adjustTextPosition(byCharacterOffset: 1)
      default: throw SenderError.invalidPacket
      }
    }
  }
}
