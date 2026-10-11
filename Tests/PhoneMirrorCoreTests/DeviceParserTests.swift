import XCTest
@testable import PhoneMirrorCore

final class DeviceParserTests: XCTestCase {
    func testUSBStatesAndWirelessExclusion() {
        let devices = AndroidDeviceParser.parseUSBDevices("""
        List of devices attached
        A device usb:1 model:Galaxy_S24 transport_id:1
        B unauthorized usb:2
        C offline usb:3
        emulator-5554 device model:sdk
        192.168.1.2:5555 device
        adb-A._adb-tls-connect._tcp device
        """)
        XCTAssertEqual(devices.map(\.id), ["A", "B", "C"])
        XCTAssertEqual(devices.map(\.availability), [.ready, .unauthorized, .offline])
        XCTAssertEqual(devices[0].name, "Galaxy S24")
    }
    func testEmptyMalformedDuplicateAndOversizedIdentifiers() {
        for text in ["", "\n\n", "List of devices attached\n", "A\nA nonsense\n* daemon started successfully *\n"] {
            XCTAssertTrue(AndroidDeviceParser.parseUSBDevices(text).isEmpty)
        }
        XCTAssertEqual(AndroidDeviceParser.parseUSBDevices("A device\nA device\n").count, 1)
        XCTAssertTrue(AndroidDeviceParser.parseUSBDevices(String(repeating: "A", count: 257) + " device").isEmpty)
        XCTAssertEqual(AndroidDeviceParser.parseUSBDevices("A\tdevice\r\n").first?.name, "Android")
    }
}
