import PhoneMirrorLocalization
import SwiftUI
import PhoneMirrorCore

struct WirelessPairingView: View {
    @AppStorage(ApplicationLanguagePreferences.storageKey, store: .standard) private var languageCode = "ko"
    private func localizedText(_ text: String) -> String { (ApplicationLanguage(rawValue: languageCode) ?? .korean).translate(text) }

    @StateObject private var model: WirelessPairingViewModel
    @Environment(\.dismiss) private var dismiss
    init(onDevicesChanged: @escaping () -> Void) { _model = StateObject(wrappedValue: WirelessPairingViewModel(onDevicesChanged: onDevicesChanged)) }
    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack {
                Label(localizedText("Android Wi-Fi 연결"), systemImage: "wifi").font(.title2.bold())
                Spacer(); Button(localizedText("닫기")) { model.cancel(); dismiss() }
            }
            Text(localizedText("같은 Wi-Fi에 연결한 뒤 폰의 개발자 옵션 → 무선 디버깅 → 페어링 코드로 기기 페어링을 여세요.")).foregroundStyle(.secondary)
            HStack { Text(localizedText("검색된 무선 기기")).font(.headline); Spacer(); Button(localizedText("다시 검색")) { Task { await model.refreshServices() } }.disabled(model.isBusy) }
            ScrollView {
                if model.services.isEmpty { Text(localizedText("기기가 검색되지 않으면 아래에 주소를 직접 입력하세요.")).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading) }
                ForEach(model.services) { service in
                    Button { model.selectService(service) } label: {
                        HStack {
                            Image(systemName: service.kind == .pairing ? "key" : "wifi")
                            Text(service.name).lineLimit(1); Spacer()
                            Text(service.kind == .pairing ? "페어링" : "연결").foregroundStyle(.secondary)
                            Text(service.endpoint.address).font(.caption.monospaced())
                        }.padding(8)
                    }.buttonStyle(.bordered).disabled(model.isBusy)
                }
            }.frame(height: 110)
            Divider()
            Text(localizedText("처음 연결 · 페어링")).font(.headline)
            TextField(localizedText("페어링 IP 주소:포트"), text: $model.pairingAddress).textFieldStyle(.roundedBorder).disabled(model.isBusy)
            HStack {
                SecureField(localizedText("6자리 페어링 코드"), text: $model.pairingCode).textFieldStyle(.roundedBorder).disabled(model.isBusy)
                Button(localizedText("페어링")) { model.pair() }.buttonStyle(.borderedProminent).disabled(!model.canPair)
            }
            Text(localizedText("코드는 저장하지 않습니다. 페어링 화면의 포트를 사용하세요.")).font(.caption).foregroundStyle(.secondary)
            Divider()
            Text(localizedText("페어링한 폰 · 직접 연결")).font(.headline)
            HStack {
                TextField(localizedText("연결 IP 주소:포트"), text: $model.connectionAddress).textFieldStyle(.roundedBorder).disabled(model.isBusy)
                Button(localizedText("연결")) { model.connect() }.disabled(!model.canConnect)
            }
            Text(localizedText("무선 디버깅 기본 화면의 연결 포트입니다. 페어링 포트와 다릅니다.")).font(.caption).foregroundStyle(.secondary)
            HStack {
                if model.isBusy { ProgressView().controlSize(.small) }
                Text(localizedText(model.statusMessage)).font(.callout).fixedSize(horizontal: false, vertical: true)
                Spacer()
                if model.isBusy { Button(localizedText("작업 취소")) { model.cancel() } }
            }
        }.padding(24).frame(width: 560).preferredColorScheme(.dark)
        .task { await model.refreshServices() }.onDisappear { model.cancel() }
    }
}
