import SwiftUI
import AppKit
import PhoneMirrorCore

@MainActor
final class PhoneScreenView: NSView {
    var model: PhoneMirrorViewModel?
    var image: CGImage? { didSet { layer?.contents = image } }
    private var touching = false
    override var isFlipped: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    override init(frame: NSRect) {
        super.init(frame: frame); wantsLayer = true
        layer?.backgroundColor = NSColor.black.cgColor; layer?.contentsGravity = .resizeAspect
    }
    required init?(coder: NSCoder) { fatalError() }
    private func position(_ event: NSEvent, clamp: Bool = false) -> CGPoint? {
        guard let image else { return nil }
        return ScreenCoordinates.map(convert(event.locationInWindow, from: nil), viewport: bounds.size,
            image: CGSize(width: image.width, height: image.height), clamp: clamp)
    }
    override func mouseDown(with event: NSEvent) {
        window?.makeFirstResponder(self)
        if let point = position(event) { touching = true; model?.sendTouch(action: 0, point: point) }
    }
    override func mouseDragged(with event: NSEvent) { if touching, let point = position(event, clamp: true) { model?.sendTouch(action: 2, point: point) } }
    override func mouseUp(with event: NSEvent) { if touching, let point = position(event, clamp: true) { model?.sendTouch(action: 1, point: point) }; touching = false }
    override func rightMouseDown(with event: NSEvent) { model?.sendKey(4) }
    override func keyDown(with event: NSEvent) {
        if event.modifierFlags.contains(.command) {
            if event.charactersIgnoringModifiers == "f" { window?.toggleFullScreen(nil) }
            else if event.charactersIgnoringModifiers == "h" { model?.sendKey(3) }
            else { super.keyDown(with: event) }
            return
        }
        let codes: [UInt16: UInt32] = [36: 66, 51: 67, 53: 4, 48: 61, 123: 21, 124: 22, 125: 20, 126: 19]
        if let code = codes[event.keyCode] { model?.sendKey(code) }
        else if let characters = event.characters { model?.sendText(characters) }
    }
}
struct PhoneScreen: NSViewRepresentable {
    @ObservedObject var model: PhoneMirrorViewModel
    func makeNSView(context: Context) -> PhoneScreenView { let view = PhoneScreenView(frame: .zero); view.model = model; return view }
    func updateNSView(_ view: PhoneScreenView, context: Context) { view.image = model.currentFrame }
}

