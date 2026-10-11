import XCTest
@testable import PhoneMirrorCore

final class ReconnectionTests: XCTestCase {
    let target = ConnectionTarget(identity: DeviceIdentity(platform: .android, id: "A"), transport: .usb)
    let other = ConnectionTarget(identity: DeviceIdentity(platform: .android, id: "B"), transport: .usb)
    func armedPolicy() -> ReconnectionPolicy {
        var policy = ReconnectionPolicy(); policy.userStarted(target); policy.streamBecameLive(); policy.streamEnded(at: 100)
        return policy
    }
    func testLaunchNeverStartsAConnectionWithoutUserIntent() {
        var policy = ReconnectionPolicy()
        XCTAssertNil(policy.nextAttempt(devices: [target: .ready], at: 1000))
    }
    func testExactFirstRetryTimeBoundary() {
        var policy = armedPolicy()
        XCTAssertNil(policy.nextAttempt(devices: [target: .ready], at: 100.999))
        XCTAssertEqual(policy.nextAttempt(devices: [target: .ready], at: 101), target)
        XCTAssertNil(policy.nextAttempt(devices: [target: .ready], at: 1000), "Do not duplicate an in-flight attempt")
    }
    func testOnlyOriginalDeviceCanReconnect() {
        var policy = armedPolicy()
        XCTAssertNil(policy.nextAttempt(devices: [other: .ready], at: 101))
        XCTAssertEqual(policy.target, target)
        XCTAssertEqual(policy.nextAttempt(devices: [other: .ready, target: .ready], at: 102), target)
    }
    func testMissingUnauthorizedAndOfflineDevicesDoNotConsumeAttempts() {
        for availability in [DeviceAvailability.unauthorized, .offline] {
            var policy = armedPolicy()
            XCTAssertNil(policy.nextAttempt(devices: [:], at: 101))
            XCTAssertNil(policy.nextAttempt(devices: [target: availability], at: 1000))
            XCTAssertEqual(policy.attemptCount, 0)
            XCTAssertEqual(policy.nextAttempt(devices: [target: .ready], at: 1001), target)
        }
    }
    func testManualStopCancelsPendingAndLateFailureCallbacks() {
        var policy = armedPolicy(); policy.userStopped(); policy.streamEnded(at: 101)
        XCTAssertNil(policy.target)
        XCTAssertNil(policy.nextAttempt(devices: [target: .ready], at: 1000))
    }
    func testDisabledReconnectDoesNotRunAndReenablePreservesSessionIntent() {
        var policy = armedPolicy(); policy.isEnabled = false
        XCTAssertNil(policy.nextAttempt(devices: [target: .ready], at: 102))
        policy.isEnabled = true
        XCTAssertEqual(policy.nextAttempt(devices: [target: .ready], at: 102), target)
        policy.userStopped(); policy.isEnabled = false; policy.isEnabled = true
        XCTAssertNil(policy.nextAttempt(devices: [target: .ready], at: 999))
    }
    func testRetryBackoffAndMaximumAttempts() {
        var policy = armedPolicy()
        var time: TimeInterval = 100
        for delay in [1.0, 2, 4, 8, 16] {
            XCTAssertNil(policy.nextAttempt(devices: [target: .ready], at: time + delay - 0.001))
            time += delay
            XCTAssertEqual(policy.nextAttempt(devices: [target: .ready], at: time), target)
            policy.streamEnded(at: time)
        }
        XCTAssertEqual(policy.attemptCount, 5)
        XCTAssertNil(policy.nextAttempt(devices: [target: .ready], at: time + 1000))
        XCTAssertTrue(policy.isExhausted)
    }
    func testSuccessfulFrameResetsFailureBackoff() {
        var policy = armedPolicy()
        _ = policy.nextAttempt(devices: [target: .ready], at: 101)
        policy.streamBecameLive(); policy.streamEnded(at: 200)
        XCTAssertEqual(policy.attemptCount, 0)
        XCTAssertEqual(policy.nextAttempt(devices: [target: .ready], at: 201), target)
    }
    func testRecordingFinalizationPausesReconnectWithoutConsumingAttempts() {
        var policy = armedPolicy()
        XCTAssertNil(policy.nextAttempt(devices: [target: .ready], at: 101, recordingIsBusy: true))
        XCTAssertEqual(policy.attemptCount, 0)
        XCTAssertEqual(policy.nextAttempt(devices: [target: .ready], at: 102, recordingIsBusy: false), target)
    }
    func testInvalidTimesCannotTriggerRetries() {
        for time in [Double.nan, Double.infinity, -Double.infinity] {
            var policy = armedPolicy()
            XCTAssertNil(policy.nextAttempt(devices: [target: .ready], at: time))
        }
    }
    func testChangingTargetRequiresNewUserStart() {
        var policy = armedPolicy(); let ios = ConnectionTarget(identity: DeviceIdentity(platform: .iOS, id: "A"), transport: .usb)
        policy.userStopped(); policy.userStarted(ios); policy.streamEnded(at: 0)
        XCTAssertNil(policy.nextAttempt(devices: [target: .ready], at: 1))
        XCTAssertEqual(policy.nextAttempt(devices: [target: .ready, ios: .ready], at: 1), ios)
    }
    func testInvalidTargetsCannotArmAutomaticReconnect() {
        for target in [ConnectionTarget(identity: DeviceIdentity(platform: .android, id: ""), transport: .wifi), ConnectionTarget(identity: DeviceIdentity(platform: .iOS, id: "A"), transport: .wifi)] {
            var policy = ReconnectionPolicy(); policy.userStarted(target); policy.streamEnded(at: 100)
            XCTAssertNil(policy.target); XCTAssertNil(policy.nextAttempt(devices: [target: .ready], at: 101))
        }
    }

}
