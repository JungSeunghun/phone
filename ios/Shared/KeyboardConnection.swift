import Foundation
import Network

/// Runs on the main queue; commands are acknowledged only after insertion into the host document.
public final class KeyboardConnection {
  public init() {}
  private var connection: NWConnection?
  private var generation: UInt64 = 0
  private var incoming: KeyboardPacketCipher?
  private var outgoing: KeyboardPacketCipher?
  public var onStatus: ((String) -> Void)?
  public var onCommand: ((KeyboardInputCommand) throws -> Void)?
  public func start(_ code: KeyboardConnectionCode) {
    stop()
    let token = generation
    let connection = NWConnection(
      host: NWEndpoint.Host(code.endpoint.host),
      port: NWEndpoint.Port(rawValue: code.endpoint.port)!, using: .tcp)
    self.connection = connection
    onStatus?("컴퓨터에 연결 중…")
    connection.stateUpdateHandler = { [weak self] state in
      guard let self, token == self.generation else { return }
      switch state {
      case .ready: self.challenge(code, token: token)
      case .failed, .waiting: self.fail(token)
      default: break
      }
    }
    connection.start(queue: .main)
    DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in
      guard let self, token == self.generation, self.incoming == nil else { return }
      self.fail(token)
    }
  }
  private func challenge(_ code: KeyboardConnectionCode, token: UInt64) {
    receive(20, token: token) { [weak self] challenge in
      guard let self else { return }
      do {
        guard challenge.prefix(4) == Data("PMK1".utf8) else { throw SenderError.invalidPacket }
        self.incoming = try KeyboardPacketCipher(
          secret: code.endpoint.secret, challenge: Data(challenge.dropFirst(4)),
          direction: "desktop")
        self.outgoing = try KeyboardPacketCipher(
          secret: code.endpoint.secret, challenge: Data(challenge.dropFirst(4)),
          direction: "keyboard")
        self.send(Data("{\"kind\":\"hello\"}".utf8), token: token) {
          self.readCommand(token, ready: false)
        }
      } catch { self.fail(token) }
    }
  }
  private func readCommand(_ token: UInt64, ready: Bool) {
    receive(4, token: token) { [weak self] header in
      guard let self else { return }
      let size = header.reduce(UInt32(0)) { ($0 << 8) | UInt32($1) }
      guard (25...2 * 1024 * 1024).contains(size) else {
        self.fail(token)
        return
      }
      self.receive(Int(size), token: token) { [weak self] body in
        guard let self else { return }
        do {
          guard let incoming = self.incoming else { throw SenderError.inactive }
          let payload = try incoming.open(header + body)
          if !ready {
            guard payload == Data("{\"kind\":\"ready\"}".utf8) else {
              throw SenderError.invalidPacket
            }
            self.onStatus?("연결됨 · 컴퓨터에서 다국어 입력 가능")
            self.readCommand(token, ready: true)
          } else {
            guard let apply = self.onCommand else { throw SenderError.inactive }
            try apply(KeyboardInputCommand.decode(payload))
            self.send(Data("{\"kind\":\"ack\"}".utf8), token: token) {
              self.readCommand(token, ready: true)
            }
          }
        } catch { self.fail(token) }
      }
    }
  }
  private func send(_ data: Data, token: UInt64, completion: @escaping () -> Void) {
    do {
      guard token == generation, let outgoing, let connection else { return }
      connection.send(
        content: try outgoing.seal(data),
        completion: .contentProcessed { [weak self] error in
          guard let self, token == self.generation else { return }
          if error != nil { self.fail(token) } else { completion() }
        })
    } catch { fail(token) }
  }
  private func receive(
    _ size: Int, token: UInt64, accumulated: Data = Data(), completion: @escaping (Data) -> Void
  ) {
    guard token == generation, let connection else { return }
    connection.receive(minimumIncompleteLength: 1, maximumLength: size - accumulated.count) {
      [weak self] data, _, ended, error in
      guard let self, token == self.generation else { return }
      guard error == nil, let data, !data.isEmpty else {
        self.fail(token)
        return
      }
      let value = accumulated + data
      if value.count == size {
        completion(value)
      } else if ended {
        self.fail(token)
      } else {
        self.receive(size, token: token, accumulated: value, completion: completion)
      }
    }
  }
  private func fail(_ token: UInt64) {
    guard token == generation else { return }
    stop()
    onStatus?("연결 종료 · 연결 버튼으로 다시 연결하세요")
  }
  public func stop() {
    generation &+= 1
    connection?.cancel()
    connection = nil
    incoming = nil
    outgoing = nil
  }
  deinit { connection?.cancel() }
}
