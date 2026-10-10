import Foundation
import CoreVideo
import CoreMediaIO
@preconcurrency import AVFoundation
import PhoneMirrorCore

protocol TimeProvider { var now: TimeInterval { get } }
struct MonotonicTimeProvider: TimeProvider { var now: TimeInterval { ProcessInfo.processInfo.systemUptime } }
protocol DeviceDiscovery { func discoverDevices(for platform: PhonePlatform) async throws -> [PhoneDevice] }
struct MirrorSessionCallbacks {
    var onFrame: ((CVPixelBuffer) -> Void)?
    var onAudio: ((Data) -> Void)?
    var onLog: ((String) -> Void)?
    var onEnd: ((String) -> Void)?
    var onAudioReady: (() -> Void)?
    var onAudioUnavailable: (() -> Void)?
}
protocol MirrorSession: AnyObject {
    var callbacks: MirrorSessionCallbacks { get set }
    func start()
    func stop()
    func sendKey(_ code: UInt32)
    func sendText(_ text: String)
    func sendTouch(action: UInt8, point: CGPoint, size: CGSize)
    func interruptForTest()
}
protocol MirrorSessionFactory { func makeSession(for device: DeviceIdentity, settings: MirrorSettings) throws -> any MirrorSession }
struct USBDeviceDiscovery: DeviceDiscovery {
    func discoverDevices(for platform: PhonePlatform) async throws -> [PhoneDevice] {
        if platform == .android {
            guard let adb = ProcessCommandRunner.locate("adb") else { throw MediaError.failed("Android 연결 도구 adb가 없습니다. README의 설치 안내를 확인하세요.") }
            let (code, output) = await ProcessCommandRunner.run(adb, ["devices", "-l"])
            guard code == 0 else { throw MediaError.failed("USB 기기 확인 실패: \(output)") }
            return AndroidDeviceParser.parse(output)
        }
        var address = CMIOObjectPropertyAddress(mSelector: CMIOObjectPropertySelector(kCMIOHardwarePropertyAllowScreenCaptureDevices), mScope: CMIOObjectPropertyScope(kCMIOObjectPropertyScopeGlobal), mElement: CMIOObjectPropertyElement(kCMIOObjectPropertyElementMain))
        var value: UInt32 = 1
        let result = CMIOObjectSetPropertyData(CMIOObjectID(kCMIOObjectSystemObject), &address, 0, nil, UInt32(MemoryLayout.size(ofValue: value)), &value)
        guard result == noErr else { throw MediaError.failed("iOS 화면 장치 활성화 실패: \(result)") }
        return AVCaptureDevice.DiscoverySession(deviceTypes: [.external], mediaType: .muxed, position: .unspecified).devices.filter { !$0.isContinuityCamera }.map {
            PhoneDevice(identity: DeviceIdentity(platform: .iOS, id: $0.uniqueID), name: $0.localizedName, availability: .ready)
        }
    }
}
struct USBMirrorSessionFactory: MirrorSessionFactory {
    func makeSession(for device: DeviceIdentity, settings: MirrorSettings) throws -> any MirrorSession {
        guard device.isValid else { throw MediaError.failed("유효하지 않은 기기 식별자입니다.") }
        if device.platform == .android {
            guard ProcessCommandRunner.locate("adb") != nil, FileManager.default.fileExists(atPath: AndroidStream.serverURL.path) else { throw MediaError.failed("Android 화면 전송 도구를 찾을 수 없습니다.") }
            return AndroidMirrorSession(device: device, settings: settings.validated())
        }
        return IOSMirrorSession(device: device)
    }
}
final class AndroidMirrorSession: MirrorSession {
    var callbacks = MirrorSessionCallbacks()
    private let stream = AndroidStream()
    private let options: AndroidStreamOptions
    init(device: DeviceIdentity, settings: MirrorSettings) {
        options = AndroidStreamOptions(deviceID: device.id, videoMaxDimension: settings.videoMaxDimension, videoMaxFrameRate: settings.videoMaxFrameRate, audioEnabled: settings.audioEnabled, keepScreenAwake: settings.keepScreenAwake)
    }
    func start() {
        stream.onFrame = { [weak self] in self?.callbacks.onFrame?($0) }
        stream.onAudio = { [weak self] in self?.callbacks.onAudio?($0) }
        stream.onLog = { [weak self] in self?.callbacks.onLog?($0) }
        stream.onEnd = { [weak self] in self?.callbacks.onEnd?($0) }
        stream.onAudioReady = { [weak self] in self?.callbacks.onAudioReady?() }
        stream.onAudioUnavailable = { [weak self] in self?.callbacks.onAudioUnavailable?() }
        stream.start(options)
    }
    func stop() { stream.stop() }
    func sendKey(_ code: UInt32) { stream.sendKey(code) }
    func sendText(_ text: String) { stream.sendText(text) }
    func sendTouch(action: UInt8, point: CGPoint, size: CGSize) { stream.sendTouch(action: action, x: Int(point.x), y: Int(point.y), width: Int(size.width), height: Int(size.height)) }
    func interruptForTest() { stream.interruptForTest() }
}
final class IOSMirrorSession: NSObject, MirrorSession, AVCaptureVideoDataOutputSampleBufferDelegate {
    var callbacks = MirrorSessionCallbacks()
    private let device: DeviceIdentity
    private let capture = AVCaptureSession()
    private let queue = DispatchQueue(label: "phoneMirror.ios.capture")
    private let lock = NSLock()
    private var stopped = false
    private var observers: [NSObjectProtocol] = []
    init(device: DeviceIdentity) { self.device = device; super.init() }
    private var isStopped: Bool { lock.lock(); defer { lock.unlock() }; return stopped }
    func start() {
        for name in [AVCaptureSession.runtimeErrorNotification, AVCaptureDevice.wasDisconnectedNotification] {
            observers.append(NotificationCenter.default.addObserver(forName: name, object: nil, queue: nil) { [weak self] note in
                guard let self, !self.isStopped else { return }
                if name == AVCaptureSession.runtimeErrorNotification && (note.object as? AVCaptureSession) !== self.capture { return }
                if name == AVCaptureDevice.wasDisconnectedNotification && (note.object as? AVCaptureDevice)?.uniqueID != self.device.id { return }
                self.callbacks.onEnd?("아이폰 캡처 연결이 끊겼습니다.")
            })
        }
        AVCaptureDevice.requestAccess(for: .video) { [weak self] allowed in
            guard let self, !self.isStopped else { return }
            guard allowed else { self.callbacks.onEnd?("시스템 설정 → 개인정보 보호 및 보안 → 카메라에서 Phone Mirror를 허용하세요."); return }
            self.queue.async {
                guard !self.isStopped else { return }
                self.capture.beginConfiguration()
                do {
                    guard let device = AVCaptureDevice.DiscoverySession(deviceTypes: [.external], mediaType: .muxed, position: .unspecified).devices.first(where: { $0.uniqueID == self.device.id }) else { throw MediaError.failed("아이폰을 찾을 수 없습니다.") }
                    let input = try AVCaptureDeviceInput(device: device), output = AVCaptureVideoDataOutput()
                    output.videoSettings = [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA]; output.alwaysDiscardsLateVideoFrames = true
                    output.setSampleBufferDelegate(self, queue: self.queue)
                    guard self.capture.canAddInput(input), self.capture.canAddOutput(output) else { throw MediaError.failed("아이폰 영상 캡처를 설정할 수 없습니다.") }
                    self.capture.addInput(input); self.capture.addOutput(output); self.capture.commitConfiguration()
                    if !self.isStopped { self.capture.startRunning() }
                } catch { self.capture.commitConfiguration(); self.callbacks.onEnd?(error.localizedDescription) }
            }
        }
    }
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        if !isStopped, let buffer = CMSampleBufferGetImageBuffer(sampleBuffer) { callbacks.onFrame?(buffer) }
    }
    func stop() {
        lock.lock(); stopped = true; lock.unlock()
        observers.forEach { NotificationCenter.default.removeObserver($0) }; observers.removeAll()
        queue.async { [self] in if capture.isRunning { capture.stopRunning() } }
    }
    func sendKey(_ code: UInt32) {}
    func sendText(_ text: String) {}
    func sendTouch(action: UInt8, point: CGPoint, size: CGSize) {}
    func interruptForTest() { callbacks.onEnd?("아이폰 캡처 중단 테스트") }
}
