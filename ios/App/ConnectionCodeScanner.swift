import AVFoundation
import SwiftUI
import UIKit

protocol ConnectionCodeCameraPort: AnyObject {
  var previewLayer: AVCaptureVideoPreviewLayer { get }
  func requestPermission(_ completion: @escaping (Bool) -> Void)
  func start(onPayload: @escaping (String) -> Void, onFailure: @escaping () -> Void)
  func stop()
}

/// Camera configuration and capture stay off the UI thread. No photos or audio are captured.
final class SystemConnectionCodeCamera: NSObject, ConnectionCodeCameraPort,
  AVCaptureMetadataOutputObjectsDelegate
{
  private let session = AVCaptureSession()
  private let queue = DispatchQueue(label: "PhoneMirrorSender.ConnectionCodeCamera")
  private var active = false
  private var onPayload: ((String) -> Void)?
  lazy var previewLayer = AVCaptureVideoPreviewLayer(session: session)
  func requestPermission(_ completion: @escaping (Bool) -> Void) {
    switch AVCaptureDevice.authorizationStatus(for: .video) {
    case .authorized: completion(true)
    case .notDetermined: AVCaptureDevice.requestAccess(for: .video, completionHandler: completion)
    default: completion(false)
    }
  }
  func start(onPayload: @escaping (String) -> Void, onFailure: @escaping () -> Void) {
    queue.async { [weak self] in
      guard let self, !self.active else { return }
      self.active = true
      self.onPayload = onPayload
      do {
        try self.configure()
        self.session.startRunning()
      } catch {
        self.active = false
        self.onPayload = nil
        DispatchQueue.main.async(execute: onFailure)
      }
    }
  }
  private func configure() throws {
    guard session.inputs.isEmpty else { return }
    session.beginConfiguration()
    defer { session.commitConfiguration() }
    guard
      let device = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back)
    else { throw SenderError.inactive }
    let input = try AVCaptureDeviceInput(device: device)
    let output = AVCaptureMetadataOutput()
    guard session.canAddInput(input) else { throw SenderError.inactive }
    session.addInput(input)
    guard session.canAddOutput(output) else { throw SenderError.inactive }
    session.addOutput(output)
    guard output.availableMetadataObjectTypes.contains(.qr) else { throw SenderError.inactive }
    output.metadataObjectTypes = [.qr]
    output.setMetadataObjectsDelegate(self, queue: queue)
  }
  func metadataOutput(
    _ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    guard active, let callback = onPayload else { return }
    for object in metadataObjects {
      if let code = object as? AVMetadataMachineReadableCodeObject, code.type == .qr,
        let payload = code.stringValue
      {
        DispatchQueue.main.async { callback(payload) }
      }
    }
  }
  func stop() {
    queue.async { [self] in
      active = false
      onPayload = nil
      if session.isRunning { session.stopRunning() }
    }
  }
}

struct ConnectionCodeScannerView: UIViewControllerRepresentable {
  let onCode: (String) -> Void
  func makeUIViewController(context: Context) -> ConnectionCodeScannerController {
    ConnectionCodeScannerController(onCode: onCode)
  }
  func updateUIViewController(_ controller: ConnectionCodeScannerController, context: Context) {}
  static func dismantleUIViewController(
    _ controller: ConnectionCodeScannerController, coordinator: ()
  ) { controller.cancel() }
}
final class ConnectionCodeScannerController: UIViewController {
  private let camera: ConnectionCodeCameraPort
  private let onCode: (String) -> Void
  private var scan = SenderConnectionScanState()
  private let status = UILabel()
  init(
    camera: ConnectionCodeCameraPort = SystemConnectionCodeCamera(),
    onCode: @escaping (String) -> Void
  ) {
    self.camera = camera
    self.onCode = onCode
    super.init(nibName: nil, bundle: nil)
  }
  required init?(coder: NSCoder) { fatalError("init(coder:) is unavailable") }
  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    camera.previewLayer.videoGravity = .resizeAspectFill
    view.layer.addSublayer(camera.previewLayer)
    status.textColor = .white
    status.backgroundColor = UIColor.black.withAlphaComponent(0.8)
    status.textAlignment = .center
    status.numberOfLines = 0
    status.accessibilityIdentifier = "connectionCodeScanStatus"
    view.addSubview(status)
  }
  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    camera.previewLayer.frame = view.bounds
    if let connection = camera.previewLayer.connection, connection.isVideoOrientationSupported {
      switch view.window?.windowScene?.interfaceOrientation {
      case .landscapeLeft: connection.videoOrientation = .landscapeLeft
      case .landscapeRight: connection.videoOrientation = .landscapeRight
      case .portraitUpsideDown: connection.videoOrientation = .portraitUpsideDown
      default: connection.videoOrientation = .portrait
      }
    }
    status.frame = CGRect(
      x: 16, y: view.safeAreaInsets.top + 16, width: max(0, view.bounds.width - 32), height: 110)
  }
  override func viewDidAppear(_ animated: Bool) {
    super.viewDidAppear(animated)
    let token = scan.begin()
    status.text = scan.message
    camera.requestPermission { [weak self] granted in
      DispatchQueue.main.async {
        guard let self else { return }
        let start = self.scan.completePermission(token: token, granted: granted)
        self.status.text = self.scan.message
        guard start else { return }
        self.camera.start(
          onPayload: { [weak self] payload in
            guard let self else { return }
            let code = self.scan.receive(token: token, payload: payload)
            self.status.text = self.scan.message
            if let code {
              self.camera.stop()
              self.onCode(code)
            }
          },
          onFailure: { [weak self] in
            guard let self else { return }
            self.scan.fail(token: token)
            self.status.text = self.scan.message
          })
      }
    }
  }
  override func viewWillDisappear(_ animated: Bool) {
    cancel()
    super.viewWillDisappear(animated)
  }
  func cancel() {
    scan.cancel()
    camera.stop()
  }
}
