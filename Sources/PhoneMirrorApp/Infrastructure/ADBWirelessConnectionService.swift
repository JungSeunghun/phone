import Foundation
import PhoneMirrorCore

struct ADBCommandResult: Sendable { let exitCode: Int32; let output: String }
protocol ADBCommandExecuting: Sendable { func execute(_ arguments: [String], standardInput: String?) async throws -> ADBCommandResult }
struct ADBCommandExecutor: ADBCommandExecuting {
    func execute(_ arguments: [String], standardInput: String? = nil) async throws -> ADBCommandResult {
        try Task.checkCancellation()
        guard let adb = ProcessCommandRunner.locate("adb") else { throw MediaError.failed("ADB가 없습니다. 설치 안내를 확인하세요.") }
        let (code, output) = await ProcessCommandRunner.run(adb, arguments, standardInput: standardInput)
        try Task.checkCancellation()
        return ADBCommandResult(exitCode: code, output: output)
    }
}
protocol WirelessConnectionService {
    func discoverServices() async throws -> [WirelessService]
    func pair(address: String, code: String) async throws
    func connect(address: String) async throws
}
struct ADBWirelessConnectionService: WirelessConnectionService {
    let executor: any ADBCommandExecuting
    init(executor: any ADBCommandExecuting = ADBCommandExecutor()) { self.executor = executor }
    func discoverServices() async throws -> [WirelessService] {
        let result = try await executor.execute(["mdns", "services"], standardInput: nil)
        guard result.exitCode == 0 else { throw MediaError.failed("무선 기기 검색 실패. 같은 Wi-Fi와 무선 디버깅 설정을 확인하거나 주소로 직접 연결하세요.") }
        return ADBServiceParser.parse(result.output)
    }
    func pair(address: String, code: String) async throws {
        guard let request = WirelessPairingRequest(address: address, code: code) else { throw MediaError.failed("유효한 IP 주소:포트와 6자리 숫자 코드를 입력하세요.") }
        // Never put the ephemeral secret into process arguments, settings, or error messages.
        let result = try await executor.execute(["pair", request.endpoint.address], standardInput: request.code + "\n")
        guard result.exitCode == 0, result.output.contains("Successfully paired") else { throw MediaError.failed("페어링 실패. 폰의 현재 페어링 주소와 코드를 확인하세요. 시간이 초과됐다면 다시 시도하세요.") }
    }
    func connect(address: String) async throws {
        guard let endpoint = WirelessEndpoint(address: address) else { throw MediaError.failed("IP 주소와 1~65535 범위의 연결 포트를 입력하세요.") }
        let result = try await executor.execute(["connect", endpoint.address], standardInput: nil)
        let output = result.output.trimmingCharacters(in: .whitespacesAndNewlines)
        guard result.exitCode == 0, output.hasPrefix("connected to ") || output.hasPrefix("already connected to ") else { throw MediaError.failed("Wi-Fi 연결 실패. 페어링 포트가 아닌 무선 디버깅 화면의 연결 포트를 확인하세요.") }
    }
}
