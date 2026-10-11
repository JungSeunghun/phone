import CoreMedia
import Foundation
import ReplayKit

final class SampleHandler: RPBroadcastSampleHandler {
  private let lock = NSRecursiveLock()
  private var network: SenderNetwork?
  private var video: SenderVideoEncoder?
  private var audio = SenderAudioEncoder()
  private var settings: SenderCaptureSettings?
  private var firstTime: CMTime?
  private var paused = false
  private var ended = false
  private var audioEnabled = false
  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    lock.lock()
    defer { lock.unlock() }
    do {
      guard let defaults = UserDefaults(suiteName: SenderSharedContainer.identifier) else {
        throw SenderError.invalidCode
      }
      let preferences = try SenderPreferences.load(defaults)
      settings = try SenderCaptureSettings(
        dimension: preferences.dimension, frameRate: preferences.frameRate)
      audioEnabled = preferences.audio
      let sender = SenderNetwork(
        code: try SenderConnectionCode(preferences.connectionCode),
        hello: SenderHello(
          deviceId: preferences.deviceId, name: preferences.deviceName, audio: preferences.audio),
        adaptiveQuality: preferences.adaptiveQuality ?? true)
      network = sender
      sender.onReady = { [weak self, weak sender] in
        guard let self, let sender else { return }
        self.lock.lock()
        defer { self.lock.unlock() }
        guard !self.ended, let settings = self.settings else { return }
        self.video?.finish()
        self.video = SenderVideoEncoder(
          settings: settings,
          output: { [weak sender] packet in sender?.send(kind: 2, payload: packet) },
          failure: { [weak self] in
            DispatchQueue.global().async { self?.failed("영상을 인코딩할 수 없습니다.") }
          })
        self.audio = SenderAudioEncoder()
      }
      sender.onVideoBitRateChanged = { [weak self, weak sender] rate in
        guard let self, let sender else { return }
        self.lock.lock()
        defer { self.lock.unlock() }
        guard !self.ended, self.network === sender, sender.isReady else { return }
        try? self.video?.setBitRate(rate)
      }
      sender.onFailure = { [weak self] message in self?.failed(message) }
      sender.start()
    } catch { failed("송출 앱에서 유효한 연결 코드를 저장하고 다시 시작하세요.") }
  }
  override func processSampleBuffer(_ sample: CMSampleBuffer, with type: RPSampleBufferType) {
    lock.lock()
    defer { lock.unlock() }
    guard !ended, !paused, let network, network.isReady else { return }
    let time = CMSampleBufferGetPresentationTimeStamp(sample)
    guard time.isNumeric else { return }
    if firstTime == nil { firstTime = time }
    let relative = CMTimeConvertScale(
      CMTimeSubtract(time, firstTime!), timescale: 1_000_000, method: .default)
    guard relative.isNumeric, relative.value >= 0, relative.value < 1 << 53 else { return }
    do {
      switch type {
      case .video:
        if let pixel = CMSampleBufferGetImageBuffer(sample) {
          let orientation =
            (CMGetAttachment(
              sample, key: RPVideoSampleOrientationKey as CFString, attachmentModeOut: nil)
            as? NSNumber)?.int32Value ?? 1
          try video?.encode(pixel, timestamp: UInt64(relative.value), orientation: orientation)
        }
      case .audioApp:
        if audioEnabled {
          for packet in try audio.encode(sample, timestamp: UInt64(relative.value)) {
            network.send(kind: 3, payload: packet)
          }
        }
      default: break  // Microphone samples are deliberately excluded.
      }
    } catch { failed("화면 또는 앱 오디오 데이터를 처리할 수 없습니다.") }
  }
  override func broadcastPaused() {
    lock.lock()
    paused = true
    lock.unlock()
  }
  override func broadcastResumed() {
    lock.lock()
    paused = false
    lock.unlock()
  }
  override func broadcastFinished() {
    lock.lock()
    ended = true
    network?.stop()
    network = nil
    video?.finish()
    video = nil
    lock.unlock()
  }
  private func failed(_ message: String) {
    lock.lock()
    guard !ended else {
      lock.unlock()
      return
    }
    ended = true
    network?.stop()
    lock.unlock()
    finishBroadcastWithError(
      NSError(domain: "PhoneMirrorSender", code: 1, userInfo: [NSLocalizedDescriptionKey: message]))
  }
}
