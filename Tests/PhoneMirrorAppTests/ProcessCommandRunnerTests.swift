import XCTest
@testable import PhoneMirrorApp

final class ProcessCommandRunnerTests: XCTestCase {
    func testStandardInputIsDeliveredAndClosedWithoutUsingArguments() async {
        let result = await ProcessCommandRunner.run("/bin/cat", [], standardInput: "test-input\n")
        XCTAssertEqual(result.0, 0); XCTAssertEqual(result.1, "test-input\n")
    }
    func testCancellationStopsARealChildProcessPromptly() async {
        let started = Date()
        let task = Task { await ProcessCommandRunner.run("/bin/sleep", ["10"]) }
        try? await Task.sleep(nanoseconds: 100_000_000); task.cancel()
        let result = await task.value
        XCTAssertNotEqual(result.0, 0); XCTAssertLessThan(Date().timeIntervalSince(started), 3)
    }
    func testTimeoutStopsARealChildProcessAndReportsFailure() async {
        let result = await ProcessCommandRunner.run("/bin/sleep", ["10"], timeout: 0.1)
        XCTAssertNotEqual(result.0, 0)
    }
    func testInvalidTimeoutsNeverStartChildProcess() async {
        for timeout in [0.0, -1, .nan, .infinity] {
            let result = await ProcessCommandRunner.run("/bin/cat", [], timeout: timeout)
            XCTAssertEqual(result.0, -1); XCTAssertFalse(result.1.isEmpty)
        }
    }

}
