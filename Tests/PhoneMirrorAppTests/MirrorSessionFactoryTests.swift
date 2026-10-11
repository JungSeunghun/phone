import XCTest
import PhoneMirrorCore
@testable import PhoneMirrorApp

final class MirrorSessionFactoryTests: XCTestCase {
    func testUnsupportedIPhoneWirelessTransportIsRejectedBeforeCaptureStarts() {
        let device = PhoneDevice(identity: DeviceIdentity(platform: .iOS, id: "A"), name: "iPhone", availability: .ready, endpoint: DeviceEndpoint(transport: .wifi, address: "1.2.3.4:1"))
        XCTAssertThrowsError(try PhoneMirrorSessionFactory().makeSession(for: device, settings: MirrorSettings()))
    }
}
