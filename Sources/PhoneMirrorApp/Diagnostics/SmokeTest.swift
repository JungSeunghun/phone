import PhoneMirrorCore
import Foundation
import AppKit
import ImageIO

/// Runs the actual app model against a USB or Wi-Fi phone, without opening save dialogs.
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
    private let transport: ConnectionTransport
    private let verifyPortChange: Bool
    private var previousWirelessAddress = ""
    private var portChangeTask: Task<Void, Never>?
    init(directory: URL, transport: ConnectionTransport = .usb, verifyPortChange: Bool = false) {
        self.directory = directory; self.transport = transport; self.verifyPortChange = verifyPortChange
        defaults = UserDefaults(suiteName: settingsDomain)!
        model = PhoneMirrorViewModel(settingsStore: UserDefaultsSettingsStore(defaults: defaults), deviceDiscovery: PhoneDeviceDiscovery(bookmarkStore: UserDefaultsWirelessDeviceStore(defaults: defaults)))
    }
    func run() {
        do { try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true) }
        catch { fail(error.localizedDescription); return }
        timer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [self] _ in MainActor.assumeIsolated { tick() } }
        NSApplication.shared.run()
    }
    private func fail(_ reason: String) { print("FAIL: \(reason)\n\(model.connectionLog)"); model.shutdown(); defaults.removePersistentDomain(forName: settingsDomain); exit(1) }
    /// Explicit diagnostic option: restart wireless debugging over the still-connected USB transport.
    private func beginPortChangeVerification() {
        guard transport == .wifi, let wifi = model.availableDevices.first(where: { $0.id == model.selectedDeviceID }),
              let usb = model.availableDevices.first(where: { $0.identity == wifi.identity && $0.endpoint.transport == .usb }),
              let adb = ProcessCommandRunner.locate("adb") else { fail("Port-change verification requires the same phone connected by USB and Wi-Fi"); return }
        previousWirelessAddress = wifi.endpoint.address; stage = 11; deadline = Date().addingTimeInterval(40)
        portChangeTask = Task {
            let previous = await ProcessCommandRunner.run(adb, ["-s", usb.endpoint.identifier, "shell", "settings", "get", "global", "adb_wifi_enabled"])
            guard previous.0 == 0, previous.1.trimmingCharacters(in: .whitespacesAndNewlines) == "1" else { fail("Wireless debugging must already be enabled"); return }
            let disabled = await ProcessCommandRunner.run(adb, ["-s", usb.endpoint.identifier, "shell", "settings", "put", "global", "adb_wifi_enabled", "0"])
            try? await Task.sleep(nanoseconds: 2_000_000_000)
            let enabled = await ProcessCommandRunner.run(adb, ["-s", usb.endpoint.identifier, "shell", "settings", "put", "global", "adb_wifi_enabled", "1"])
            guard disabled.0 == 0, enabled.0 == 0 else { fail("Restarting wireless debugging failed"); return }
        }
    }
    private func tick() {
        if Date() > deadline { fail("stage \(stage): \(model.connectionState.rawValue) · \(model.connectionMessage) · \(model.mediaStatusMessage)") }
        switch stage {
        case 0:
            if let device = model.availableDevices.first(where: { $0.endpoint.transport == transport && $0.availability == .ready }) {
                model.selectDevice(device.id)
                if model.canStartMirroring { model.startMirroring(); stage = 1 }
            }
        case 1:
            if model.connectionState == .live {
                let url = directory.appendingPathComponent("android-screenshot.png")
                model.captureScreenshot(to: url)
                guard let source = CGImageSourceCreateWithURL(url as CFURL, nil), let image = CGImageSourceCreateImageAtIndex(source, 0, nil), image.width > 0 else { fail("PNG screenshot invalid"); return }
                print("PASS: embedded \(transport.displayName) video and PNG screenshot \(image.width)x\(image.height)")
                model.startRecording(to: directory.appendingPathComponent("android-recording.mp4")); stage = 2
            }
        case 2:
            if model.isRecording { marked = Date(); stage = 3 }
        case 3:
            if Date().timeIntervalSince(marked) >= 3 { model.stopRecording(); stage = 4 }
        case 4:
            if !model.isSavingRecording {
                guard model.mediaStatusMessage.hasPrefix("녹화 저장:") else { fail(model.mediaStatusMessage); return }
                print("PASS: MP4 recording finalized; audio stream available at finish: \(model.isAudioAvailable)")
                model.stopMirroring()
                guard model.connectionState == .stopped && !model.isMirroring else { fail("stop state"); return }
                print("PASS: explicit stop clears live state")
                model.startMirroring(); stage = 5; deadline = Date().addingTimeInterval(20)
            }
        case 5:
            if model.connectionState == .live {
                print("PASS: \(transport.displayName) stream reconnect and second first-frame transition")
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
                print("PASS: automatic \(transport.displayName) reconnection received an actual first frame without manual start")
                let restored = UserDefaultsSettingsStore(defaults: defaults).load()
                guard restored.preferredDeviceID(for: .android) == model.selectedDeviceID else { fail("settings persistence"); return }
                print("PASS: persisted selected \(transport.displayName) device restored from UserDefaults")
                if verifyPortChange { beginPortChangeVerification() }
                else { model.stopMirroring(); marked = Date(); stage = 10 }
            }
        case 10:
            if Date().timeIntervalSince(marked) >= 3 {
                guard model.connectionState == .stopped && !model.canStopMirroring else { fail("manual stop restarted unexpectedly"); return }
                print("PASS: manual stop canceled automatic reconnect across subsequent polling")
                model.shutdown(); defaults.removePersistentDomain(forName: settingsDomain); timer?.invalidate(); exit(0)
            }
        case 11:
            if let current = model.availableDevices.first(where: { $0.id == model.selectedDeviceID }),
               model.connectionState == .live, current.endpoint.address != previousWirelessAddress {
                print("PASS: real Wi-Fi connection port changed and the same phone received a new first frame automatically")
                guard model.availableDevices.contains(where: { $0.identity == current.identity && $0.endpoint.transport == .usb }) else { fail("USB device disappeared during wireless test"); return }
                print("PASS: existing USB transport remains available alongside Wi-Fi")
                model.stopMirroring(); marked = Date(); stage = 10
            }
        default: break
        }
    }
}
