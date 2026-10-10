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
    static func run(_ path: String, _ arguments: [String]) async -> (Int32, String) {
        await withCheckedContinuation { continuation in
            DispatchQueue.global(qos: .utility).async {
                let process = Process(), pipe = Pipe()
                process.executableURL = URL(fileURLWithPath: path)
                process.arguments = arguments
                process.environment = environment
                process.standardOutput = pipe; process.standardError = pipe
                do {
                    try process.run()
                    DispatchQueue.global().asyncAfter(deadline: .now() + 12) {
                        if process.isRunning {
                            process.terminate()
                            DispatchQueue.global().asyncAfter(deadline: .now() + 2) {
                                if process.isRunning { kill(process.processIdentifier, SIGKILL) }
                            }
                        }
                    }
                    let data = pipe.fileHandleForReading.readDataToEndOfFile()
                    process.waitUntilExit()
                    continuation.resume(returning: (process.terminationStatus, String(decoding: data, as: UTF8.self)))
                } catch { continuation.resume(returning: (-1, error.localizedDescription)) }
            }
        }
    }
}
