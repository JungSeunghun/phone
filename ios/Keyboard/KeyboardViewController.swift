import UIKit

final class KeyboardViewController: UIInputViewController, KeyboardTextDocument {
  private let network = KeyboardConnection()
  private let status = UILabel()
  private var connectedCode: String?
  override func viewDidLoad() {
    super.viewDidLoad()
    let stack = UIStackView()
    stack.axis = .vertical
    stack.spacing = 6
    stack.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(stack)
    NSLayoutConstraint.activate([
      stack.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 6),
      stack.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -6),
      stack.topAnchor.constraint(equalTo: view.topAnchor, constant: 6),
      stack.bottomAnchor.constraint(equalTo: view.bottomAnchor, constant: -6),
    ])
    status.font = .systemFont(ofSize: 12)
    status.numberOfLines = 2
    stack.addArrangedSubview(status)
    let rows: [[String]] =
      ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"].map { row in row.map { String($0) } } + [
        ["🌐", "삭제", "공백", "줄바꿈", "연결"]
      ]
    for keys in rows {
      let row = UIStackView()
      row.distribution = .fillEqually
      row.spacing = 4
      for key in keys {
        let button = UIButton(type: .system)
        button.setTitle(key, for: .normal)
        button.backgroundColor = .secondarySystemBackground
        button.layer.cornerRadius = 5
        button.heightAnchor.constraint(equalToConstant: 38).isActive = true
        button.addAction(UIAction { [weak self] _ in self?.pressed(key) }, for: .touchUpInside)
        row.addArrangedSubview(button)
      }
      stack.addArrangedSubview(row)
    }
    network.onStatus = { [weak self] value in self?.status.text = value }
    network.onCommand = { [weak self] command in
      guard let self, self.hasFullAccess, self.view.window != nil else {
        throw SenderError.inactive
      }
      guard let defaults = UserDefaults(suiteName: SenderSharedContainer.identifier),
        (try? KeyboardConnectionCode.load(defaults))?.rawValue == self.connectedCode
      else { throw SenderError.inactive }
      try command.apply(to: self)
    }
  }
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    connect()
  }
  override func viewWillDisappear(_ animated: Bool) {
    network.stop()
    super.viewWillDisappear(animated)
  }
  private func connect() {
    network.stop()
    guard hasFullAccess else {
      status.text = "컴퓨터 입력: 설정에서 이 키보드의 전체 접근 허용을 켜세요"
      return
    }
    guard let defaults = UserDefaults(suiteName: SenderSharedContainer.identifier),
      let code = try? KeyboardConnectionCode.load(defaults)
    else {
      status.text = "Phone Mirror Sender 앱에서 키보드 연결 코드를 저장하세요"
      return
    }
    network.start(code)
    connectedCode = code.rawValue
  }
  private func pressed(_ key: String) {
    switch key {
    case "🌐": advanceToNextInputMode()
    case "삭제": deleteBackward()
    case "공백": insertText(" ")
    case "줄바꿈": insertText("\n")
    case "연결": connect()
    default: insertText(key)
    }
  }
  func insertText(_ text: String) { textDocumentProxy.insertText(text) }
  func deleteBackward() { textDocumentProxy.deleteBackward() }
  func deleteForward() {
    if let selected = textDocumentProxy.selectedText, !selected.isEmpty {
      textDocumentProxy.deleteBackward()
      return
    }
    guard let after = textDocumentProxy.documentContextAfterInput, !after.isEmpty else { return }
    textDocumentProxy.adjustTextPosition(byCharacterOffset: 1)
    textDocumentProxy.deleteBackward()
  }
  func adjustTextPosition(byCharacterOffset offset: Int) {
    textDocumentProxy.adjustTextPosition(byCharacterOffset: offset)
  }
}
