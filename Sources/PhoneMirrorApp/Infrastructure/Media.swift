import Foundation
@preconcurrency import AVFoundation
import VideoToolbox
import CoreImage
import ImageIO
import UniformTypeIdentifiers

enum MediaError: LocalizedError {
    case failed(String)
    var errorDescription: String? { if case let .failed(text) = self { return text }; return nil }
}

enum H264 {
    static func units(_ data: Data) -> [Data] {
        let bytes = [UInt8](data)
        var starts: [(Int, Int)] = [], i = 0
        while i + 2 < bytes.count {
            if bytes[i] == 0 && bytes[i + 1] == 0 {
                if bytes[i + 2] == 1 { starts.append((i, i + 3)); i += 3; continue }
                if i + 3 < bytes.count && bytes[i + 2] == 0 && bytes[i + 3] == 1 {
                    starts.append((i, i + 4)); i += 4; continue
                }
            }
            i += 1
        }
        return starts.enumerated().compactMap { index, start in
            let end = index + 1 < starts.count ? starts[index + 1].0 : bytes.count
            return end > start.1 ? Data(bytes[start.1..<end]) : nil
        }
    }
}

final class VideoDecoder {
    var onFrame: ((CVPixelBuffer) -> Void)?
    private var session: VTDecompressionSession?
    private var format: CMVideoFormatDescription?
    private var sps = Data(), pps = Data()
    func decode(_ data: Data, pts: UInt64) throws {
        let units = H264.units(data)
        let newSPS = units.first { ($0.first ?? 0) & 31 == 7 }
        let newPPS = units.first { ($0.first ?? 0) & 31 == 8 }
        if newSPS != nil || newPPS != nil {
            if let newSPS { sps = newSPS }; if let newPPS { pps = newPPS }
            if !sps.isEmpty && !pps.isEmpty { try configure() }
        }
        guard let session, let format else { return }
        var avcc = Data()
        for unit in units where (unit.first ?? 0) & 31 != 7 && (unit.first ?? 0) & 31 != 8 {
            avcc.appendBE(UInt32(unit.count)); avcc.append(unit)
        }
        guard !avcc.isEmpty else { return }
        var block: CMBlockBuffer?
        var status = CMBlockBufferCreateWithMemoryBlock(allocator: kCFAllocatorDefault, memoryBlock: nil,
            blockLength: avcc.count, blockAllocator: kCFAllocatorDefault, customBlockSource: nil,
            offsetToData: 0, dataLength: avcc.count, flags: 0, blockBufferOut: &block)
        guard status == noErr, let block else { throw MediaError.failed("영상 버퍼 생성 실패: \(status)") }
        status = avcc.withUnsafeBytes { CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: avcc.count) }
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: CMTime(value: Int64(pts), timescale: 1_000_000), decodeTimeStamp: .invalid)
        var sample: CMSampleBuffer?, size = avcc.count
        status = CMSampleBufferCreateReady(allocator: kCFAllocatorDefault, dataBuffer: block, formatDescription: format,
            sampleCount: 1, sampleTimingEntryCount: 1, sampleTimingArray: &timing,
            sampleSizeEntryCount: 1, sampleSizeArray: &size, sampleBufferOut: &sample)
        guard status == noErr, let sample else { throw MediaError.failed("영상 프레임 생성 실패: \(status)") }
        status = VTDecompressionSessionDecodeFrame(session, sampleBuffer: sample, flags: [], frameRefcon: nil, infoFlagsOut: nil)
        guard status == noErr else { throw MediaError.failed("영상 디코딩 실패: \(status)") }
    }
    private func configure() throws {
        close()
        let status = sps.withUnsafeBytes { s in pps.withUnsafeBytes { p -> OSStatus in
            let pointers = [s.bindMemory(to: UInt8.self).baseAddress!, p.bindMemory(to: UInt8.self).baseAddress!]
            let sizes = [sps.count, pps.count]
            return pointers.withUnsafeBufferPointer { ptr in sizes.withUnsafeBufferPointer { lengths in
                CMVideoFormatDescriptionCreateFromH264ParameterSets(allocator: kCFAllocatorDefault, parameterSetCount: 2,
                    parameterSetPointers: ptr.baseAddress!, parameterSetSizes: lengths.baseAddress!, nalUnitHeaderLength: 4, formatDescriptionOut: &format)
            } }
        } }
        guard status == noErr, let format else { throw MediaError.failed("H.264 형식 생성 실패: \(status)") }
        var callback = VTDecompressionOutputCallbackRecord(decompressionOutputCallback: { ref, _, status, _, buffer, _, _ in
            guard status == noErr, let ref, let buffer else { return }
            Unmanaged<VideoDecoder>.fromOpaque(ref).takeUnretainedValue().onFrame?(buffer)
        }, decompressionOutputRefCon: Unmanaged.passUnretained(self).toOpaque())
        let attributes: [String: Any] = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
            kCVPixelBufferIOSurfacePropertiesKey as String: [:]]
        let result = VTDecompressionSessionCreate(allocator: kCFAllocatorDefault, formatDescription: format,
            decoderSpecification: nil, imageBufferAttributes: attributes as CFDictionary, outputCallback: &callback, decompressionSessionOut: &session)
        guard result == noErr else { throw MediaError.failed("디코더 시작 실패: \(result)") }
    }
    func close() {
        if let session { VTDecompressionSessionWaitForAsynchronousFrames(session); VTDecompressionSessionInvalidate(session) }
        session = nil; format = nil
    }
    deinit { close() }
}

