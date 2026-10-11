use phone_mirror_desktop::ios_usb::{decode_mux_header, decode_usb_devices, encode_mux_request};
#[test]
fn mux_header_and_discovery_validate_boundaries_and_filter_network_devices() {
    let packet = encode_mux_request("ListDevices", 1, None, None).unwrap();
    assert_eq!(
        u32::from_le_bytes(packet[..4].try_into().unwrap()) as usize,
        packet.len()
    );
    assert!(decode_mux_header(&packet[..16], 1).is_ok());
    assert!(decode_mux_header(&packet[..15], 1).is_err());
    assert!(decode_mux_header(&packet[..16], 2).is_err());
    for size in [0u32, 15, 1_048_577, u32::MAX] {
        let mut h = packet[..16].to_vec();
        h[..4].copy_from_slice(&size.to_le_bytes());
        assert!(decode_mux_header(&h, 1).is_err());
    }
    let xml=br#"<?xml version="1.0"?><plist version="1.0"><dict><key>DeviceList</key><array><dict><key>DeviceID</key><integer>7</integer><key>Properties</key><dict><key>SerialNumber</key><string>abc-123</string><key>ConnectionType</key><string>USB</string></dict></dict><dict><key>DeviceID</key><integer>8</integer><key>Properties</key><dict><key>SerialNumber</key><string>wifi</string><key>ConnectionType</key><string>Network</string></dict></dict></array></dict></plist>"#;
    let devices = decode_usb_devices(xml).unwrap();
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].identifier, "abc-123");
    assert_eq!(devices[0].handle, 7);
    for xml in [b"broken".as_slice(), b"<plist><dict/></plist>".as_slice()] {
        assert!(decode_usb_devices(xml).is_err());
    }
    assert!(encode_mux_request("Connect", 1, Some(0), Some(27483)).is_err());
    assert!(encode_mux_request("Connect", 1, Some(u32::MAX), Some(0)).is_err());
    for port in [1u16, 27483, 65535] {
        let p = encode_mux_request("Connect", 1, Some(u32::MAX), Some(port)).unwrap();
        let value = plist::Value::from_reader_xml(&p[16..]).unwrap();
        assert_eq!(
            value.as_dictionary().unwrap()["PortNumber"].as_unsigned_integer(),
            Some(u64::from(port.to_be()))
        );
    }
}

#[tokio::test]
async fn injected_usb_service_rejects_missing_multiple_and_failed_discovery_and_rediscover_handles()
{
    use phone_mirror_desktop::ios_usb::{
        BoxUsbTunnel, IosUsbReceiverService, UsbDevice, UsbMuxPort,
    };
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    };
    struct Port {
        count: usize,
        calls: AtomicUsize,
        handles: Mutex<Vec<u32>>,
        fail: bool,
    }
    #[async_trait::async_trait]
    impl UsbMuxPort for Port {
        async fn discover(&self) -> Result<Vec<UsbDevice>, String> {
            if self.fail {
                return Err("simulated missing Apple driver".into());
            }
            let call = self.calls.fetch_add(1, Ordering::SeqCst);
            Ok((0..self.count)
                .map(|i| UsbDevice {
                    handle: if call == 0 { 7 } else { 8 },
                    identifier: format!("phone-{i}"),
                })
                .collect())
        }
        async fn connect(&self, d: &UsbDevice, p: u16) -> Result<BoxUsbTunnel, String> {
            assert_eq!(p, 27483);
            self.handles.lock().unwrap().push(d.handle);
            let (stream, _peer) = tokio::io::duplex(1024);
            Ok(Box::new(stream))
        }
    }
    for (count, fail) in [(0, false), (2, false), (1, true)] {
        let service = IosUsbReceiverService::new(Arc::new(Port {
            count,
            fail,
            calls: 0.into(),
            handles: Mutex::new(vec![]),
        }));
        assert!(service.start().await.is_err());
        assert!(service.discover().await.is_empty());
        service.cancel_all().await;
    }
    let port = Arc::new(Port {
        count: 1,
        fail: false,
        calls: 0.into(),
        handles: Mutex::new(vec![]),
    });
    let service = IosUsbReceiverService::new(port.clone());
    let info = service.start().await.unwrap();
    assert!(info.codes[0].starts_with("PMU1|27483|"));
    assert!(service.start().await.is_err());
    assert!(service.stop("wrong").await.is_err());
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while port.handles.lock().unwrap().is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(port.handles.lock().unwrap()[0], 8);
    service.stop(&info.receiver_id).await.unwrap();
    service.stop(&info.receiver_id).await.unwrap();
    assert!(service.discover().await.is_empty());
}

