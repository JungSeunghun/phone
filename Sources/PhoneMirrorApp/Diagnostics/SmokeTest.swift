import PhoneMirrorCore
import Foundation
import AppKit
import ImageIO

/// Runs the actual app model against a USB phone, without opening save dialogs.
/// Media stays in the caller-selected local directory.
@MainActor
final class SmokeTest {
    private let model: PhoneMirrorViewModel
    private let defaults: UserDefaults
    private let settingsDomain = "phoneMirror.smokeTest." + UUID().uuidString
    private var timer: Timer?
    private var stage = 0
    private var deadline = Date().addingTimeInterval(20)
    private var marked = Date()
    private let directory: URL
    init(directory: URL) {
        self.directory = directory
        defaults = UserDefaults(suiteName: settingsDomain)!
        model = PhoneMirrorViewModel(settingsStore: UserDefaultsSettingsStore(defaults: defaults))
    }
    func run() {
        do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true) }
        catch { fail(error.localizedDescription); return }
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [self] _ in MainActor.assumeIsolated { tick() } }
        NSApplication.shared.run()
    }
    private func fail(_ reason: String) { print("FAIL: \(reason)\n\(model.connectionLog)"); model.shutdown(); defaults.removePersistentDomain(forName: settingsDomain); exit(1) }
    private func tick() {
        if Date() > deadline { fail("stage \(stage): \(model.connectionState.rawValue) · \(model.connectionMessage) · \(model.mediaStatusMessage)") }
        switch stage {
        case 0:
            if model.canStartMirroring { model.startMirroring(); stage = 1 }
        case 1:
            if model.connectionState == .live {
                let url = directory.appendingPathComponent("android-screenshot.png")
                model.captureScreenshot(to: url)
                guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil), image.width > 0 else { fail("PNG screenshot invalid"); return }
                print("PASS: embedded USB video and PNG screenshot \(image.width)x\(image.height)")
                model.startRecording(to: directory.appendingPathComponent("android-recording.mp4")); stage = 2
            }
        case 2:
            if model.isRecording { marked = Date(); stage = 3 }
        case 3:
            if Date().timeIntervalSince(marked) >= 3 { model.stopRecording(); stage = 4 }
        case 4:
            if !model.isSavingRecording {
                guard model.mediaStatusMessage.hasPrefix("녹화 저장:") else { fail(model.mediaStatusMessage); return }
                print("PASS: MP4 recording finalized; audio requested: \(model.isAudioAvailable)")
                model.stopMirroring()
                guard model.connectionState == .stopped && !model.isMirroring else { fail("stop state"); return }
                print("PASS: explicit stop clears live state")
                model.startMirroring(); stage = 5; deadline = Date().addingTimeInterval(20)
            }
        case 5:
            if model.connectionState == .live {
                print("PASS: USB stream reconnect and second first-frame transition")
                model.startRecording(to: directory.appendingPathComponent("android-disconnect-recording.mp4")); stage = 6
            }
        case 6:
            if model.isRecording { marked = Date(); stage = 7 }
        case 7:
            if Date().timeIntervalSince(marked) >= 2 { model.simulateStreamEndForTest(); stage = 8 }
        case 8:
            if !model.isSavingRecording && !model.isRecording {
                guard model.mediaStatusMessage.hasPrefix("녹화 저장:") else { fail("disconnect finalization"); return }
                print("PASS: socket interruption finalized recording before automatic retry")
                stage = 9; deadline = Date().addingTimeInterval(25)
            }
        case 9:
            if model.connectionState == .live {
                print("PASS: automatic USB reconnection received an actual first frame without manual start")
                let restored = UserDefaultsSettingsStore(defaults: defaults).load()
                guard restored.preferredDeviceID(for: .android) == model.selectedDeviceID else { fail("settings persistence"); return }
                print("PASS: persisted selected USB device restored from UserDefaults")
                model.stopMirroring(); marked = Date(); stage = 10
            }
        case 10:
            if Date().timeIntervalSince(marked) >= 3 {
                guard model.connectionState == .stopped && !model.canStopMirroring else { fail("manual stop restarted unexpectedly"); return }
                print("PASS: manual stop canceled automatic reconnect across subsequent polling")
                model.shutdown(); defaults.removePersistentDomain(forName: settingsDomain); timer?.invalidate(); exit(0)
            }
        default: break
        }
    }
}
