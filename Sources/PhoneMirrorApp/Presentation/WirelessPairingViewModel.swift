import SwiftUI
import PhoneMirrorCore

enum WirelessOperationState { case idle, searching, pairing, connecting, paired, connected, failed }

@MainActor
final class WirelessPairingViewModel: ObservableObject {
    @Published var pairingAddress = ""
    @Published var pairingCode = ""
    @Published var connectionAddress = ""
    @Published private(set) var services: [WirelessService] = []
    @Published private(set) var state: WirelessOperationState = .idle
    @Published private(set) var statusMessage = "폰과 맥을 같은 Wi-Fi에 연결하고 폰의 무선 디버깅을 켜주세요."
    private let service: any WirelessConnectionService
    private let onDevicesChanged: () -> Void
    private var operation: Task<Void, Never>?
    private var generation = UUID()
    var isBusy: Bool { [.searching, .pairing, .connecting].contains(state) }
    var canPair: Bool { !isBusy && WirelessPairingRequest(address: pairingAddress, code: pairingCode) != nil }
    var canConnect: Bool { !isBusy && WirelessEndpoint(address: connectionAddress) != nil }
    init(service: any WirelessConnectionService = ADBWirelessConnectionService(), onDevicesChanged: @escaping () -> Void = {}) {
        self.service = service; self.onDevicesChanged = onDevicesChanged
    }
    func refreshServices() async {
        guard !isBusy else { return }
        let token = UUID(); generation = token; state = .searching
        do {
            let scanned = try await service.discoverServices()
            guard generation == token, !Task.isCancelled else { return }
            services = scanned; state = .idle
            statusMessage = scanned.isEmpty ? "검색된 무선 기기가 없습니다. 같은 Wi-Fi를 확인하거나 폰의 주소로 직접 페어링하세요." : "검색된 주소를 선택하세요. 페어링 포트와 연결 포트는 서로 다릅니다."
        } catch {
            guard generation == token, !Task.isCancelled else { return }
            services = []; state = .failed; statusMessage = "무선 검색 실패. 주소를 직접 입력해서 페어링하거나 연결할 수 있습니다."
        }
    }
    func selectService(_ value: WirelessService) {
        guard !isBusy, services.contains(value) else { return }
        if value.kind == .pairing { pairingAddress = value.endpoint.address }
        else { connectionAddress = value.endpoint.address }
    }
    func pair() {
        guard canPair, let request = WirelessPairingRequest(address: pairingAddress, code: pairingCode) else { return }
        let token = UUID(); generation = token; state = .pairing; pairingCode = ""
        let originalName = services.first { $0.kind == .pairing && $0.endpoint == request.endpoint }?.name
        operation = Task { [weak self] in
            guard let self else { return }
            do {
                try await service.pair(address: request.endpoint.address, code: request.code)
                guard generation == token, !Task.isCancelled else { return }
                let scanned = (try? await service.discoverServices()) ?? []
                guard generation == token, !Task.isCancelled else { return }
                services = scanned
                let name = originalName ?? scanned.first { $0.kind == .pairing && $0.endpoint == request.endpoint }?.name
                if let name, let connection = scanned.first(where: { $0.kind == .connection && $0.name == name }) {
                    state = .connecting; connectionAddress = connection.endpoint.address
                    try await service.connect(address: connection.endpoint.address)
                    guard generation == token, !Task.isCancelled else { return }
                    state = .connected; statusMessage = "Wi-Fi 연결 완료. 기기 목록에서 Wi-Fi 폰을 선택해 화면 보기를 시작하세요."
                } else {
                    state = .paired; statusMessage = "페어링 완료. 목록에 폰이 나타나지 않으면 무선 디버깅 화면의 연결 주소로 연결하세요."
                }
                onDevicesChanged(); operation = nil
            } catch {
                guard generation == token, !Task.isCancelled else { return }
                state = .failed; statusMessage = "페어링 또는 연결 실패. 폰의 현재 코드와 주소를 확인하고 다시 시도하세요."; operation = nil
            }
        }
    }
    func connect() {
        guard canConnect, let endpoint = WirelessEndpoint(address: connectionAddress) else { return }
        let token = UUID(); generation = token; state = .connecting
        operation = Task { [weak self] in
            guard let self else { return }
            do {
                try await service.connect(address: endpoint.address)
                guard generation == token, !Task.isCancelled else { return }
                state = .connected; statusMessage = "Wi-Fi 연결 완료. 기기 목록에서 Wi-Fi 폰을 선택하세요."; onDevicesChanged()
            } catch {
                guard generation == token, !Task.isCancelled else { return }
                state = .failed; statusMessage = "Wi-Fi 연결 실패. 페어링과 연결 포트를 확인하세요."
            }
            operation = nil
        }
    }
    func cancel() { generation = UUID(); operation?.cancel(); operation = nil; pairingCode = ""; state = .idle }
}
