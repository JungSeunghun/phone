import Network
import ReplayKit
import SwiftUI
import UIKit

@main
struct PhoneMirrorSenderApp: App { var body: some Scene { WindowGroup { SenderView() } } }
struct SenderView: View {
  @State private var scanningCode = false
  @State private var probe: NWConnection?
  @State private var setup = SenderSetupState()
  @State private var code = ""
  @State private var dimension = 1920
  @State private var frameRate = 30
  @State private var adaptiveQuality = true
  @State private var audio = true
  @State private var message = ""
  private let defaults = UserDefaults(suiteName: SenderSharedContainer.identifier)!
  var body: some View {
    NavigationStack {
      Form {
        Section("1. 컴퓨터에서 수신 대기 켜기") {
          Text(
            "Mac 또는 Windows의 Phone Mirror에서 ‘iPhone 수신 시작’을 켜세요. Wi-Fi 연결은 같은 네트워크를 사용하세요. Windows USB 연결은 ‘iPhone USB 수신 시작’을 켜고 USB 케이블과 컴퓨터 신뢰를 확인하세요."
          )
        }
        Section("2. 연결 코드 저장") {
          Button("QR 코드 스캔") { scanningCode = true }
            .accessibilityIdentifier("scanConnectionCode")
          TextField("PMW1 또는 PMU1 연결 코드", text: $code, axis: .vertical).textInputAutocapitalization(
            .never
          ).autocorrectionDisabled().privacySensitive().onChange(of: code) { _ in invalidateProbe()
          }
          Picker("최대 해상도", selection: $dimension) {
            ForEach([720, 1280, 1920], id: \.self) { Text("\($0)px").tag($0) }
          }.onChange(of: dimension) { _ in invalidateProbe() }
          Picker("프레임", selection: $frameRate) {
            ForEach([15, 30, 60], id: \.self) { Text("\($0) fps").tag($0) }
          }.onChange(of: frameRate) { _ in invalidateProbe() }
          Toggle("Wi-Fi 자동 화질", isOn: $adaptiveQuality).onChange(of: adaptiveQuality) { _ in
            invalidateProbe()
          }
          Text("Wi-Fi 전송이 느려지면 영상 비트레이트를 낮추고 안정되면 회복합니다. 해상도와 소리는 유지합니다.")
          Toggle("앱 소리 송출", isOn: $audio).onChange(of: audio) { _ in invalidateProbe() }
          Button("연결 코드 저장") { save() }.disabled((try? SenderConnectionCode(code)) == nil)
          Text(message).accessibilityIdentifier("senderStatus")
        }
        Section("3. 화면 송출 시작") {
          BroadcastPicker(enabled: setup.canBroadcast).frame(height: 60)
          Text(
            "시스템 화면 방송 창에서 송출을 시작하세요. 종료는 iPhone의 화면 방송 표시에서 할 수 있습니다. 마이크는 사용하지 않습니다. 콘텐츠에 따라 화면·앱 소리 송출이 제한될 수 있습니다."
          )
        }
      }
    }.navigationTitle("Phone Mirror Sender").onAppear { restore() }
      .sheet(isPresented: $scanningCode) {
        NavigationStack {
          ConnectionCodeScannerView { scannedCode in
            invalidateProbe()
            code = scannedCode
            message = "QR 코드를 읽었습니다. 연결 코드 저장을 누른 뒤 화면 방송을 시작하세요."
            scanningCode = false
          }.navigationTitle("연결 QR 코드 스캔")
            .toolbar {
              ToolbarItem(placement: .cancellationAction) {
                Button("취소") { scanningCode = false }
              }
            }
        }
      }
  }
  private func save() {
    do {
      let id = defaults.string(forKey: "senderDeviceId") ?? UUID().uuidString
      defaults.set(id, forKey: "senderDeviceId")
      let p = try SenderPreferences(
        connectionCode: code, deviceId: id,
        deviceName: String(UIDevice.current.name.unicodeScalars.prefix(80)).trimmingCharacters(
          in: .whitespacesAndNewlines),
        dimension: dimension, frameRate: frameRate, audio: audio, adaptiveQuality: adaptiveQuality)
      try p.save(defaults)
      checkNetwork(try SenderConnectionCode(code))
    } catch {
      setup.invalidate()
      message = "연결 코드를 확인하세요."
    }
  }
  private func invalidateProbe() {
    setup.invalidate()
    probe?.cancel()
    probe = nil
  }
  private func checkNetwork(_ code: SenderConnectionCode) {
    invalidateProbe()
    guard let token = try? setup.prepare(code: self.code) else { return }
    if code.transport == .usb {
      setup.complete(token: token, connected: true)
      message = "USB 코드를 저장했습니다. 아래에서 화면 방송을 시작하고 Windows에서 iPhone을 선택하세요."
      return
    }
    message = "로컬 네트워크 접근을 허용하고 수신 대기를 확인하세요."
    let connection = NWConnection(
      host: NWEndpoint.Host(code.host), port: NWEndpoint.Port(rawValue: code.port)!, using: .tcp)
    probe = connection
    connection.stateUpdateHandler = { state in
      DispatchQueue.main.async {
        guard setup.isCurrent(token) else { return }
        switch state {
        case .ready:
          setup.complete(token: token, connected: true)
          message = "연결을 확인했습니다. 아래에서 화면 방송을 시작하세요."
          connection.cancel()
          probe = nil
        case .failed:
          setup.invalidate()
          message = "컴퓨터 수신 대기와 로컬 네트워크 권한을 확인하세요."
          connection.cancel()
          probe = nil
        default: break
        }
      }
    }
    connection.start(queue: .main)
    DispatchQueue.main.asyncAfter(deadline: .now() + 15) {
      guard setup.isCurrent(token), !setup.canBroadcast else { return }
      invalidateProbe()
      message = "연결 시간이 초과됐습니다. 권한과 수신 대기를 확인하세요."
    }
  }
  private func restore() {
    if let p = try? SenderPreferences.load(defaults) {
      code = p.connectionCode
      dimension = p.dimension
      frameRate = p.frameRate
      audio = p.audio
      adaptiveQuality = p.adaptiveQuality ?? true
      setup.invalidate()
      message = "연결 코드를 저장해 네트워크 권한을 확인하세요."
    }
  }
}
struct BroadcastPicker: UIViewRepresentable {
  let enabled: Bool
  func makeUIView(context: Context) -> RPSystemBroadcastPickerView {
    let view = RPSystemBroadcastPickerView(frame: .zero)
    view.preferredExtension = (Bundle.main.bundleIdentifier ?? "local.phone.sender") + ".Broadcast"
    view.showsMicrophoneButton = false
    view.accessibilityLabel = "화면 송출 시작"
    return view
  }
  func updateUIView(_ view: RPSystemBroadcastPickerView, context: Context) {
    view.isUserInteractionEnabled = enabled
    view.alpha = enabled ? 1 : 0.35
  }
}