#[tokio::test]
async fn native_mux_client_handles_fragmented_responses_and_connect_rejection() {
    use phone_mirror_desktop::ios_usb::{AppleUsbMuxPort, UsbDevice, UsbMuxPort};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = AppleUsbMuxPort::new(listener.local_addr().unwrap()).unwrap();
    assert!(AppleUsbMuxPort::new("192.168.0.1:27015".parse().unwrap()).is_err());
    let daemon = tokio::spawn(async move {
        for _ in 0..2 {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut header = [0; 16];
            stream.read_exact(&mut header).await.unwrap();
            let size = decode_mux_header(&header, 1).unwrap();
            let mut body = vec![0; size];
            stream.read_exact(&mut body).await.unwrap();
            let request = plist::Value::from_reader_xml(body.as_slice()).unwrap();
            let message = request.as_dictionary().unwrap()["MessageType"]
                .as_string()
                .unwrap();
            let response = if message == "ListDevices" {
                "<plist><dict><key>DeviceList</key><array/></dict></plist>"
            } else {
                "<plist><dict><key>MessageType</key><string>Result</string><key>Number</key><integer>3</integer></dict></plist>"
            };
            let mut packet = Vec::new();
            for value in [(response.len() + 16) as u32, 1, 8, 1] {
                packet.extend(value.to_le_bytes());
            }
            packet.extend(response.as_bytes());
            for part in packet.chunks(3) {
                stream.write_all(part).await.unwrap();
            }
        }
    });
    assert!(port.discover().await.unwrap().is_empty());
    assert!(port
        .connect(
            &UsbDevice {
                handle: 7,
                identifier: "mock".into()
            },
            27483
        )
        .await
        .is_err());
    daemon.await.unwrap();
}

#[tokio::test]
async fn usb_transport_authenticates_maps_wired_identity_and_keeps_media_alive_beyond_handshake_timeout(
) {
    use phone_mirror_desktop::{
        domain::{ConnectionTransport, DeviceAvailability},
        ios_receiver::WireCipher,
        ios_usb::{BoxUsbTunnel, IosUsbReceiverService, UsbDevice, UsbMuxPort},
    };
    use std::sync::Arc;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    struct Port {
        sender: tokio::sync::mpsc::UnboundedSender<tokio::io::DuplexStream>,
    }
    #[async_trait::async_trait]
    impl UsbMuxPort for Port {
        async fn discover(&self) -> Result<Vec<UsbDevice>, String> {
            Ok(vec![UsbDevice {
                handle: 7,
                identifier: "same-usb-phone".into(),
            }])
        }
        async fn connect(&self, _: &UsbDevice, _: u16) -> Result<BoxUsbTunnel, String> {
            let (a, b) = tokio::io::duplex(8192);
            self.sender.send(b).unwrap();
            Ok(Box::new(a))
        }
    }
    let (send, mut receive) = tokio::sync::mpsc::unbounded_channel();
    let service = IosUsbReceiverService::new(Arc::new(Port { sender: send }));
    let info = service.start().await.unwrap();
    let key = info.codes[0].rsplit('|').next().unwrap();
    let mut secret = [0; 32];
    for (i, value) in secret.iter_mut().enumerate() {
        *value = u8::from_str_radix(&key[i * 2..i * 2 + 2], 16).unwrap();
    }
    let mut phone = receive.recv().await.unwrap();
    let mut challenge = [0; 20];
    phone.read_exact(&mut challenge).await.unwrap();
    assert_eq!(&challenge[..4], b"PMW1");
    let mut cipher = WireCipher::new(&secret, challenge[4..].try_into().unwrap());
    let hello=br#"{"version":1,"deviceId":"123e4567-e89b-42d3-a456-426614174000","name":"Simulated USB iPhone","audio":true}"#;
    phone
        .write_all(&cipher.seal(1, hello).unwrap())
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while service.discover().await.is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let device = service.discover().await.remove(0);
    assert_eq!(device.identity, "ios-usb:same-usb-phone");
    assert_eq!(device.endpoint.transport, ConnectionTransport::Usb);
    assert!(device.capabilities.audio);
    assert!(!device.capabilities.control);
    // Short four-second loopback check: an active tunnel must not have a three-second connection lifetime.
    tokio::time::sleep(std::time::Duration::from_secs(4)).await;
    phone
        .write_all(&cipher.seal(4, &[]).unwrap())
        .await
        .unwrap();
    assert_eq!(
        service.discover().await[0].availability,
        DeviceAvailability::Ready
    );
    service.stop(&info.receiver_id).await.unwrap();
    let mut byte = [0; 1];
    assert_eq!(
        tokio::time::timeout(std::time::Duration::from_secs(1), phone.read(&mut byte))
            .await
            .unwrap()
            .unwrap(),
        0
    );
    let fresh = service.start().await.unwrap();
    assert_ne!(fresh.receiver_id, info.receiver_id);
    assert_ne!(fresh.codes, info.codes);
    service.cancel_all().await;
}

