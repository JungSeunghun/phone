import SwiftUI
import AppKit
import CoreImage
import ImageIO
import UniformTypeIdentifiers
import PhoneMirrorCore

enum ConnectionState: String {
    case idle = "기기 연결 대기", ready = "USB 연결됨 · 화면 보기 준비", unauthorized = "USB 디버깅 승인 대기"
    case connecting = "영상 연결 중", live = "화면 수신 중", stalled = "영상 수신 지연", reconnecting = "자동 재연결 대기"
    case disconnected = "연결 끊김", failed = "연결 실패", stopped = "화면 보기 종료"
    var active: Bool { self == .connecting || self == .live || self == .stalled }
}

@MainActor
final class PhoneMirrorViewModel: ObservableObject {
    @Published private(set) var settings: MirrorSettings
    @Published private(set) var platform: PhonePlatform
    @Published private(set) var availableDevices: [PhoneDevice] = []
    @Published private(set) var selectedDeviceID = ""
    @Published private(set) var connectionState: ConnectionState = .idle
    @Published private(set) var connectionMessage = "USB 케이블로 폰을 연결하세요."
    @Published private(set) var settingsStatusMessage = ""
    @Published private(set) var connectionLog = ""
    @Published private(set) var currentFrame: CGImage?
    @Published private(set) var videoMetrics = ""
    @Published private(set) var isRecording = false
    @Published private(set) var isSavingRecording = false
    @Published private(set) var recordingSeconds = 0
    @Published private(set) var mediaStatusMessage = ""
    @Published private(set) var lastSavedURL: URL?
    @Published private(set) var isAudioAvailable = false
    private let settingsStore: any SettingsStore
    private let deviceDiscovery: any DeviceDiscovery
    private let sessionFactory: any MirrorSessionFactory
    private let timeProvider: any TimeProvider
    private let automaticallyPoll: Bool
    private let context = CIContext()
    private let recorder = MediaRecorder()
    private var phoneAudio: PhoneAudio?
    private var session: (any MirrorSession)?
    private var sessionGeneration: UUID?
    private var discoveryGeneration = UUID()
    private var refreshInProgress = false
    private var reconnect = ReconnectionPolicy()
    private var timer: Timer?
    private var lastFrameTime: TimeInterval = 0
    private var connectionStartedTime: TimeInterval = 0
    private var lastMetricsTime: TimeInterval = 0
    private var recordingStarted = Date.distantPast
    private var recordingURL: URL?
    private var frameCounter = 0
    private var lastPixelBuffer: CVPixelBuffer?
    private var scanCounter = 0
    private var hasShutdown = false
    var isMirroring: Bool { connectionState.active }
    var isConnecting: Bool { connectionState == .connecting }
    var canStopMirroring: Bool { session != nil || reconnect.isWaiting }
    var canStartMirroring: Bool {
        !hasShutdown && !isMirroring && !isSavingRecording && !reconnect.isWaiting && availableDevices.contains { $0.id == selectedDeviceID && $0.availability == .ready }
    }
    var canSaveFrame: Bool { currentFrame != nil && connectionState == .live }
    init(settingsStore: any SettingsStore = UserDefaultsSettingsStore(), deviceDiscovery: any DeviceDiscovery = USBDeviceDiscovery(), sessionFactory: any MirrorSessionFactory = USBMirrorSessionFactory(), timeProvider: any TimeProvider = MonotonicTimeProvider(), automaticallyPoll: Bool = true) {
        self.settingsStore = settingsStore; self.deviceDiscovery = deviceDiscovery; self.sessionFactory = sessionFactory; self.timeProvider = timeProvider; self.automaticallyPoll = automaticallyPoll
        let restoredSettings = settingsStore.load().validated()
        settings = restoredSettings; platform = restoredSettings.preferredPlatform
        selectedDeviceID = settings.preferredDeviceID(for: platform) ?? ""
        reconnect.isEnabled = settings.autoReconnectEnabled
        recorder.onFailure = { [weak self] text in DispatchQueue.main.async {
            self?.appendLog(text); self?.mediaStatusMessage = text; self?.stopRecording()
        } }
        if automaticallyPoll {
            timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in Task { @MainActor in self?.tick() } }
            Task { await refreshDevices() }
        }
    }
    func updateSettings(_ input: MirrorSettings) {
        let validated = input.validated()
        guard validated != settings else { return }
        settings = validated; reconnect.isEnabled = settings.autoReconnectEnabled
        do { try settingsStore.save(settings); settingsStatusMessage = "" }
        catch { settingsStatusMessage = "설정 저장 실패: \(error.localizedDescription)" }
        if session == nil, reconnect.target != nil { updateReconnectState() }
    }
    func saveWindowPlacement(_ placement: SavedWindowPlacement) { var updated = settings; updated.windowPlacement = placement.validated(); updateSettings(updated) }
    func selectDevice(_ id: String) {
        guard id != selectedDeviceID, !isMirroring, !isSavingRecording, availableDevices.contains(where: { $0.id == id && $0.identity.isValid }) else { return }
        stopMirroring(); selectedDeviceID = id
        var updated = settings; updated.rememberDevice(DeviceIdentity(platform: platform, id: id)); updateSettings(updated); updateReadyState()
    }
    func selectPlatform(_ value: PhonePlatform) {
        guard value != platform, !isMirroring, !isSavingRecording else { return }
        stopMirroring(); platform = value; availableDevices = []; selectedDeviceID = settings.preferredDeviceID(for: value) ?? ""
        discoveryGeneration = UUID(); refreshInProgress = false; currentFrame = nil; videoMetrics = ""
        var updated = settings; updated.preferredPlatform = value; updateSettings(updated); updateReadyState()
        if automaticallyPoll { Task { await refreshDevices() } }
    }
    func appendLog(_ text: String) { connectionLog = String((connectionLog + text.trimmingCharacters(in: .whitespacesAndNewlines) + "\n").suffix(18000)) }
    func tick() {
        guard !hasShutdown else { return }
        scanCounter += 1
        if automaticallyPoll && scanCounter % 2 == 0 { Task { await refreshDevices() } }
        if connectionState == .connecting && timeProvider.now - connectionStartedTime >= 15 {
            sessionEnded("15초 동안 영상이 도착하지 않았습니다. 폰 잠금과 USB 디버깅 승인을 확인하세요.")
        } else if connectionState == .live && timeProvider.now - lastFrameTime >= 4 {
            connectionState = .stalled; connectionMessage = "새 영상 프레임이 도착하지 않아 마지막 수신 화면을 표시합니다."
        }
        tryReconnect()
        if isRecording { recordingSeconds = max(0, Int(Date().timeIntervalSince(recordingStarted))) }
    }
    func refreshDevices() async {
        guard !hasShutdown, !refreshInProgress else { return }
        refreshInProgress = true
        let generation = discoveryGeneration, requestedPlatform = platform
        defer { if discoveryGeneration == generation { refreshInProgress = false } }
        do {
            let devices = try await deviceDiscovery.discoverDevices(for: requestedPlatform)
            guard !hasShutdown, discoveryGeneration == generation, platform == requestedPlatform else { return }
            var seen = Set<String>()
            availableDevices = devices.filter { $0.identity.platform == platform && $0.identity.isValid && seen.insert($0.id).inserted }
            if session != nil {
                if !availableDevices.contains(where: { $0.id == selectedDeviceID && $0.availability == .ready }) { sessionEnded("USB 기기 연결이 끊겼습니다.") }
            } else if reconnect.target == nil {
                if let preferred = settings.preferredDeviceID(for: platform), availableDevices.contains(where: { $0.id == preferred }) { selectedDeviceID = preferred }
                else if !availableDevices.contains(where: { $0.id == selectedDeviceID }) { selectedDeviceID = availableDevices.first?.id ?? "" }
                if [.idle, .ready, .unauthorized, .disconnected].contains(connectionState) { updateReadyState() }
            }
            tryReconnect()
        } catch {
            guard !hasShutdown, discoveryGeneration == generation else { return }
            availableDevices = []
            if session != nil { sessionEnded(error.localizedDescription) }
            else if reconnect.target != nil { connectionMessage = error.localizedDescription; appendLog(connectionMessage) }
            else { connectionState = .failed; connectionMessage = error.localizedDescription }
        }
    }
    private func updateReadyState() {
        guard !isMirroring else { return }
        if let device = availableDevices.first(where: { $0.id == selectedDeviceID }) {
            switch device.availability { case .ready: connectionState = .ready; case .unauthorized: connectionState = .unauthorized; case .offline: connectionState = .disconnected }
            connectionMessage = device.availability == .ready ? "USB 기기를 인식했습니다. 화면 보기를 시작하세요." : device.status
        } else { connectionState = .idle; connectionMessage = platform == .android ? "Android 폰을 연결하고 USB 디버깅을 켜주세요." : "아이폰을 연결하고 잠금 해제 후 ‘이 컴퓨터를 신뢰’를 선택하세요." }
    }
    func startMirroring() {
        guard canStartMirroring else { return }
        let device = DeviceIdentity(platform: platform, id: selectedDeviceID)
        reconnect.userStarted(device)
        var updated = settings; updated.rememberDevice(device); updated.preferredPlatform = platform; updateSettings(updated)
        beginSession(device)
    }
    private func beginSession(_ device: DeviceIdentity) {
        let token = UUID(); sessionGeneration = token; connectionState = .connecting; currentFrame = nil; lastPixelBuffer = nil; videoMetrics = ""
        connectionStartedTime = timeProvider.now; frameCounter = 0; lastMetricsTime = timeProvider.now; isAudioAvailable = false
        connectionMessage = "폰 화면 전송을 시작합니다. 첫 영상 프레임을 기다리고 있어요."
        do {
            let newSession = try sessionFactory.makeSession(for: device, settings: settings); session = newSession
            phoneAudio = device.platform == .android && settings.audioEnabled ? PhoneAudio() : nil
            newSession.callbacks = MirrorSessionCallbacks(
                onFrame: { [weak self] buffer in DispatchQueue.main.async { self?.receive(buffer, token: token) } },
                onAudio: { [weak self] data in DispatchQueue.main.async {
                    guard let self, self.sessionGeneration == token else { return }; self.phoneAudio?.play(data); self.recorder.appendAudio(data, time: CACurrentMediaTime())
                } },
                onLog: { [weak self] text in DispatchQueue.main.async { if self?.sessionGeneration == token { self?.appendLog(text) } } },
                onEnd: { [weak self] text in DispatchQueue.main.async { if self?.sessionGeneration == token { self?.sessionEnded(text) } } },
                onAudioReady: { [weak self] in DispatchQueue.main.async { if self?.sessionGeneration == token { self?.isAudioAvailable = true } } },
                onAudioUnavailable: { [weak self] in DispatchQueue.main.async { if self?.sessionGeneration == token { self?.isAudioAvailable = false } } })
            newSession.start()
        } catch { sessionEnded(error.localizedDescription) }
    }
    private func receive(_ buffer: CVPixelBuffer, token: UUID) {
        guard sessionGeneration == token, !hasShutdown, let image = context.createCGImage(CIImage(cvPixelBuffer: buffer), from: CGRect(x: 0, y: 0, width: CVPixelBufferGetWidth(buffer), height: CVPixelBufferGetHeight(buffer))) else { return }
        currentFrame = image; lastPixelBuffer = buffer; lastFrameTime = timeProvider.now; frameCounter += 1
        if connectionState != .live { connectionState = .live; connectionMessage = "앱 안에서 폰 화면을 보고 있어요."; reconnect.streamBecameLive() }
        if lastFrameTime - lastMetricsTime >= 1 || videoMetrics.isEmpty {
            videoMetrics = "\(image.width) × \(image.height) · \(String(format: "%.1f", Double(frameCounter) / max(0.1, lastFrameTime - lastMetricsTime))) fps"
            lastMetricsTime = lastFrameTime; frameCounter = 0
        }
        if isRecording { recorder.appendVideo(buffer, time: CACurrentMediaTime()) }
    }
    private func releaseSession() {
        sessionGeneration = nil; let previous = session; session = nil; previous?.stop()
        phoneAudio?.stop(); phoneAudio = nil; isAudioAvailable = false
        if isRecording { stopRecording() }
    }
    private func sessionEnded(_ text: String) {
        releaseSession(); appendLog(text); reconnect.streamEnded(at: timeProvider.now)
        updateReconnectState(reason: text)
    }
    private func updateReconnectState(reason: String? = nil) {
        connectionState = reconnect.isWaiting ? .reconnecting : .disconnected
        if reconnect.isExhausted { connectionMessage = "자동 재연결 5회 실패. USB 연결을 확인한 뒤 다시 시작하세요." }
        else if reconnect.isWaiting { connectionMessage = "\(reason.map { $0 + " " } ?? "")같은 폰에 자동 재연결합니다. 재시도 \(reconnect.attemptCount + 1)/5 · 폰에서 USB 디버깅 승인이 필요하면 허용하세요." }
        else { connectionMessage = reason ?? "자동 재연결이 꺼져 있습니다. 직접 화면 보기를 시작할 수 있어요." }
    }
    private func tryReconnect() {
        guard !hasShutdown, session == nil else { return }
        let devices = Dictionary(uniqueKeysWithValues: availableDevices.map { ($0.identity, $0.availability) })
        if let device = reconnect.nextAttempt(devices: devices, at: timeProvider.now, recordingIsBusy: isRecording || isSavingRecording) { selectedDeviceID = device.id; beginSession(device) }
    }
    func stopMirroring() { reconnect.userStopped(); releaseSession(); connectionState = .stopped; connectionMessage = "화면 보기를 종료했습니다." }
    func simulateStreamEndForTest() { session?.interruptForTest() }
    func captureScreenshot(to destination: URL? = nil) {
        guard canSaveFrame, let currentFrame else { return }
        let url: URL
        if let destination { url = destination } else {
            let panel = NSSavePanel(); panel.allowedContentTypes = [.png]; panel.nameFieldStringValue = filename("Screenshot", extension: "png")
            guard panel.runModal() == .OK, let selected = panel.url else { return }; url = selected
        }
        lastSavedURL = nil
        do {
            guard let writer = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil) else { throw MediaError.failed("스크린샷 파일을 열 수 없습니다.") }
            CGImageDestinationAddImage(writer, currentFrame, nil)
            guard CGImageDestinationFinalize(writer) else { throw MediaError.failed("스크린샷 저장에 실패했습니다.") }
            lastSavedURL = url; mediaStatusMessage = "스크린샷 저장: \(url.lastPathComponent)"
        } catch { mediaStatusMessage = error.localizedDescription; appendLog(mediaStatusMessage) }
    }
    func startRecording(to destination: URL? = nil) {
        guard canSaveFrame, let currentFrame, let lastPixelBuffer, !isRecording, !isSavingRecording else { return }
        let url: URL
        if let destination { url = destination } else {
            let panel = NSSavePanel(); panel.allowedContentTypes = [.mpeg4Movie]; panel.nameFieldStringValue = filename("Recording", extension: "mp4")
            guard panel.runModal() == .OK, let selected = panel.url else { return }; url = selected
        }
        do { if FileManager.default.fileExists(atPath: url.path) { try FileManager.default.removeItem(at: url) } }
        catch { mediaStatusMessage = error.localizedDescription; return }
        lastSavedURL = nil; isSavingRecording = true; let token = sessionGeneration
        recorder.start(url: url, width: currentFrame.width + currentFrame.width % 2, height: currentFrame.height + currentFrame.height % 2,
            initial: lastPixelBuffer, includeAudio: platform == .android && isAudioAvailable) { [weak self] error in DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                self.isSavingRecording = false
                if let error { self.mediaStatusMessage = error; return }
                self.recordingURL = url; self.recordingStarted = Date(); self.recordingSeconds = 0; self.isRecording = true
                self.mediaStatusMessage = ""
                if self.sessionGeneration != token || !self.isMirroring { self.stopRecording() }
            } }
    }
    func stopRecording(completion: (() -> Void)? = nil) {
        guard isRecording else { completion?(); return }
        isRecording = false; isSavingRecording = true
        let url = recordingURL
        recorder.finish { [weak self] error in DispatchQueue.main.async { [weak self] in
            guard let self else { completion?(); return }
            self.isSavingRecording = false
            if let error { self.mediaStatusMessage = "녹화 저장 실패: \(error)"; self.appendLog(self.mediaStatusMessage) }
            else if let url { self.lastSavedURL = url; self.mediaStatusMessage = "녹화 저장: \(url.lastPathComponent)" }
            completion?()
        } }
    }
    func revealSavedFile() { if let lastSavedURL { NSWorkspace.shared.activateFileViewerSelecting([lastSavedURL]) } }
    func sendKey(_ code: UInt32) { if settings.controlEnabled && platform == .android && connectionState == .live { session?.sendKey(code) } }
    func sendText(_ text: String) { if !text.isEmpty && settings.controlEnabled && platform == .android && connectionState == .live { session?.sendText(text) } }
    func sendTouch(action: UInt8, point: CGPoint) {
        guard settings.controlEnabled, platform == .android, connectionState == .live, let currentFrame else { return }
        guard [0, 1, 2].contains(action), point.x.isFinite, point.y.isFinite else { return }
        session?.sendTouch(action: action, point: CGPoint(x: min(CGFloat(currentFrame.width - 1), max(0, point.x)), y: min(CGFloat(currentFrame.height - 1), max(0, point.y))), size: CGSize(width: currentFrame.width, height: currentFrame.height))
    }
    private func filename(_ prefix: String, extension ext: String) -> String {
        let format = DateFormatter(); format.dateFormat = "yyyy-MM-dd_HH-mm-ss"; format.timeZone = TimeZone(identifier: "Asia/Seoul")
        return "\(prefix)_\(format.string(from: Date())).\(ext)"
    }
    func shutdown() { hasShutdown = true; timer?.invalidate(); timer = nil; discoveryGeneration = UUID(); stopMirroring() }
}
