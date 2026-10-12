import Network
import SwiftUI

struct KeyboardSetupView: View {
    @AppStorage(ApplicationLanguagePreferences.storageKey, store: UserDefaults(suiteName: SenderSharedContainer.identifier)!) private var languageCode = "ko"
    private func localizedText(_ text: String) -> String { (ApplicationLanguage(rawValue: languageCode) ?? .korean).translate(text) }

  @State private var code = ""
  @State private var message = ""
  @State private var probe: NWConnection?
  @State private var setup = KeyboardSetupState()
  private let defaults = UserDefaults(suiteName: SenderSharedContainer.identifier)!
  var body: some View {
    Section(localizedText("컴퓨터 키보드 입력")) {
      Text(localizedText("컴퓨터에서 iPhone 키보드 연결을 시작하고 아래에 PMK1 코드를 붙여 넣으세요. USB 영상 연결과도 함께 사용할 수 있으며 입력은 같은 로컬 네트워크로 전달합니다."))
      TextField(localizedText("PMK1 키보드 연결 코드"), text: $code, axis: .vertical).textInputAutocapitalization(.never)
        .autocorrectionDisabled().privacySensitive().onChange(of: code) { _ in cancel() }
      Button(localizedText("키보드 연결 코드 저장")) { save() }.disabled(
        setup.checking || (try? KeyboardConnectionCode(code)) == nil)
      Button(localizedText("키보드 연결 코드 삭제")) {
        cancel()
        defaults.removeObject(forKey: "keyboardConnectionCode.v1")
        code = ""
        message = "키보드 연결 코드를 삭제했습니다. 열려 있는 키보드도 다른 키보드로 전환하세요."
      }
      Text(localizedText("설정 → 일반 → 키보드 → 키보드 → 새로운 키보드 추가에서 Phone Mirror를 추가하고 ‘전체 접근 허용’을 켜세요. 입력할 앱의 텍스트 칸을 누르고 지구본 버튼으로 Phone Mirror 키보드를 선택하면 컴퓨터에서 붙여넣기와 다국어 직접 입력을 사용할 수 있습니다."))
      Text(localizedText("선택한 입력칸에만 입력합니다. 비밀번호·전화번호 칸과 외부 키보드를 차단한 앱은 지원하지 않습니다. 키보드를 닫으면 연결을 종료합니다. 기존 연결이 끊겼다면 키보드의 ‘연결’ 버튼을 누르세요."))
      if !message.isEmpty { Text(localizedText(message)).accessibilityIdentifier("keyboardSetupStatus") }
    }.onAppear { code = (try? KeyboardConnectionCode.load(defaults))?.rawValue ?? "" }
      .onDisappear { cancel() }
  }
  private func cancel() {
    setup.invalidate()
    probe?.cancel()
    probe = nil
  }
  private func save() {
    cancel()
    guard let value = try? KeyboardConnectionCode(code) else { return }
    guard let token = try? setup.prepare(code) else { return }
    message = "로컬 네트워크 접근을 허용하고 컴퓨터 연결을 확인하세요."
    let connection = NWConnection(
      host: NWEndpoint.Host(value.endpoint.host),
      port: NWEndpoint.Port(rawValue: value.endpoint.port)!, using: .tcp)
    probe = connection
    connection.stateUpdateHandler = { state in
      guard setup.isCurrent(token) else { return }
      switch state {
      case .ready:
        do {
          try value.save(defaults)
          message = "코드를 저장했습니다. 설정에서 키보드를 추가하고 전체 접근 허용을 켜세요."
        } catch { message = "키보드 코드를 저장할 수 없습니다." }
        cancel()
      case .failed:
        message = "컴퓨터 키보드 연결과 로컬 네트워크 권한을 확인하세요."
        cancel()
      default: break
      }
    }
    connection.start(queue: .main)
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) {
      guard setup.isCurrent(token) else { return }
      message = "연결 시간이 초과됐습니다."
      cancel()
    }
  }
}