#[tokio::test]
async fn injected_retry_wait_is_cancelled_without_waiting_for_time_or_late_device_callbacks() {
    use phone_mirror_desktop::ios_usb::{
        BoxUsbTunnel, IosUsbReceiverService, UsbDevice, UsbMuxPort, UsbRetryScheduler,
    };
    use std::sync::Arc;
    struct Clock(tokio::sync::Notify);
    #[async_trait::async_trait]
    impl UsbRetryScheduler for Clock {
        async fn wait(&self) {
            self.0.notify_one();
            std::future::pending::<()>().await;
        }
    }
    struct Port;
    #[async_trait::async_trait]
    impl UsbMuxPort for Port {
        async fn discover(&self) -> Result<Vec<UsbDevice>, String> {
            Ok(vec![UsbDevice {
                handle: 1,
                identifier: "mock".into(),
            }])
        }
        async fn connect(&self, _: &UsbDevice, _: u16) -> Result<BoxUsbTunnel, String> {
            Err("simulated absent sender".into())
        }
    }
    let clock = Arc::new(Clock(tokio::sync::Notify::new()));
    let service = IosUsbReceiverService::with_retry_scheduler(Arc::new(Port), clock.clone());
    let info = service.start().await.unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(1), clock.0.notified())
        .await
        .unwrap();
    tokio::time::timeout(
        std::time::Duration::from_secs(1),
        service.stop(&info.receiver_id),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(service.discover().await.is_empty());
}

#[tokio::test]
async fn mux_binary_connect_result_preserves_tunnel_bytes_and_rejects_invalid_result_size() {
    use phone_mirror_desktop::ios_usb::{AppleUsbMuxPort, UsbDevice, UsbMuxPort};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    for version in [0u32, 1] {
        let mut header = Vec::new();
        for value in [20, version, 1, 7] {
            header.extend(value.to_le_bytes());
        }
        assert_eq!(decode_mux_header(&header, 7).unwrap(), 4);
        header[..4].copy_from_slice(&21u32.to_le_bytes());
        assert!(decode_mux_header(&header, 7).is_err());
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let client = AppleUsbMuxPort::new(listener.local_addr().unwrap()).unwrap();
    let daemon = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let mut header = [0; 16];
        stream.read_exact(&mut header).await.unwrap();
        let mut body = vec![0; decode_mux_header(&header, 1).unwrap()];
        stream.read_exact(&mut body).await.unwrap();
        let mut result = Vec::new();
        for value in [20u32, 0, 1, 1, 0] {
            result.extend(value.to_le_bytes());
        }
        result.extend(b"media");
        stream.write_all(&result).await.unwrap();
    });
    let mut tunnel = client
        .connect(
            &UsbDevice {
                handle: 1,
                identifier: "mock".into(),
            },
            27483,
        )
        .await
        .unwrap();
    let mut bytes = [0; 5];
    tunnel.read_exact(&mut bytes).await.unwrap();
    assert_eq!(&bytes, b"media");
    daemon.await.unwrap();
}