extension Data {
    mutating func appendBE<T: FixedWidthInteger>(_ value: T) {
        var big = value.bigEndian
        Swift.withUnsafeBytes(of: &big) { append(contentsOf: $0) }
    }
    func unsigned(_ offset: Int, _ count: Int) -> UInt64 {
        self.dropFirst(offset).prefix(count).reduce(0) { ($0 << 8) | UInt64($1) }
    }
}

/// All writer and audio engine operations are serialized on this queue.
final class MediaRecorder {
    let queue = DispatchQueue(label: "phone.media")
    private let context = CIContext()
    private var writer: AVAssetWriter?
    private var video: AVAssetWriterInput?
    private var audio: AVAssetWriterInput?
    private var adaptor: AVAssetWriterInputPixelBufferAdaptor?
    private var started: Double = 0
    private var dimensions = CGSize.zero
    private var lastVideoTime = CMTime.invalid
    private var failed = false
    private var frameCount = 0
    private var recordingURL: URL?
    private var latestBuffer: CVPixelBuffer?
    private var clock: DispatchSourceTimer?
    var onFailure: ((String) -> Void)?
    func start(url: URL, width: Int, height: Int, initial: CVPixelBuffer, includeAudio: Bool, completion: @escaping (String?) -> Void) {
        queue.async { [self] in
            do {
                let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
                let video = AVAssetWriterInput(mediaType: .video, outputSettings: [AVVideoCodecKey: AVVideoCodecType.h264,
                    AVVideoWidthKey: width, AVVideoHeightKey: height,
                    AVVideoCompressionPropertiesKey: [AVVideoAverageBitRateKey: 8_000_000]])
                video.expectsMediaDataInRealTime = true
                guard writer.canAdd(video) else { throw MediaError.failed("녹화 영상 설정을 지원하지 않습니다.") }
                writer.add(video)
                let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: video, sourcePixelBufferAttributes: [
                    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA,
                    kCVPixelBufferWidthKey as String: width, kCVPixelBufferHeightKey as String: height,
                    kCVPixelBufferIOSurfacePropertiesKey as String: [:]])
                var audio: AVAssetWriterInput?
                if includeAudio {
                    let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC,
                        AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 128000])
                    input.expectsMediaDataInRealTime = true
                    if writer.canAdd(input) { writer.add(input); audio = input }
                }
                guard writer.startWriting() else { throw writer.error ?? MediaError.failed("녹화를 시작하지 못했습니다.") }
                writer.startSession(atSourceTime: .zero)
                self.writer = writer; self.video = video; self.audio = audio; self.adaptor = adaptor
                dimensions = CGSize(width: width, height: height); started = CACurrentMediaTime()
                lastVideoTime = .invalid; failed = false; frameCount = 0; recordingURL = url
                latestBuffer = initial
                let clock = DispatchSource.makeTimerSource(queue: queue)
                clock.schedule(deadline: .now(), repeating: 1.0 / 30.0)
                clock.setEventHandler { [weak self] in self?.writeVideo(time: CACurrentMediaTime()) }
                self.clock = clock; clock.resume()
                completion(nil)
            } catch { completion(error.localizedDescription) }
        }
    }
    func appendVideo(_ buffer: CVPixelBuffer, time: Double) {
        queue.async { [self] in
            guard writer != nil else { return }; latestBuffer = buffer
        }
    }
    private func writeVideo(time: Double) {
            guard let buffer = latestBuffer, let writer, writer.status == .writing, let video, video.isReadyForMoreMediaData,
                  let adaptor, let pool = adaptor.pixelBufferPool, time >= started else { return }
            let pts = CMTime(value: Int64((time - started) * 30), timescale: 30)
            guard !lastVideoTime.isValid || pts > lastVideoTime else { return }
            var output: CVPixelBuffer?
            guard CVPixelBufferPoolCreatePixelBuffer(nil, pool, &output) == kCVReturnSuccess, let output else { report("녹화 버퍼 할당 실패"); return }
            let source = CIImage(cvPixelBuffer: buffer)
            let scale = min(dimensions.width / source.extent.width, dimensions.height / source.extent.height)
            let x = (dimensions.width - source.extent.width * scale) / 2, y = (dimensions.height - source.extent.height * scale) / 2
            let image = source.transformed(by: CGAffineTransform(scaleX: scale, y: scale)).transformed(by: CGAffineTransform(translationX: x, y: y))
                .composited(over: CIImage(color: .black).cropped(to: CGRect(origin: .zero, size: dimensions)))
            context.render(image, to: output)
            if adaptor.append(output, withPresentationTime: pts) { lastVideoTime = pts; frameCount += 1 }
            else { report(writer.error?.localizedDescription ?? "영상 녹화 쓰기 실패") }
    }
    func appendAudio(_ data: Data, time: Double) {
        queue.async { [self] in
            guard let writer, writer.status == .writing, let audio, audio.isReadyForMoreMediaData, time >= started else { return }
            guard let format = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: 48000, channels: 2, interleaved: true) else { return }
            var block: CMBlockBuffer?
            guard CMBlockBufferCreateWithMemoryBlock(allocator: nil, memoryBlock: nil, blockLength: data.count,
                blockAllocator: nil, customBlockSource: nil, offsetToData: 0, dataLength: data.count, flags: 0, blockBufferOut: &block) == noErr,
                let block else { return }
            _ = data.withUnsafeBytes { CMBlockBufferReplaceDataBytes(with: $0.baseAddress!, blockBuffer: block, offsetIntoDestination: 0, dataLength: data.count) }
            var timing = CMSampleTimingInfo(duration: CMTime(value: 1, timescale: 48000),
                presentationTimeStamp: CMTime(seconds: time - started, preferredTimescale: 48000), decodeTimeStamp: .invalid)
            var sample: CMSampleBuffer?, size = 4
            let status = CMSampleBufferCreateReady(allocator: nil, dataBuffer: block, formatDescription: format.formatDescription,
                sampleCount: data.count / 4, sampleTimingEntryCount: 1, sampleTimingArray: &timing,
                sampleSizeEntryCount: 1, sampleSizeArray: &size, sampleBufferOut: &sample)
            if status == noErr, let sample, !audio.append(sample) { report(writer.error?.localizedDescription ?? "오디오 녹화 쓰기 실패") }
        }
    }
    private func report(_ text: String) { if !failed { failed = true; onFailure?(text) } }
    func finish(completion: @escaping (String?) -> Void) {
        queue.async { [self] in
            guard let writer else { completion(nil); return }
            clock?.cancel(); clock = nil
            if writer.status != .writing {
                let error = writer.error?.localizedDescription ?? "녹화가 중단되어 파일을 마무리하지 못했습니다."
                self.writer = nil; video = nil; audio = nil; adaptor = nil; latestBuffer = nil
                completion(error); return
            }
            writeVideo(time: CACurrentMediaTime())
            let empty = frameCount == 0, url = recordingURL
            video?.markAsFinished(); audio?.markAsFinished()
            self.writer = nil; video = nil; audio = nil; adaptor = nil; latestBuffer = nil
            if empty {
                writer.cancelWriting(); if let url { try? FileManager.default.removeItem(at: url) }
                completion("저장할 영상 프레임이 없어 녹화를 취소했습니다."); return
            }
            writer.finishWriting { completion(writer.status == .completed ? nil : writer.error?.localizedDescription ?? "녹화 저장 실패") }
        }
    }
}

final class PhoneAudio {
    private let queue = DispatchQueue(label: "phone.audio")
    private let engine = AVAudioEngine(), player = AVAudioPlayerNode()
    private let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 2)!
    private var active = false, configured = false, pending = 0
    func play(_ data: Data) {
        queue.async { [self] in
            if !active {
                if !configured { engine.attach(player); engine.connect(player, to: engine.mainMixerNode, format: format); configured = true }
                do { try engine.start(); player.play(); active = true } catch { return }
            }
            guard pending < 8 else { return }
            let samples = [UInt8](data), count = samples.count / 4
            guard count > 0, let buffer = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(count)), let channels = buffer.floatChannelData else { return }
            buffer.frameLength = AVAudioFrameCount(count)
            for i in 0..<count {
                for channel in 0..<2 {
                    let p = i * 4 + channel * 2
                    channels[channel][i] = Float(Int16(bitPattern: UInt16(samples[p]) | UInt16(samples[p + 1]) << 8)) / 32768
                }
            }
            pending += 1
            player.scheduleBuffer(buffer) { [weak self] in self?.queue.async { self?.pending -= 1 } }
        }
    }
    func stop() { queue.async { [self] in player.stop(); engine.stop() } }
}
