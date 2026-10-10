import SwiftUI
import AppKit
import PhoneMirrorCore

@MainActor
final class PhoneMirrorAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!
    var model: PhoneMirrorViewModel!
    private var terminationTimer: Timer?
    func applicationDidFinishLaunching(_ notification: Notification) {
        model = PhoneMirrorViewModel()
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1060, height: 780), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Phone Mirror"; window.minSize = NSSize(width: 940, height: 700)
        window.contentView = NSHostingView(rootView: PhoneMirrorView(model: model)); window.center()
        if let placement = model.settings.windowPlacement {
            let screen = NSScreen.screens.first { $0.visibleFrame.intersects(CGRect(x: placement.x, y: placement.y, width: placement.width, height: placement.height)) } ?? NSScreen.main
            if let visible = screen?.visibleFrame {
                let width = min(placement.width, visible.width), height = min(placement.height, visible.height)
                window.setFrame(NSRect(x: max(visible.minX, min(placement.x, visible.maxX - width)), y: max(visible.minY, min(placement.y, visible.maxY - height)), width: width, height: height), display: true)
            }
        }
        window.level = model.settings.alwaysOnTop ? .floating : .normal
        window.delegate = self; window.makeKeyAndOrderFront(nil)
        let menu = NSMenu(), appItem = NSMenuItem(), appMenu = NSMenu()
        appMenu.addItem(withTitle: "Phone Mirror 종료", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu; menu.addItem(appItem)
        let edit = NSMenuItem(), editMenu = NSMenu(title: "편집")
        editMenu.addItem(withTitle: "복사", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editMenu.addItem(withTitle: "모두 선택", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edit.submenu = editMenu; menu.addItem(edit); NSApp.mainMenu = menu
        NSApp.activate(ignoringOtherApps: true)
    }
    func windowDidMove(_ notification: Notification) { persistSavedWindowPlacement() }
    func windowDidResize(_ notification: Notification) { persistSavedWindowPlacement() }
    private func persistSavedWindowPlacement() {
        guard !window.styleMask.contains(.fullScreen) else { return }
        let frame = window.frame
        model.saveWindowPlacement(SavedWindowPlacement(x: frame.minX, y: frame.minY, width: frame.width, height: frame.height))
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if model.isRecording {
            model.stopRecording { sender.reply(toApplicationShouldTerminate: true) }
            model.stopMirroring()
            return .terminateLater
        }
        if model.isSavingRecording {
            model.stopMirroring()
            terminationTimer = Timer.scheduledTimer(withTimeInterval: 0.1, repeats: true) { [weak self] timer in
                Task { @MainActor in if self?.model.isSavingRecording == false { timer.invalidate(); sender.reply(toApplicationShouldTerminate: true) } }
            }
            return .terminateLater
        }
        return .terminateNow
    }
    func applicationWillTerminate(_ notification: Notification) { model.shutdown() }
}