struct PhoneMirrorView: View {
    @ObservedObject var model: PhoneMirrorViewModel
    @State private var showLog = false
    private func settingsBinding<Value>(_ keyPath: WritableKeyPath<MirrorSettings, Value>) -> Binding<Value> {
        Binding(get: { model.settings[keyPath: keyPath] }, set: { value in var settings = model.settings; settings[keyPath: keyPath] = value; model.updateSettings(settings) })
    }
    var statusColor: Color {
        switch model.connectionState { case .live: return .mint; case .connecting, .reconnecting, .stalled, .unauthorized: return .orange; case .failed, .disconnected: return .red; default: return .secondary }
    }
    var body: some View {
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 18) {
                HStack(spacing: 12) {
                    Image(systemName: "iphone.gen3.radiowaves.left.and.right").font(.system(size: 28)).foregroundStyle(.mint)
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Phone Mirror").font(.system(size: 23, weight: .bold))
                        Text("USB로 연결하는 내 폰 화면").foregroundStyle(.secondary).font(.caption)
                    }
                }
                Picker("폰 종류", selection: Binding(get: { model.platform }, set: { model.selectPlatform($0) })) {
                    ForEach(PhonePlatform.allCases, id: \.self) { Text($0.displayName).tag($0) }
                }.pickerStyle(.segmented).disabled(model.isMirroring || model.isSavingRecording)
                VStack(alignment: .leading, spacing: 12) {
                    HStack { Text("연결된 기기").font(.headline); Spacer(); Button { Task { await model.refreshDevices() } } label: { Image(systemName: "arrow.clockwise") }.buttonStyle(.borderless).help("기기 새로고침") }
                    if model.availableDevices.isEmpty { Text("연결된 기기가 없어요").foregroundStyle(.secondary) }
                    else { Picker("기기", selection: Binding(get: { model.selectedDeviceID }, set: { model.selectDevice($0) })) {
                        if !model.availableDevices.contains(where: { $0.id == model.selectedDeviceID }) && !model.selectedDeviceID.isEmpty { Text("재연결 대기 중인 폰").tag(model.selectedDeviceID) }
                        ForEach(model.availableDevices) { Text("\($0.name) · \($0.status)").tag($0.id) }
                    }.labelsHidden() }
                }.disabled(model.isMirroring || model.isSavingRecording)
                Divider()
                if model.platform == .android {
                    VStack(alignment: .leading, spacing: 14) {
                        Text("화면 설정").font(.headline)
                        Picker("화질", selection: settingsBinding(\.videoMaxDimension)) { Text("빠르게 · 1280px").tag(1280); Text("균형 · 1920px").tag(1920); Text("선명하게 · 2560px").tag(2560) }
                        Picker("프레임", selection: settingsBinding(\.videoMaxFrameRate)) { Text("30 fps").tag(30); Text("60 fps").tag(60) }
                        Toggle("맥에서 폰 소리 듣기", isOn: settingsBinding(\.audioEnabled))
                        Toggle("마우스와 키보드로 조작", isOn: settingsBinding(\.controlEnabled))
                        Toggle("연결 중 폰 화면 켜두기", isOn: settingsBinding(\.keepScreenAwake))
                    }.disabled(model.isMirroring)
                    Toggle("앱을 항상 맨 위에", isOn: settingsBinding(\.alwaysOnTop)).onChange(of: model.settings.alwaysOnTop) { NSApp.windows.first?.level = model.settings.alwaysOnTop ? .floating : .normal }
                } else {
                    Text("USB 화면 보기").font(.headline)
                    Text("아이폰은 화면 보기·스크린샷·영상 녹화를 제공합니다. 조작은 폰에서 해주세요. 소리 재생·녹화는 지원하지 않습니다.").font(.callout).foregroundStyle(.secondary)
                    Text("아이폰 실기기 검증 대기").font(.caption).foregroundStyle(.orange)
                }
                Toggle("연결이 끊기면 자동 재연결", isOn: settingsBinding(\.autoReconnectEnabled))
                if !model.settingsStatusMessage.isEmpty { Text(model.settingsStatusMessage).font(.caption).foregroundStyle(.orange) }
                Spacer(minLength: 0)
                VStack(alignment: .leading, spacing: 9) {
                    HStack { Circle().fill(statusColor).frame(width: 8, height: 8); Text(model.connectionState.rawValue).font(.headline).foregroundStyle(statusColor) }
                    Text(model.connectionMessage).font(.callout).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                }
                Button { model.canStopMirroring ? model.stopMirroring() : model.startMirroring() } label: {
                    HStack { Image(systemName: model.canStopMirroring ? "stop.fill" : "play.fill"); Text(model.canStopMirroring ? "화면 보기 종료" : "폰 화면 보기").fontWeight(.semibold); Spacer() }.padding(.vertical, 7)
                }.buttonStyle(.borderedProminent).tint(.mint).disabled(!model.canStopMirroring && !model.canStartMirroring)
                Button(showLog ? "연결 로그 닫기" : "연결 로그 보기") { showLog.toggle() }.buttonStyle(.plain).font(.caption).foregroundStyle(.secondary)
            }.padding(26).frame(width: 360).frame(maxHeight: .infinity).background(Color(nsColor: .windowBackgroundColor))
            Divider()
            VStack(spacing: 0) {
                HStack(spacing: 12) {
                    Text(model.videoMetrics.isEmpty ? "내 폰 화면" : model.videoMetrics).font(.caption.monospaced()).foregroundStyle(.secondary)
                    Spacer()
                    if model.isRecording { HStack(spacing: 5) { Circle().fill(.red).frame(width: 7, height: 7); Text(String(format: "%02d:%02d", model.recordingSeconds / 60, model.recordingSeconds % 60)).monospacedDigit() }.font(.caption).foregroundStyle(.red) }
                    Button { model.captureScreenshot() } label: { Label("스크린샷", systemImage: "camera") }.disabled(!model.canSaveFrame).keyboardShortcut("s", modifiers: [.command, .shift])
                    Button { model.isRecording ? model.stopRecording() : model.startRecording() } label: { Label(model.isRecording ? "녹화 종료" : model.isSavingRecording ? "저장 중…" : "녹화", systemImage: model.isRecording ? "stop.circle.fill" : "record.circle") }
                        .tint(model.isRecording ? .red : .mint).disabled(model.isSavingRecording || (!model.isRecording && !model.canSaveFrame)).keyboardShortcut("r", modifiers: [.command])
                }.padding(14)
                Divider()
                ZStack {
                    if model.currentFrame != nil {
                        PhoneScreen(model: model)
                        if model.connectionState != .live {
                            VStack { Label(model.connectionState.rawValue, systemImage: "exclamationmark.circle").padding(10).background(.black.opacity(0.75), in: Capsule()); Spacer() }.padding(20)
                        }
                    } else {
                        VStack(spacing: 22) {
                            Image(systemName: model.isConnecting ? "antenna.radiowaves.left.and.right" : "cable.connector").font(.system(size: 62, weight: .light)).foregroundStyle(.mint)
                            Text(model.isConnecting ? "첫 영상 프레임을 기다리고 있어요" : "작은 화면을, 더 넓게.").font(.system(size: 23, weight: .semibold))
                            if model.isConnecting { ProgressView() }
                            else { Text(model.platform == .android ? "USB 연결 → 폰에서 디버깅 허용 → 폰 화면 보기" : "USB 연결 → 잠금 해제 → 컴퓨터 신뢰").font(.callout).foregroundStyle(.secondary) }
                        }.padding(30).frame(maxWidth: .infinity, maxHeight: .infinity)
                    }
                }.frame(maxWidth: .infinity, maxHeight: .infinity)
                Divider()
                HStack {
                    if model.platform == .android {
                        Button { model.sendKey(4) } label: { Label("뒤로", systemImage: "chevron.left") }
                        Button { model.sendKey(3) } label: { Label("홈", systemImage: "house") }
                        Button { model.sendKey(187) } label: { Label("최근 앱", systemImage: "square.on.square") }
                        Spacer()
                        Text(model.isAudioAvailable ? "폰 소리 재생·녹화" : "영상만 녹화").font(.caption).foregroundStyle(.secondary)
                    } else { Text("영상만 녹화 · 터치 조작은 폰에서").font(.caption).foregroundStyle(.secondary); Spacer() }
                }.padding(12).disabled(model.connectionState != .live || !model.settings.controlEnabled)
                if !model.mediaStatusMessage.isEmpty {
                    HStack { Text(model.mediaStatusMessage).font(.caption).lineLimit(2); Spacer(); if model.lastSavedURL != nil { Button("Finder에서 보기") { model.revealSavedFile() }.font(.caption) } }.padding(12).background(Color.mint.opacity(0.08))
                }
                if showLog {
                    Divider()
                    ScrollView { Text(model.connectionLog.isEmpty ? "연결 로그가 아직 없습니다." : model.connectionLog).font(.system(size: 11, design: .monospaced)).textSelection(.enabled).frame(maxWidth: .infinity, alignment: .leading).padding(14) }.frame(height: 130)
                }
            }.background(Color(red: 0.045, green: 0.065, blue: 0.085))
        }.frame(minWidth: 940, minHeight: 700).preferredColorScheme(.dark)
    }
}

