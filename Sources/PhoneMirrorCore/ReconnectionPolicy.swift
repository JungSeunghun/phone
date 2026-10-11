import Foundation

/// Session intent survives transport failures, but never a user stop or app launch.
/// The caller supplies monotonic time and is responsible for session generation tokens.
public struct ReconnectionPolicy: Sendable {
    public var isEnabled: Bool
    public private(set) var target: ConnectionTarget?
    public private(set) var attemptCount = 0
    public private(set) var nextAttemptTime: TimeInterval?
    private var isAttemptInFlight = false
    public static let retryDelays: [TimeInterval] = [1, 2, 4, 8, 16]
    public var isExhausted: Bool { attemptCount >= Self.retryDelays.count }
    public var isWaiting: Bool { isEnabled && target != nil && !isAttemptInFlight && !isExhausted && nextAttemptTime != nil }
    public init(isEnabled: Bool = true) { self.isEnabled = isEnabled }
    public mutating func userStarted(_ identity: ConnectionTarget) {
        guard identity.isValid else { userStopped(); return }
        target = identity; attemptCount = 0; nextAttemptTime = nil; isAttemptInFlight = true
    }
    public mutating func userStopped() { target = nil; attemptCount = 0; nextAttemptTime = nil; isAttemptInFlight = false }
    public mutating func streamBecameLive() {
        guard target != nil else { return }
        attemptCount = 0; nextAttemptTime = nil; isAttemptInFlight = true
    }
    public mutating func streamEnded(at time: TimeInterval) {
        guard target != nil, time.isFinite, time >= 0 else { return }
        isAttemptInFlight = false
        nextAttemptTime = isExhausted ? nil : time + Self.retryDelays[attemptCount]
    }
    public mutating func nextAttempt(devices: [ConnectionTarget: DeviceAvailability], at time: TimeInterval, recordingIsBusy: Bool = false) -> ConnectionTarget? {
        guard time.isFinite, time >= 0, isWaiting, !recordingIsBusy, let target,
              devices[target] == .ready, let nextAttemptTime, time >= nextAttemptTime else { return nil }
        attemptCount += 1; self.nextAttemptTime = nil; isAttemptInFlight = true
        return target
    }
}
