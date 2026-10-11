import Foundation

/// UI authorization state is independent of SwiftUI, persistence and network callbacks.
public struct SenderSetupState {
  private var generation = UUID()
  public private(set) var canBroadcast = false
  public init() {}
  public mutating func prepare(code: String) throws -> UUID {
    _ = try SenderConnectionCode(code)
    invalidate()
    return generation
  }
  public mutating func invalidate() {
    generation = UUID()
    canBroadcast = false
  }
  public mutating func complete(token: UUID, connected: Bool) {
    guard token == generation else { return }
    canBroadcast = connected
  }
  public func isCurrent(_ token: UUID) -> Bool { token == generation }
}
public struct SenderRetryPolicy {
  private var attempts = 0
  public init() {}
  public mutating func nextDelay() -> Int? {
    guard attempts < 5 else { return nil }
    let delay = 1 << attempts
    attempts += 1
    return delay
  }
  public mutating func reset() { attempts = 0 }
}

/// Scan authorization and code acceptance are independent of camera APIs and persistence.
public struct SenderConnectionScanState {
  public enum Phase: Equatable {
    case idle, requestingPermission, scanning, accepted, denied, unavailable
  }
  public private(set) var phase: Phase = .idle
  public private(set) var message = ""
  private var generation = UUID()
  public init() {}
  public mutating func begin() -> UUID {
    generation = UUID()
    phase = .requestingPermission
    message = "카메라 접근을 확인하고 있습니다."
    return generation
  }
  public mutating func completePermission(token: UUID, granted: Bool) -> Bool {
    guard token == generation, phase == .requestingPermission else { return false }
    phase = granted ? .scanning : .denied
    message = granted ? "컴퓨터 앱의 연결 QR 코드를 비추세요." : "설정에서 카메라 접근을 허용하거나 연결 코드를 직접 입력하세요."
    return granted
  }
  public mutating func receive(token: UUID, payload: String) -> String? {
    guard token == generation, phase == .scanning else { return nil }
    guard (try? SenderConnectionCode(payload)) != nil else {
      message = "Phone Mirror 연결 QR 코드가 아닙니다. 컴퓨터 앱의 QR 코드를 비추세요."
      return nil
    }
    phase = .accepted
    message = "QR 코드를 읽었습니다."
    return payload.trimmingCharacters(in: .whitespacesAndNewlines)
  }
  public mutating func fail(token: UUID) {
    guard token == generation, phase == .scanning else { return }
    phase = .unavailable
    message = "카메라를 사용할 수 없습니다. 다시 시도하거나 연결 코드를 직접 입력하세요."
  }
  public mutating func cancel() {
    generation = UUID()
    phase = .idle
    message = ""
  }
}

/// Sender-side socket pressure policy, independent of Network.framework and encoder APIs.
public struct SenderAdaptiveQualityPolicy {
  public private(set) var bitRate = 6_000_000
  private var previous = -Double.infinity
  private var changed = -Double.infinity
  private var poor = 0
  private var good = 0
  private var peak = 0.0
  public init() {}
  public mutating func observe(nowMilliseconds: Double, sendMilliseconds: Double) -> Int? {
    guard nowMilliseconds.isFinite, nowMilliseconds >= 0, nowMilliseconds >= previous,
      sendMilliseconds.isFinite, sendMilliseconds >= 0, sendMilliseconds <= 60_000
    else { return nil }
    peak = max(peak, sendMilliseconds)
    guard nowMilliseconds - previous >= 1000 else { return nil }
    previous = nowMilliseconds
    poor = peak >= 150 ? poor + 1 : 0
    good = peak <= 40 ? good + 1 : 0
    peak = 0
    let next =
      poor >= 3 && nowMilliseconds - changed >= 15_000
      ? max(1_500_000, bitRate / 2)
      : good >= 10 && nowMilliseconds - changed >= 30_000 ? min(6_000_000, bitRate * 2) : bitRate
    guard next != bitRate else { return nil }
    bitRate = next
    changed = nowMilliseconds
    poor = 0
    good = 0
    return next
  }
}
