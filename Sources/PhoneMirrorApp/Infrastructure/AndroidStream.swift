import Foundation
import Darwin
import CoreVideo

struct AndroidStreamOptions {
    let deviceID: String
    let videoMaxDimension: Int
    let videoMaxFrameRate: Int
    let audioEnabled: Bool
    let keepScreenAwake: Bool
}

final class AndroidStream {
    var onFrame: ((CVPixelBuffer) -> Void)?
    var onAudio: ((Data) -> Void)?
    var onLog: ((String) -> Void)?
    var onEnd: ((String) -> Void)?
    var onAudioUnavailable: (() -> Void)?
    var onAudioReady: (() -> Void)?
    private let lock = NSLock()
    private var ended = false
    private var sockets: Set<Int32> = []
    private var controller: Int32 = -1
    private var process: Process?
    private var port: Int?
    private var serial = ""
    private let controls = DispatchQueue(label: "phone.controls")
    private let decoder = VideoDecoder()
    private var stopped: Bool { lock.lock(); defer { lock.unlock() }; return ended }
    static var serverURL: URL { Bundle.main.resourceURL!.appendingPathComponent("scrcpy-server-v5.0") }
    func start(_ options: AndroidStreamOptions) {
        serial = options.deviceID
        decoder.onFrame = { [weak self] buffer in self?.onFrame?(buffer) }
        Task { [self] in
            guard let adb = ProcessCommandRunner.locate("adb"), FileManager.default.fileExists(atPath: Self.serverURL.path) else {
                finish("ADB 또는 앱의 화면 전송 모듈이 없습니다."); return
            }
            let id = UInt32.random(in: 1...0x7fffffff), scid = String(format: "%08x", id)
            let remote = "/data/local/tmp/phone-mirror-\(scid).jar"
            let pushed = await ProcessCommandRunner.run(adb, ["-s", serial, "push", Self.serverURL.path, remote])
            guard pushed.0 == 0 else { finish("전송 모듈 설치 실패: \(pushed.1)"); return }
            guard !stopped else { _ = await ProcessCommandRunner.run(adb, ["-s", serial, "shell", "rm", "-f", remote]); return }
            let forwarded = await ProcessCommandRunner.run(adb, ["-s", serial, "forward", "tcp:0", "localabstract:scrcpy_\(scid)"])
            guard forwarded.0 == 0, let assigned = Int(forwarded.1.trimmingCharacters(in: .whitespacesAndNewlines)) else {
                _ = await ProcessCommandRunner.run(adb, ["-s", serial, "shell", "rm", "-f", remote])
                finish("USB 영상 채널 연결 실패: \(forwarded.1)"); return
            }
            let cancelled = lock.withLock { port = assigned; return ended }
            if cancelled { cleanupForward(); _ = await ProcessCommandRunner.run(adb, ["-s", serial, "shell", "rm", "-f", remote]); return }
            let server = Process(), pipe = Pipe()
            server.executableURL = URL(fileURLWithPath: adb)
            server.environment = ProcessCommandRunner.environment
            server.arguments = ["-s", serial, "shell", "CLASSPATH=\(remote)", "app_process", "/", "com.genymobile.scrcpy.Server", "5.0",
                "scid=\(scid)", "tunnel_forward=true", "send_device_meta=false", "audio=\(options.audioEnabled)", "audio_codec=raw",
                "video_codec=h264", "max_size=\(options.videoMaxDimension)", "max_fps=\(options.videoMaxFrameRate)", "video_bit_rate=8000000",
                "stay_awake=\(options.keepScreenAwake)", "control=true", "clipboard_autosync=false", "log_level=info"]
            server.standardOutput = pipe; server.standardError = pipe
            pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData
                if data.isEmpty { handle.readabilityHandler = nil; return }
                self?.onLog?(String(decoding: data, as: UTF8.self))
            }
            server.terminationHandler = { [weak self] _ in self?.finish("폰과의 영상 연결이 종료됐습니다. USB 연결과 폰 잠금을 확인하세요.") }
            do {
                let launched = try lock.withLock { () throws -> Bool in
                    if ended { return false }
                    process = server; try server.run(); return true
                }
                if !launched { pipe.fileHandleForReading.readabilityHandler = nil; cleanupForward(); return }
                DispatchQueue.global(qos: .userInitiated).async { [self] in
                    do {
                        let video = try connectVideo(port: assigned)
                        var handedToReader = false
                        defer { if !handedToReader { releaseSocket(video) } }
                        if options.audioEnabled {
                            let audio = try connectSocket(port: assigned)
                            DispatchQueue.global(qos: .userInitiated).async { [self] in receiveAudio(audio) }
                        }
                        let control = try connectSocket(port: assigned)
                        lock.lock(); controller = control; lock.unlock()
                        DispatchQueue.global().async { [self] in
                            defer { releaseSocket(control) }
                            var bytes = [UInt8](repeating: 0, count: 1024)
                            while !stopped {
                                let n = bytes.withUnsafeMutableBytes { recv(control, $0.baseAddress, $0.count, 0) }
                                if n <= 0 { break }
                            }
                        }
                        handedToReader = true
                        try receiveVideo(video)
                        finish("USB 영상 스트림이 끊겼습니다. 케이블을 다시 연결해 주세요.")
                    } catch { if !stopped { finish(error.localizedDescription) } }
                }
            } catch { pipe.fileHandleForReading.readabilityHandler = nil; finish("화면 전송 실행 실패: \(error.localizedDescription)") }
        }
    }
    private func connectSocket(port: Int) throws -> Int32 {
        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw MediaError.failed("USB 영상 소켓 생성 실패") }
        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size); address.sin_family = sa_family_t(AF_INET)
        address.sin_port = UInt16(port).bigEndian; address.sin_addr.s_addr = inet_addr("127.0.0.1")
        let result = withUnsafePointer(to: &address) { $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { Darwin.connect(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) } }
        if result != 0 { close(fd); throw MediaError.failed("USB 영상 채널에 연결할 수 없습니다.") }
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &yes, socklen_t(MemoryLayout.size(ofValue: yes)))
        var timeout = timeval(tv_sec: 2, tv_usec: 0)
        setsockopt(fd, SOL_SOCKET, SO_SNDTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout)))
        lock.lock()
        if ended { lock.unlock(); close(fd); throw MediaError.failed("연결 취소됨") }
        sockets.insert(fd); lock.unlock()
        return fd
    }
    private func connectVideo(port: Int) throws -> Int32 {
        for _ in 0..<80 {
            if stopped { throw MediaError.failed("연결 취소됨") }
            let fd = try connectSocket(port: port)
            var timeout = timeval(tv_sec: 1, tv_usec: 0)
            setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout)))
            if (try? readExactly(fd, count: 1)) != nil {
                timeout = timeval(tv_sec: 0, tv_usec: 0)
                setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, socklen_t(MemoryLayout.size(ofValue: timeout)))
                return fd
            }
            releaseSocket(fd); Thread.sleep(forTimeInterval: 0.1)
        }
        throw MediaError.failed("폰의 화면 전송이 응답하지 않습니다. USB 디버깅 승인을 확인해 주세요.")
    }
    private func readExactly(_ fd: Int32, count: Int) throws -> Data {
        guard count >= 0 && count <= 16 * 1024 * 1024 else { throw MediaError.failed("잘못된 영상 패킷 크기") }
        var bytes = [UInt8](repeating: 0, count: count), offset = 0
        while offset < count {
            let n = bytes.withUnsafeMutableBytes { recv(fd, $0.baseAddress!.advanced(by: offset), count - offset, 0) }
            if n < 0 && errno == EINTR { continue }
            guard n > 0 else { throw MediaError.failed("영상 채널 연결 끊김") }
            offset += n
        }
        return Data(bytes)
    }
    private func receiveVideo(_ fd: Int32) throws {
        defer { decoder.close(); releaseSocket(fd) }
        guard try readExactly(fd, count: 4).unsigned(0, 4) == 0x68323634 else { throw MediaError.failed("지원하지 않는 영상 형식") }
        while !stopped {
            let header = try readExactly(fd, count: 12)
            let flags = header.unsigned(0, 8)
            if flags & (1 << 63) != 0 {
                onLog?("영상 크기: \(header.unsigned(4, 4)) × \(header.unsigned(8, 4))")
                continue
            }
            let payload = try readExactly(fd, count: Int(header.unsigned(8, 4)))
            try decoder.decode(payload, pts: flags & ((1 << 61) - 1))
        }
    }
    private func receiveAudio(_ fd: Int32) {
        defer { releaseSocket(fd) }
        do {
            let codec = try readExactly(fd, count: 4).unsigned(0, 4)
            guard codec == 0x00726177 else { onLog?("이 폰에서 소리 전송을 사용할 수 없습니다."); onAudioUnavailable?(); return }
            onAudioReady?()
            while !stopped {
                let header = try readExactly(fd, count: 12)
                let payload = try readExactly(fd, count: Int(header.unsigned(8, 4)))
                if header.unsigned(0, 8) & (1 << 62) == 0 { onAudio?(payload) }
            }
        } catch { if !stopped { onLog?("오디오 연결 중단: \(error.localizedDescription)"); onAudioUnavailable?() } }
    }
    private func releaseSocket(_ fd: Int32) {
        lock.lock(); sockets.remove(fd); if controller == fd { controller = -1 }; close(fd); lock.unlock()
    }
    func send(_ data: Data) {
        controls.async { [self] in
            lock.lock(); defer { lock.unlock() }
            guard !ended, controller >= 0 else { return }
            data.withUnsafeBytes { bytes in
                var offset = 0
                while offset < bytes.count {
                    let n = Darwin.send(controller, bytes.baseAddress!.advanced(by: offset), bytes.count - offset, 0)
                    if n < 0 && errno == EINTR { continue }
                    if n <= 0 { return }; offset += n
                }
            }
        }
    }
    func sendTouch(action: UInt8, x: Int, y: Int, width: Int, height: Int) {
        var data = Data([2, action]); data.appendBE(UInt64.max - 1)
        data.appendBE(UInt32(clamping: x)); data.appendBE(UInt32(clamping: y))
        data.appendBE(UInt16(clamping: width)); data.appendBE(UInt16(clamping: height))
        data.appendBE(UInt16(action == 1 ? 0 : 65535)); data.appendBE(UInt32(0)); data.appendBE(UInt32(0)); send(data)
    }
    func sendKey(_ code: UInt32) {
        for action: UInt8 in [0, 1] {
            var data = Data([0, action]); data.appendBE(code); data.appendBE(UInt32(0)); data.appendBE(UInt32(0)); send(data)
        }
    }
    func sendText(_ text: String) {
        let utf8 = Data(text.utf8)
        guard utf8.count <= 300 else { return }
        var data = Data([1]); data.appendBE(UInt32(utf8.count)); data.append(utf8); send(data)
    }
    func stop() { finish(nil) }
    func interruptForTest() { lock.withLock { sockets.forEach { _ = shutdown($0, SHUT_RDWR) } } }
    private func finish(_ reason: String?) {
        lock.lock()
        guard !ended else { lock.unlock(); return }
        ended = true
        sockets.forEach { _ = shutdown($0, SHUT_RDWR) }
        let process = self.process; self.process = nil
        lock.unlock()
        if let process, process.isRunning { process.terminate() }
        cleanupForward()
        if let reason { onEnd?(reason) }
    }
    private func cleanupForward() {
        lock.lock(); let assigned = port; port = nil; lock.unlock()
        guard let assigned, let adb = ProcessCommandRunner.locate("adb") else { return }
        Task { _ = await ProcessCommandRunner.run(adb, ["-s", serial, "forward", "--remove", "tcp:\(assigned)"]) }
    }
}
