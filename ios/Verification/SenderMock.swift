import CoreMedia
import CoreVideo
import Foundation
import PhoneMirrorSenderCore

/// Bounded synthetic sender. Never captures a phone or desktop screen.
@main struct SenderMock {
  static func main() throws {
    guard CommandLine.arguments.count == 2 else { throw SenderError.invalidCode }
    let code = try SenderConnectionCode(
      String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8))
    let network = SenderNetwork(
      code: code,
      hello: SenderHello(
        deviceId: "123e4567-e89b-42d3-a456-426614174000", name: "Synthetic iPhone", audio: true))
    let ready = DispatchSemaphore(value: 0)
    network.onReady = { ready.signal() }
    network.onFailure = { message in fputs("Synthetic sender failed: \(message)\n", stderr) }
    network.start()
    guard ready.wait(timeout: .now() + 3) == .success else { throw SenderError.inactive }
    Thread.sleep(forTimeInterval: 0.1)
    let encoder = SenderVideoEncoder(
      settings: try SenderCaptureSettings(dimension: 720, frameRate: 30),
      output: { network.send(kind: 2, payload: $0) },
      failure: { fputs("Synthetic encoder failed\n", stderr) })
    var pixel: CVPixelBuffer?
    guard
      CVPixelBufferCreate(
        nil, 64, 32, kCVPixelFormatType_32BGRA,
        [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &pixel) == kCVReturnSuccess,
      let pixel
    else { throw SenderError.invalidPacket }
    CVPixelBufferLockBaseAddress(pixel, [])
    memset(CVPixelBufferGetBaseAddress(pixel), 100, CVPixelBufferGetDataSize(pixel))
    CVPixelBufferUnlockBaseAddress(pixel, [])
    for index in 0..<12 {
      try encoder.encode(pixel, timestamp: UInt64(index) * 40_000)
      var pcm = Data(repeating: 0, count: 4096)
      if code.transport == .usb {
        pcm.withUnsafeMutableBytes { bytes in
          let samples = bytes.bindMemory(to: Int16.self)
          for frame in 0..<1024 {
            let time = index * 40_000 + frame * 1_000_000 / 48_000
            let tone: Int16 =
              time < 100_000
              ? 0 : Int16(10_000 * sin(2 * .pi * 440 * Double(index * 1920 + frame) / 48_000))
            samples[frame * 2] = tone.littleEndian
            samples[frame * 2 + 1] = tone.littleEndian
          }
        }
      }
      network.send(
        kind: 3,
        payload: try senderMediaPacket(
          payload: pcm, timestamp: UInt64(index) * 40_000))
      Thread.sleep(forTimeInterval: 0.04)
    }
    encoder.finish()
    Thread.sleep(forTimeInterval: 0.1)
    network.stop()
    print("Synthetic Swift sender completed")
  }
}
