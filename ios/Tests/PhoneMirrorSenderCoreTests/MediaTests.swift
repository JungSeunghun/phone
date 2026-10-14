import AVFoundation
import CoreMedia
import CoreVideo
import CryptoKit
import XCTest

@testable import PhoneMirrorSenderCore

final class MediaTests: XCTestCase {
  func testStrictPortsAndPreferences() throws {
    let secret = String(repeating: "a", count: 64)
    for port in ["+1", " 1", "-1", "１"] {
      XCTAssertThrowsError(try SenderConnectionCode("PMW1|1.2.3.4:\(port)|\(secret)"))
    }
    let name = "PhoneMirrorSender.test.\(UUID())"
    let defaults = UserDefaults(suiteName: name)!
    let secrets = TestConnectionSecretStore()
    defer { defaults.removePersistentDomain(forName: name) }
    XCTAssertThrowsError(try SenderPreferences.load(defaults, secrets: secrets))
    secrets.values.removeValue(forKey: "senderPreferences.v1")
    defaults.set(Data("{".utf8), forKey: "senderPreferences.v1")
    XCTAssertThrowsError(try SenderPreferences.load(defaults, secrets: secrets))
    for name in ["", " iPhone", "iPhone ", "iPhone\n", String(repeating: "a", count: 81)] {
      XCTAssertThrowsError(
        try SenderPreferences(
          connectionCode: "PMW1|1.2.3.4:1|" + secret, deviceId: UUID().uuidString, deviceName: name,
          dimension: 720, frameRate: 30, audio: true))
    }
    let p = try SenderPreferences(
      connectionCode: "PMW1|1.2.3.4:65535|\(secret)", deviceId: UUID().uuidString,
      deviceName: "iPhone", dimension: 720, frameRate: 60, audio: false)
    try p.save(defaults, secrets: secrets)
    XCTAssertEqual(try SenderPreferences.load(defaults, secrets: secrets).frameRate, 60)
    var json = try JSONSerialization.jsonObject(with: JSONEncoder().encode(p)) as! [String: Any]
    json["dimension"] = 0
    secrets.values.removeValue(forKey: "senderPreferences.v1")
    defaults.set(try JSONSerialization.data(withJSONObject: json), forKey: "senderPreferences.v1")
    XCTAssertThrowsError(try SenderPreferences.load(defaults, secrets: secrets))
  }
  func testEncryptionAuthenticationAndGoldenVector() throws {
    let secret = Data(repeating: 7, count: 32)
    let challenge = Data(repeating: 9, count: 16)
    let writer = try SenderPacketCipher(secret: secret, challenge: challenge)
    let frame = try writer.seal(kind: 1, payload: Data("hello".utf8))
    let key = HKDF<SHA256>.deriveKey(
      inputKeyMaterial: SymmetricKey(data: secret), salt: challenge,
      info: Data("PhoneMirrorWiFi/v1".utf8), outputByteCount: 32)
    let box = try AES.GCM.SealedBox(
      nonce: AES.GCM.Nonce(data: Data(repeating: 0, count: 12)),
      ciphertext: frame[12..<frame.count - 16], tag: frame.suffix(16))
    XCTAssertEqual(
      try AES.GCM.open(box, using: key, authenticating: frame.prefix(12)),
      Data([1]) + Data("hello".utf8))
    XCTAssertThrowsError(
      try AES.GCM.open(
        box, using: SymmetricKey(data: Data(repeating: 0, count: 32)),
        authenticating: frame.prefix(12)))
    var tamper = Data(frame.prefix(12))
    tamper[0] = 1
    XCTAssertThrowsError(try AES.GCM.open(box, using: key, authenticating: tamper))
    XCTAssertEqual(
      frame.hex, "0000001e0000000000000000c070c2fc9d4c39462c8bc76ebfb93aa89cbc8b8412d2")
    try frame.hex.write(
      to: URL(fileURLWithPath: "/tmp/phone-ios-wifi-golden.txt"), atomically: true, encoding: .utf8)
  }
  func testNativeVideoEncoderProducesConfigurationAndKeyFrame() throws {
    var pixel: CVPixelBuffer?
    XCTAssertEqual(
      CVPixelBufferCreate(
        nil, 64, 32, kCVPixelFormatType_32BGRA,
        [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pixel), kCVReturnSuccess)
    let lock = NSLock()
    var packets: [Data] = []
    let encoder = SenderVideoEncoder(
      settings: try SenderCaptureSettings(dimension: 720, frameRate: 30),
      output: {
        lock.lock()
        packets.append($0)
        lock.unlock()
      }, failure: { XCTFail("encoder failure") })
    XCTAssertThrowsError(try encoder.encode(pixel!, timestamp: 0, orientation: 9))
    try encoder.encode(pixel!, timestamp: 0)
    try encoder.encode(pixel!, timestamp: 40_000, orientation: 6)
    encoder.finish()
    lock.lock()
    defer { lock.unlock() }
    XCTAssertGreaterThanOrEqual(packets.count, 4)
    XCTAssertEqual(packets[0][0] & 0x40, 0x40)
    XCTAssertEqual(packets[1][0] & 0x20, 0x20)
  }
  func testNativeAudioConversionAndPacketSize() throws {
    let format = AVAudioFormat(
      commonFormat: .pcmFormatFloat32, sampleRate: 44100, channels: 1, interleaved: false)!
    let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: 1024)!
    pcm.frameLength = 1024
    pcm.floatChannelData![0].initialize(repeating: 0.25, count: 1024)
    var timing = CMSampleTimingInfo(
      duration: CMTime(value: 1, timescale: 44100), presentationTimeStamp: .zero,
      decodeTimeStamp: .invalid)
    var sample: CMSampleBuffer?
    XCTAssertEqual(
      CMSampleBufferCreate(
        allocator: nil, dataBuffer: nil, dataReady: false, makeDataReadyCallback: nil, refcon: nil,
        formatDescription: format.formatDescription, sampleCount: 1024, sampleTimingEntryCount: 1,
        sampleTimingArray: &timing, sampleSizeEntryCount: 0, sampleSizeArray: nil,
        sampleBufferOut: &sample), noErr)
    XCTAssertEqual(
      CMSampleBufferSetDataBufferFromAudioBufferList(
        sample!, blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0,
        bufferList: pcm.audioBufferList), noErr)
    CMSampleBufferSetDataReady(sample!)
    let packets = try SenderAudioEncoder().encode(sample!, timestamp: 0)
    XCTAssertFalse(packets.isEmpty)
    for packet in packets {
      XCTAssertTrue((16...4108).contains(packet.count))
      XCTAssertEqual((packet.count - 12) % 4, 0)
    }
  }
}
