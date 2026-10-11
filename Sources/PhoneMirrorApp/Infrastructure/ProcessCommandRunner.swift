import Foundation

enum ProcessCommandRunner {
    static func locate(_ name: String) -> String? {
        let directories = ["/opt/homebrew/bin", "/usr/local/bin"] +
            (ProcessInfo.processInfo.environment["PATH"] ?? "").split(separator: ":").map(String.init)
        return directories.map { $0 + "/" + name }.first { FileManager.default.isExecutableFile(atPath: $0) }
    }
    static var environment: [String: String] {
        var env = ProcessInfo.processInfo.environment
        env["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:" + (env["PATH"] ?? "")
        if let adb = locate("adb") { env["ADB"] = adb }
        return env
    }
    static func run(_ path: String, _ arguments: [String], standardInput: String? = nil, timeout: TimeInterval = 12) async -> (Int32, String) {
        guard timeout.isFinite, timeout > 0, timeout <= 60 else { return (-1, "유효하지 않은 실행 제한 시간") }
        let execution = CancellableProcessExecution()
        return await withTaskCancellationHandler(operation: {
            await withCheckedContinuation { continuation in
                DispatchQueue.global(qos: .utility).async {
                    let process = Process(), output = Pipe(), input = Pipe()
                    process.executableURL = URL(fileURLWithPath: path); process.arguments = arguments; process.environment = environment
                    process.standardOutput = output; process.standardError = output
                    process.standardInput = standardInput == nil ? FileHandle.nullDevice : input.fileHandleForReading
                    let deadline = DispatchWorkItem { execution.cancel() }
                    defer { deadline.cancel(); execution.clear() }
                    do {
                        guard try execution.start(process) else { continuation.resume(returning: (-1, "연결 작업 취소")); return }
                        DispatchQueue.global().asyncAfter(deadline: .now() + timeout, execute: deadline)
                        if let standardInput { try input.fileHandleForWriting.write(contentsOf: Data(standardInput.utf8)); try input.fileHandleForWriting.close() }
                        let data = output.fileHandleForReading.readDataToEndOfFile(); process.waitUntilExit()
                        continuation.resume(returning: (process.terminationStatus, String(decoding: data, as: UTF8.self)))
                    } catch { if process.isRunning { execution.cancel() }; continuation.resume(returning: (-1, error.localizedDescription)) }
                }
            }
        }, onCancel: { execution.cancel() })
    }
}

/// Starting and cancelling are serialized so cancellation before launch cannot lose the process.
private final class CancellableProcessExecution: @unchecked Sendable {
    private let lock = NSLock()
    private var process: Process?
    private var cancelled = false
    func start(_ process: Process) throws -> Bool {
        try lock.withLock { guard !cancelled else { return false }; self.process = process; try process.run(); return true }
    }
    func clear() { lock.withLock { process = nil } }
    func cancel() {
        let active = lock.withLock { cancelled = true; return process }
        guard let active, active.isRunning else { return }; active.terminate()
        DispatchQueue.global().asyncAfter(deadline: .now() + 2) { if active.isRunning { kill(active.processIdentifier, SIGKILL) } }
    }
}
