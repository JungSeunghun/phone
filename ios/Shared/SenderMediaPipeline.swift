import AVFoundation
import CoreImage
import CoreMedia
import CoreVideo
import Foundation
import VideoToolbox

public final class SenderVideoEncoder {
  public private(set) var bitRate = 6_000_000
  public func setBitRate(_ value: Int) throws {
    guard [1_500_000, 3_000_000, 6_000_000].contains(value) else {
      throw SenderError.invalidSettings
    }
    if let session,
      VTSessionSetProperty(
        session, key: kVTCompressionPropertyKey_AverageBitRate, value: NSNumber(value: value))
        != noErr
    {
      throw SenderError.invalidSettings
    }
    bitRate = value
  }
  private var session: VTCompressionSession?
  private let settings: SenderCaptureSettings
  private let output: (Data) -> Void
  private let failure: () -> Void
  private let render = CIContext(options: [.cacheIntermediates: false])
  private var configuration = Data()
  private var dimensions = (0, 0)
  private var lastTimestamp: UInt64?
  private let pending = DispatchSemaphore(value: 2)
  private let delivery = DispatchQueue(label: "phoneMirror.sender.video.delivery")
  public init(
    settings: SenderCaptureSettings, output: @escaping (Data) -> Void, failure: @escaping () -> Void
  ) {
    self.settings = settings
    self.output = output
    self.failure = failure
  }
  public func encode(_ pixel: CVPixelBuffer, timestamp: UInt64, orientation: Int32 = 1) throws {
    guard timestamp < 1 << 53, (1...8).contains(orientation) else {
      throw SenderError.invalidPacket
    }
    if let last = lastTimestamp {
      guard timestamp > last else { return }
      if timestamp - last < UInt64(1_000_000 / settings.frameRate) { return }
    }
    var image = CIImage(cvPixelBuffer: pixel).oriented(forExifOrientation: orientation)
    let size = try settings.dimensions(
      width: Int(image.extent.width), height: Int(image.extent.height))
    if session == nil || dimensions != (size.width, size.height) {
      finish()
      configuration = Data()
      dimensions = (size.width, size.height)
      let result = VTCompressionSessionCreate(
        allocator: nil, width: Int32(size.width), height: Int32(size.height),
        codecType: kCMVideoCodecType_H264, encoderSpecification: nil, imageBufferAttributes: nil,
        compressedDataAllocator: nil,
        outputCallback: { context, _, status, flags, sample in
          guard let context else { return }
          let encoder = Unmanaged<SenderVideoEncoder>.fromOpaque(context).takeUnretainedValue()
          defer { encoder.pending.signal() }
          if status == noErr && flags.contains(.frameDropped) { return }
          guard status == noErr, let sample, CMSampleBufferDataIsReady(sample) else {
            encoder.failure()
            return
          }
          encoder.delivery.sync { do { try encoder.encoded(sample) } catch { encoder.failure() } }
        }, refcon: Unmanaged.passUnretained(self).toOpaque(), compressionSessionOut: &session)
      guard result == noErr, let session else { throw SenderError.invalidSettings }
      let properties: [CFString: Any] = [
        kVTCompressionPropertyKey_RealTime: true,
        kVTCompressionPropertyKey_AllowFrameReordering: false,
        kVTCompressionPropertyKey_ProfileLevel: kVTProfileLevel_H264_Baseline_AutoLevel,
        kVTCompressionPropertyKey_AverageBitRate: bitRate,
        kVTCompressionPropertyKey_ExpectedFrameRate: settings.frameRate,
        kVTCompressionPropertyKey_MaxKeyFrameInterval: settings.frameRate,
        kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration: 1,
      ]
      guard
        VTSessionSetProperties(session, propertyDictionary: properties as CFDictionary) == noErr,
        VTCompressionSessionPrepareToEncodeFrames(session) == noErr
      else { throw SenderError.invalidSettings }
    }
    guard pending.wait(timeout: .now()) == .success else { return }
    var scaled: CVPixelBuffer?
    guard
      CVPixelBufferCreate(
        nil, size.width, size.height, kCVPixelFormatType_32BGRA,
        [kCVPixelBufferIOSurfacePropertiesKey: [:]] as CFDictionary, &scaled) == kCVReturnSuccess,
      let scaled
    else {
      pending.signal()
      throw SenderError.overflow
    }
    image = image.transformed(
      by: CGAffineTransform(translationX: -image.extent.minX, y: -image.extent.minY)
    ).transformed(
      by: CGAffineTransform(
        scaleX: Double(size.width) / image.extent.width,
        y: Double(size.height) / image.extent.height))
    render.render(image, to: scaled)
    let status = VTCompressionSessionEncodeFrame(
      session!, imageBuffer: scaled,
      presentationTimeStamp: CMTime(value: Int64(timestamp), timescale: 1_000_000),
      duration: CMTime(value: 1, timescale: Int32(settings.frameRate)), frameProperties: nil,
      sourceFrameRefcon: nil, infoFlagsOut: nil)
    if status != noErr {
      pending.signal()
      throw SenderError.invalidPacket
    }
    lastTimestamp = timestamp
  }
  private func encoded(_ sample: CMSampleBuffer) throws {
    guard let format = CMSampleBufferGetFormatDescription(sample) else {
      throw SenderError.invalidPacket
    }
    var config = Data()
    var header: Int32 = 0
    for index in 0..<2 {
      var bytes: UnsafePointer<UInt8>?
      var count = 0
      guard
        CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
          format, parameterSetIndex: index, parameterSetPointerOut: &bytes,
          parameterSetSizeOut: &count, parameterSetCountOut: nil, nalUnitHeaderLengthOut: &header)
          == noErr, let bytes, count > 0, count <= 65535
      else { throw SenderError.invalidPacket }
      config.append(contentsOf: [0, 0, 0, 1])
      config.append(bytes, count: count)
    }
    guard header == 4 else { throw SenderError.invalidPacket }
    if config != configuration {
      output(try senderMediaPacket(payload: config, timestamp: 0, configuration: true))
      configuration = config
    }
    guard let block = CMSampleBufferGetDataBuffer(sample) else { throw SenderError.invalidPacket }
    let length = CMBlockBufferGetDataLength(block)
    guard length > 4, length < 4 * 1024 * 1024 - 12 else { throw SenderError.invalidPacket }
    var avcc = Data(count: length)
    let status = avcc.withUnsafeMutableBytes {
      CMBlockBufferCopyDataBytes(
        block, atOffset: 0, dataLength: length, destination: $0.baseAddress!)
    }
    guard status == noErr else { throw SenderError.invalidPacket }
    var offset = 0
    var annex = Data()
    while offset < length {
      guard length - offset >= 4 else { throw SenderError.invalidPacket }
      let n = avcc[offset..<offset + 4].reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
      offset += 4
      guard n > 0, Int(n) <= length - offset else { throw SenderError.invalidPacket }
      annex.append(contentsOf: [0, 0, 0, 1])
      annex.append(avcc[offset..<offset + Int(n)])
      offset += Int(n)
    }
    let attachments =
      CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false)
      as? [[CFString: Any]]
    let key = !(attachments?.first?[kCMSampleAttachmentKey_NotSync] as? Bool ?? false)
    let pts = CMTimeConvertScale(
      CMSampleBufferGetPresentationTimeStamp(sample), timescale: 1_000_000, method: .default)
    guard pts.isNumeric, pts.value >= 0 else { throw SenderError.invalidPacket }
    output(try senderMediaPacket(payload: annex, timestamp: UInt64(pts.value), keyFrame: key))
  }
  public func finish() {
    if let session {
      VTCompressionSessionCompleteFrames(session, untilPresentationTimeStamp: .invalid)
      VTCompressionSessionInvalidate(session)
    }
    session = nil
  }
  deinit { finish() }
}
public final class SenderAudioEncoder {
  private var converter: AVAudioConverter?
  private var sourceFormat: AVAudioFormat?
  private let destination = AVAudioFormat(
    commonFormat: .pcmFormatInt16, sampleRate: 48000, channels: 2, interleaved: true)!
  public init() {}
  public func encode(_ sample: CMSampleBuffer, timestamp: UInt64) throws -> [Data] {
    guard let description = CMSampleBufferGetFormatDescription(sample),
      let format = AVAudioFormat(cmAudioFormatDescription: description) as AVAudioFormat?,
      format.sampleRate.isFinite, format.sampleRate >= 8000, format.sampleRate <= 192000,
      format.channelCount >= 1, format.channelCount <= 8
    else { throw SenderError.invalidPacket }
    let count = CMSampleBufferGetNumSamples(sample)
    guard count > 0, count <= 8192,
      let input = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count))
    else { throw SenderError.invalidPacket }
    input.frameLength = AVAudioFrameCount(count)
    guard
      CMSampleBufferCopyPCMDataIntoAudioBufferList(
        sample, at: 0, frameCount: Int32(count), into: input.mutableAudioBufferList) == noErr
    else { throw SenderError.invalidPacket }
    if sourceFormat != format {
      converter = AVAudioConverter(from: format, to: destination)
      sourceFormat = format
    }
    guard let converter else { throw SenderError.invalidPacket }
    var supplied = false
    var packets: [Data] = []
    var offset = 0
    for _ in 0..<64 {
      let output = AVAudioPCMBuffer(pcmFormat: destination, frameCapacity: 1024)!
      var error: NSError?
      let status = converter.convert(to: output, error: &error) { _, status in
        if supplied {
          status.pointee = .noDataNow
          return nil
        }
        supplied = true
        status.pointee = .haveData
        return input
      }
      guard error == nil, status != .error else { throw SenderError.invalidPacket }
      if output.frameLength > 0 {
        let b = output.audioBufferList.pointee.mBuffers
        guard let bytes = b.mData, b.mDataByteSize == output.frameLength * 4 else {
          throw SenderError.invalidPacket
        }
        let payload = Data(bytes: bytes, count: Int(b.mDataByteSize))
        packets.append(
          try senderMediaPacket(
            payload: payload, timestamp: timestamp + UInt64(offset) * 1_000_000 / 48000))
        offset += Int(output.frameLength)
      }
      if status == .inputRanDry || status == .endOfStream { break }
    }
    return packets
  }
}
