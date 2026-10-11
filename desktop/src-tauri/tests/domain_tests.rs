use phone_mirror_desktop::domain::{
    parse_services, parse_transports, ConnectionTarget, ConnectionTransport, PairingRequest,
    VideoPacketHeader, WirelessEndpoint,
};

#[test]
fn wireless_endpoint_boundaries() {
    for address in [
        "1.2.3.4:1",
        "255.255.255.255:65535",
        "[::1]:1",
        "[2001:db8::1]:65535",
    ] {
        assert!(WirelessEndpoint::parse(address).is_ok(), "{address}");
    }
    for address in [
        "",
        "1.2.3.4:0",
        "1.2.3.4:65536",
        "1.2.3.4:-1",
        "1.2.3.4:+1",
        "01.2.3.4:1",
        "host:1",
        "1.2.3.4:１２",
        "::1:1",
        "[1.2.3.4]:1",
        "1.2.3.4: 1",
        "1.2.3.4:1;reboot",
    ] {
        assert!(WirelessEndpoint::parse(address).is_err(), "{address}");
    }
}
#[test]
fn pairing_code_is_exactly_six_ascii_digits() {
    for code in ["000000", "999999"] {
        assert!(PairingRequest::parse("1.2.3.4:1", code).is_ok());
    }
    for code in ["", "12345", "1234567", "１２３４５６", " 123456", "12345x"] {
        assert!(PairingRequest::parse("1.2.3.4:1", code).is_err());
    }
}
#[test]
fn parser_separates_usb_wifi_states_and_supports_bonjour_collisions() {
    let transports = parse_transports("List of devices attached\nA device usb:1 model:Galaxy_S24\nB unauthorized usb:2\nadb-A-guid (2)._adb-tls-connect._tcp device model:Galaxy\n1.2.3.4:1 offline\nemulator-5554 device\n1.2.3.4:65536 device");
    assert_eq!(transports.len(), 4);
    assert_eq!(transports[0].transport, ConnectionTransport::Usb);
    assert_eq!(
        transports[2].identifier,
        "adb-A-guid (2)._adb-tls-connect._tcp"
    );
    assert_eq!(transports[2].transport, ConnectionTransport::Wifi);
    let services = parse_services("adb-A-guid (2) _adb-tls-connect._tcp 1.2.3.4:2\nadb-A-guid _adb-tls-pairing._tcp 1.2.3.4:1\nbad _adb._tcp 1.2.3.4:3");
    assert_eq!(services.len(), 2);
    assert_eq!(services[0].instance_number(), 2);
}
#[test]
fn stable_target_validation_has_minimum_and_maximum_identity_lengths() {
    for identity in ["A".to_string(), "A".repeat(256)] {
        assert!(ConnectionTarget {
            identity,
            transport: ConnectionTransport::Wifi
        }
        .validate()
        .is_ok());
    }
    for identity in ["".to_string(), " A".into(), "A\n".into(), "A".repeat(257)] {
        assert!(ConnectionTarget {
            identity,
            transport: ConnectionTransport::Usb
        }
        .validate()
        .is_err());
    }
}
#[test]
fn video_header_validates_payload_and_timestamp_flags_before_allocating() {
    let mut bytes = [0u8; 12];
    bytes[..8].copy_from_slice(&((1u64 << 61) | 123).to_be_bytes());
    bytes[8..].copy_from_slice(&1u32.to_be_bytes());
    let header = VideoPacketHeader::parse(&bytes).unwrap();
    assert!(header.key_frame);
    assert_eq!(header.timestamp, 123);
    assert_eq!(header.payload_size, 1);
    bytes[8..].copy_from_slice(&(16 * 1024 * 1024u32).to_be_bytes());
    assert!(VideoPacketHeader::parse(&bytes).is_ok());
    bytes[..8].copy_from_slice(&((1u64 << 53) - 1).to_be_bytes());
    assert!(VideoPacketHeader::parse(&bytes).is_ok());
    bytes[..8].copy_from_slice(&(1u64 << 53).to_be_bytes());
    assert!(VideoPacketHeader::parse(&bytes).is_err());
    for size in [0u32, 16 * 1024 * 1024 + 1, u32::MAX] {
        bytes[8..].copy_from_slice(&size.to_be_bytes());
        assert!(VideoPacketHeader::parse(&bytes).is_err());
    }
    assert!(VideoPacketHeader::parse(&[0; 11]).is_err());
}
