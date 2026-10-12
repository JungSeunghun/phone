import Foundation
import Network
import XCTest
@testable import PhoneMirrorSenderCore

final class KeyboardConnectionTests: XCTestCase {
  @MainActor
  func testChallengeWithoutAuthenticatedReadyExpires() async throws {
    let listener = try NWListener(using: .tcp, on: .any)
    let listening = expectation(description: "listener ready")
    let hello = expectation(description: "hello received")
    let expired = expectation(description: "authentication expired")
    let peers = TestConnections()
    listener.stateUpdateHandler = { state in
      if case .ready = state { listening.fulfill() }
    }
    listener.newConnectionHandler = { connection in
      peers.values.append(connection)
      connection.stateUpdateHandler = { state in
        if case .ready = state {
          connection.send(content: Data("PMK1".utf8) + Data(repeating: 7, count: 16),
                          completion: .contentProcessed { _ in })
          connection.receive(minimumIncompleteLength: 44, maximumLength: 44) { data, _, _, error in
            XCTAssertNil(error)
            XCTAssertEqual(data?.count, 44)
            hello.fulfill()
          }
        }
      }
      connection.start(queue: .main)
    }
    listener.start(queue: .main)
    defer { peers.values.forEach { $0.cancel() }; listener.cancel() }
    await fulfillment(of: [listening], timeout: 2)
    let keyboard = KeyboardConnection()
    defer { keyboard.stop() }
    keyboard.onStatus = { status in
      if status.contains("연결 종료") { expired.fulfill() }
    }
    keyboard.start(try KeyboardConnectionCode(
      "PMK1|127.0.0.1:\(listener.port!.rawValue)|" + String(repeating: "01", count: 32)))
    await fulfillment(of: [hello], timeout: 2)
    await fulfillment(of: [expired], timeout: 9)
  }
}

// All mutations happen on the main queue used by the test listeners.
private final class TestConnections: @unchecked Sendable {
  var values: [NWConnection] = []
}

extension KeyboardConnectionTests {
  @MainActor
  func testAuthenticatedReadyAndOldDeadlinesDoNotCloseNewConnection() async throws {
    let listener = try NWListener(using: .tcp, on: .any)
    let listening = expectation(description: "listener ready")
    let authenticated = expectation(description: "two authenticated connections")
    authenticated.expectedFulfillmentCount = 2
    let peers = TestConnections()
    let secret = Data(repeating: 1, count: 32)
    let challenge = Data(repeating: 7, count: 16)
    listener.stateUpdateHandler = { state in
      if case .ready = state { listening.fulfill() }
    }
    listener.newConnectionHandler = { connection in
      peers.values.append(connection)
      connection.stateUpdateHandler = { state in
        if case .ready = state {
          connection.send(content: Data("PMK1".utf8) + challenge,
                          completion: .contentProcessed { _ in })
          connection.receive(minimumIncompleteLength: 44, maximumLength: 44) { data, _, _, _ in
            do {
              let cipher = try KeyboardPacketCipher(secret: secret, challenge: challenge, direction: "desktop")
              connection.send(content: try cipher.seal(Data("{\"kind\":\"ready\"}".utf8)),
                              completion: .contentProcessed { _ in })
            } catch { XCTFail("Fixture encryption failed: \(error)") }
          }
        }
      }
      connection.start(queue: .main)
    }
    listener.start(queue: .main)
    defer { peers.values.forEach { $0.cancel() }; listener.cancel() }
    await fulfillment(of: [listening], timeout: 2)
    var deadlines: [() -> Void] = []
    var statuses: [String] = []
    let keyboard = KeyboardConnection(scheduleAuthenticationTimeout: { delay, callback in
      XCTAssertEqual(delay, 8)
      deadlines.append(callback)
    })
    defer { keyboard.stop() }
    let first = expectation(description: "first ready")
    keyboard.onStatus = { status in
      statuses.append(status)
      if status.hasPrefix("연결됨") {
        authenticated.fulfill()
        if deadlines.count == 1 { first.fulfill() }
      }
    }
    let code = try KeyboardConnectionCode("PMK1|127.0.0.1:\(listener.port!.rawValue)|" + String(repeating: "01", count: 32))
    keyboard.start(code)
    await fulfillment(of: [first], timeout: 2)
    deadlines[0]() // Current deadline after successful authentication.
    keyboard.start(code)
    deadlines[0]() // Previous deadline while the next authentication is pending.
    await fulfillment(of: [authenticated], timeout: 2)
    deadlines[1]()
    keyboard.stop()
    deadlines[1]() // Callback delivered after explicit cancellation.
    XCTAssertFalse(statuses.contains(where: { $0.contains("연결 종료") }))
  }
}
