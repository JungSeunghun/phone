import AppKit
import Foundation
import PhoneMirrorCore

MainActor.assumeIsolated {
if CommandLine.arguments.contains("--self-test") {
    let devices = AndroidDeviceParser.parseUSBDevices("""
    List of devices attached
    ABC device usb:1-1 product:phone model:Galaxy_S24 transport_id:1
    DEF unauthorized usb:1-2 transport_id:2
    GHI offline usb:1-3
    emulator-5554 device model:sdk
    192.168.1.3:5555 device model:Wireless
    adb-ABC._adb-tls-connect._tcp device model:Wireless
    * daemon started successfully *
    """)
    precondition(devices.count == 3 && devices[0].name == "Galaxy S24" && devices[0].availability == .ready)
    precondition(devices[1].availability != .ready && devices[2].availability != .ready)
    precondition(AndroidDeviceParser.parseUSBDevices("List of devices attached\n").isEmpty)
    let units = H264.units(Data([0, 0, 0, 1, 0x67, 1, 2, 0, 0, 1, 0x68, 3, 0, 0, 0, 1, 0x65, 4]))
    precondition(units == [Data([0x67, 1, 2]), Data([0x68, 3]), Data([0x65, 4])])
    precondition(H264.units(Data([0, 0, 1])).isEmpty)
    var bytes = Data(); bytes.appendBE(UInt64(0x4000000000000000)); bytes.appendBE(UInt32(1024))
    precondition(bytes.unsigned(0, 8) & (1 << 62) != 0 && bytes.unsigned(8, 4) == 1024)
    precondition(ConnectionState.connecting.active && ConnectionState.live.active && !ConnectionState.disconnected.active)
    print("PASS: USB devices, authorization, H.264 start codes, packet byte order, connection activity")
} else if let index = CommandLine.arguments.firstIndex(of: "--smoke-test-wifi"), index + 1 < CommandLine.arguments.count {
    let test = SmokeTest(directory: URL(fileURLWithPath: CommandLine.arguments[index + 1], isDirectory: true), transport: .wifi, verifyPortChange: CommandLine.arguments.contains("--verify-port-change"))
    test.run()
} else if let index = CommandLine.arguments.firstIndex(of: "--smoke-test"), index + 1 < CommandLine.arguments.count {
    let test = SmokeTest(directory: URL(fileURLWithPath: CommandLine.arguments[index + 1], isDirectory: true))
    test.run()
} else {
    let app = NSApplication.shared
    let delegate = PhoneMirrorAppDelegate()
    app.setActivationPolicy(.regular); app.delegate = delegate; app.run()
}

}
