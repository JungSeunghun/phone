import Foundation
import Network

/// Serial sender with byte reservations before dispatch, generation guards and bounded retries.
public final class SenderNetwork {
  private let adaptiveQuality: Bool
  private var qualityPolicy = SenderAdaptiveQualityPolicy()
  public var onVideoBitRateChanged: ((Int) -> Void)?
  private let code: SenderConnectionCode
  private let hello: SenderHello
  private let queue = DispatchQueue(label: "phoneMirror.sender.network")
  private let budget = SenderSendBudget()
  private let lock = NSLock()
  private var ready = false
  private var generation: UInt64 = 0
  private var stopped = false
  private var connection: NWConnection?
  private var listener: NWListener?
  private var cipher: SenderPacketCipher?
  private var heartbeat: DispatchSourceTimer?
  private var retry: DispatchWorkItem?
  private var retries = SenderRetryPolicy()
  public var onReady: (() -> Void)?
  public var onFailure: ((String) -> Void)?
  public var isReady: Bool {
    lock.lock()
    defer { lock.unlock() }
    return ready && !stopped
  }
  public init(code: SenderConnectionCode, hello: SenderHello, adaptiveQuality: Bool = false) {
    self.adaptiveQuality = adaptiveQuality && code.transport == .wifi
    self.code = code
    self.hello = hello
  }
  public func start() {
    queue.async {
      guard self.connection == nil, self.listener == nil, !self.stopped else { return }
      self.connect()
    }
  }
  private func setReady(_ value: Bool) {
    lock.lock()
    ready = value
    lock.unlock()
  }
  private func connect() {
    if code.transport == .usb {
      listenUsb()
      return
    }
    let connection = NWConnection(
      host: NWEndpoint.Host(code.host), port: NWEndpoint.Port(rawValue: code.port)!, using: .tcp)
    begin(connection)
  }
  private func listenUsb() {
    guard !stopped, listener == nil else { return }
    lock.lock()
    generation &+= 1
    let token = generation
    lock.unlock()
    setReady(false)
    do {
      let parameters = NWParameters.tcp
      parameters.requiredLocalEndpoint = .hostPort(
        host: "127.0.0.1", port: NWEndpoint.Port(rawValue: code.port)!)
      let listener = try NWListener(using: parameters)
      self.listener = listener
      listener.stateUpdateHandler = { [weak self] state in
        guard let self, token == self.generation, !self.stopped else { return }
        if case .failed = state { self.reconnect(token: token) }
      }
      listener.newConnectionHandler = { [weak self] connection in
        guard let self, token == self.generation, !self.stopped, self.connection == nil else {
          connection.cancel()
          return
        }
        self.begin(connection)
      }
      listener.start(queue: queue)
    } catch { fail("USB 송출 포트를 열 수 없습니다. 다른 화면 방송을 종료하고 다시 시작하세요.") }
  }
  private func begin(_ connection: NWConnection) {
    lock.lock()
    generation &+= 1
    let token = generation
    lock.unlock()
    setReady(false)
    cipher = nil
    qualityPolicy = SenderAdaptiveQualityPolicy()
    self.connection = connection
    connection.stateUpdateHandler = { [weak self] state in
      guard let self else { return }
      guard token == self.generation, !self.stopped else { return }
      switch state {
      case .ready: self.challenge(connection, token: token)
      case .failed: self.reconnect(token: token)
      case .waiting: self.reconnect(token: token)
      default: break
      }
    }
    connection.start(queue: queue)
    queue.asyncAfter(deadline: .now() + 8) { [weak self] in
      guard let self, token == self.generation, !self.isReady, !self.stopped else { return }
      self.reconnect(token: token)
    }
  }
  private func challenge(_ connection: NWConnection, token: UInt64) {
    connection.receive(minimumIncompleteLength: 20, maximumLength: 20) {
      [weak self] data, _, complete, error in
      guard let self, token == self.generation, !self.stopped else { return }
      guard error == nil, !complete, let data, data.count == 20, data.prefix(4) == Data("PMW1".utf8)
      else {
        self.reconnect(token: token)
        return
      }
      do {
        self.cipher = try SenderPacketCipher(
          secret: self.code.secret, challenge: Data(data.dropFirst(4)))
        let packet = try self.cipher!.seal(kind: 1, payload: JSONEncoder().encode(self.hello))
        connection.send(
          content: packet,
          completion: .contentProcessed { [weak self] error in
            guard let self, token == self.generation, !self.stopped else { return }
            if error != nil {
              self.reconnect(token: token)
              return
            }
            self.onReady?()
            self.setReady(true)
            self.startHeartbeat()
            self.queue.asyncAfter(deadline: .now() + 10) { [weak self] in
              guard let self, token == self.generation, self.isReady else { return }
              self.retries.reset()
            }
            connection.receive(minimumIncompleteLength: 1, maximumLength: 1) {
              [weak self] _, _, _, _ in self?.reconnect(token: token)
            }
          })
      } catch { self.fail("송출 연결 코드를 확인하세요.") }
    }
  }
  public func send(kind: UInt8, payload: Data) {
    guard isReady else { return }
    let size = payload.count + 29
    guard size <= 4 * 1024 * 1024 + 29, budget.reserve(size) else {
      queue.async { self.fail("네트워크가 느려 송출 대기열 한도를 넘었습니다.") }
      return
    }
    lock.lock()
    let token = generation
    lock.unlock()
    queue.async { [self] in
      guard token == generation, isReady, let connection, let cipher else {
        budget.release(size)
        return
      }
      do {
        let data = try cipher.seal(kind: kind, payload: payload)
        let sentAt = DispatchTime.now().uptimeNanoseconds
        connection.send(
          content: data,
          completion: .contentProcessed { [weak self, budget] error in
            budget.release(size)
            guard let self, token == self.generation, !self.stopped else { return }
            if error != nil {
              self.reconnect(token: token)
            } else if kind == 2 && self.adaptiveQuality {
              let now = DispatchTime.now().uptimeNanoseconds
              if let rate = self.qualityPolicy.observe(
                nowMilliseconds: Double(now) / 1_000_000,
                sendMilliseconds: Double(now - sentAt) / 1_000_000)
              {
                self.onVideoBitRateChanged?(rate)
              }
            }
          })
      } catch {
        budget.release(size)
        fail("송출 데이터를 암호화할 수 없습니다.")
      }
    }
  }
  private func startHeartbeat() {
    heartbeat?.cancel()
    let timer = DispatchSource.makeTimerSource(queue: queue)
    timer.schedule(deadline: .now() + 1, repeating: 1)
    timer.setEventHandler { [weak self] in self?.send(kind: 4, payload: Data()) }
    heartbeat = timer
    timer.resume()
  }
  private func reconnect(token: UInt64) {
    guard token == generation, !stopped else { return }
    lock.lock()
    generation &+= 1
    lock.unlock()
    setReady(false)
    heartbeat?.cancel()
    heartbeat = nil
    connection?.cancel()
    connection = nil
    listener?.cancel()
    listener = nil
    cipher = nil
    retry?.cancel()
    guard let delay = retries.nextDelay() else {
      fail("송출 연결이 끊겼습니다. 수신 대기와 연결 코드를 확인하세요.")
      return
    }
    let generation = self.generation
    let task = DispatchWorkItem { [weak self] in
      guard let self, generation == self.generation, !self.stopped else { return }
      self.connect()
    }
    retry = task
    queue.asyncAfter(deadline: .now() + .seconds(delay), execute: task)
  }
  private func fail(_ message: String) {
    guard !stopped else { return }
    stopOnQueue()
    onFailure?(message)
  }
  private func stopOnQueue() {
    lock.lock()
    stopped = true
    ready = false
    generation &+= 1
    lock.unlock()
    heartbeat?.cancel()
    heartbeat = nil
    retry?.cancel()
    retry = nil
    connection?.cancel()
    connection = nil
    listener?.cancel()
    listener = nil
    cipher = nil
  }
  public func stop() { queue.async { self.stopOnQueue() } }
  deinit {
    heartbeat?.cancel()
    retry?.cancel()
    connection?.cancel()
    listener?.cancel()
  }
}
