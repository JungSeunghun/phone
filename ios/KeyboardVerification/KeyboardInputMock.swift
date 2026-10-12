import Foundation
import PhoneMirrorSenderCore

/// Synthetic document, using the production network and command implementation. No phone capture.
@main struct KeyboardInputMock {
  static func main() throws {
    guard CommandLine.arguments.count == 2 else { throw SenderError.invalidCode }
    let code = try KeyboardConnectionCode(
      String(contentsOfFile: CommandLine.arguments[1], encoding: .utf8))
    let document = SyntheticDocument()
    let connection = KeyboardConnection()
    var count = 0
    connection.onCommand = { command in
      try command.apply(to: document)
      count += 1
      if count == 7 {
        guard document.text == "한日中ع😀e\u{301}한日中ع😀e\u{301}Z\n", document.offsets == [-1, 1] else {
          throw SenderError.invalidPacket
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
          connection.stop()
          print(
            "PASS: production Swift keyboard TCP received ordered Unicode and editing commands into a synthetic document"
          )
          exit(0)
        }
      }
    }
    connection.start(code)
    DispatchQueue.main.asyncAfter(deadline: .now() + 12) {
      connection.stop()
      fputs("Keyboard verification timed out\n", stderr)
      exit(1)
    }
    RunLoop.main.run()
  }
}
private final class SyntheticDocument: KeyboardTextDocument {
  var text = "", offsets: [Int] = []
  func insertText(_ text: String) { self.text += text }
  func deleteBackward() { if !text.isEmpty { text.removeLast() } }
  func deleteForward() {}
  func adjustTextPosition(byCharacterOffset offset: Int) { offsets.append(offset) }
}
