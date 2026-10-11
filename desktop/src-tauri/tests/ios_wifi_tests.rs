use phone_mirror_desktop::ios_wifi::*;
#[test]
fn encrypted_wire_bounds_authentication_and_replay() {
    let key = [7u8; 32];
    let challenge = [9u8; 16];
    let mut cipher = WireCipher::new(&key, &challenge);
    let frame = cipher.seal(1, b"hello").unwrap();
    assert_eq!(frame.len(), 34);
    let golden = "0000001e0000000000000000c070c2fc9d4c39462c8bc76ebfb93aa89cbc8b8412d2";
    assert_eq!(
        frame.iter().map(|b| format!("{b:02x}")).collect::<String>(),
        golden
    );
    let mut reader = WireCipher::new(&key, &challenge);
    assert_eq!(reader.open(&frame).unwrap(), (1, b"hello".to_vec()));
    assert!(reader.open(&frame).is_err());
    let mut corrupt = frame.clone();
    corrupt[15] ^= 1;
    assert!(WireCipher::new(&key, &challenge).open(&corrupt).is_err());
    assert!(WireCipher::new(&[8; 32], &challenge).open(&frame).is_err());
    assert!(WireCipher::new(&key, &[8; 16]).open(&frame).is_err());
    for kind in [0, 5, 255] {
        assert!(cipher.seal(kind, b"").is_err());
    }
    assert!(cipher.seal(2, &vec![0; MAX_WIRE_PAYLOAD + 1]).is_err());
    for size in [0, 24, MAX_WIRE_PAYLOAD + 26, usize::MAX] {
        assert!(validate_wire_size(size).is_err());
    }
    assert!(validate_wire_size(25).is_ok());
    assert!(validate_wire_size(MAX_WIRE_PAYLOAD + 25).is_ok());
}
#[test]
fn hello_identity_and_pcm_boundaries() {
    let hello=parse_sender_hello(br#"{"version":1,"deviceId":"123e4567-e89b-42d3-a456-426614174000","name":"iPhone","audio":true}"#).unwrap();
    let d = hello.device("127.0.0.1:1234");
    assert_eq!(d.platform, phone_mirror_desktop::domain::PhonePlatform::Ios);
    assert!(d.capabilities.audio);
    assert!(!d.capabilities.control);
    for json in [
        "{}",
        "null",
        "{",
        r#"{"version":2,"deviceId":"bad","name":"iPhone","audio":true}"#,
    ] {
        assert!(parse_sender_hello(json.as_bytes()).is_err());
    }
    let mut p = 0u64.to_be_bytes().to_vec();
    p.extend(4u32.to_be_bytes());
    p.extend([0; 4]);
    assert!(validate_wifi_audio(&p).is_ok());
    p[8..12].copy_from_slice(&3u32.to_be_bytes());
    assert!(validate_wifi_audio(&p).is_err());
    assert!(validate_wifi_audio(&[]).is_err());
}

use phone_mirror_desktop::{
    domain::DeviceAvailability,
    infrastructure::{AudioPacketSink, VideoPacketSink},
};
use std::sync::{Arc, Mutex};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};
use tokio_util::sync::CancellationToken;
#[derive(Default)]
struct Packets(Mutex<Vec<Vec<u8>>>);
impl VideoPacketSink for Packets {
    fn send(&self, p: Vec<u8>) -> Result<(), String> {
        self.0.lock().unwrap().push(p);
        Ok(())
    }
}
impl AudioPacketSink for Packets {
    fn send(&self, p: Vec<u8>) -> Result<(), String> {
        self.0.lock().unwrap().push(p);
        Ok(())
    }
    fn status(&self, _: &str) {}
}
async fn wait_for(mut predicate: impl FnMut() -> bool) {
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while !predicate() {
            tokio::task::yield_now().await
        }
    })
    .await
    .unwrap();
}
async fn client(info: &ReceiverInfo, id: &str) -> (TcpStream, WireCipher) {
    let mut stream = TcpStream::connect(("127.0.0.1", info.port)).await.unwrap();
    let mut greeting = [0; 20];
    stream.read_exact(&mut greeting).await.unwrap();
    assert_eq!(&greeting[..4], b"PMW1");
    let hex = info.codes[0].split('|').nth(2).unwrap();
    let key: Vec<u8> = (0..32)
        .map(|i| u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).unwrap())
        .collect();
    let mut cipher = WireCipher::new(&key.try_into().unwrap(), greeting[4..].try_into().unwrap());
    let hello = serde_json::json!({"version":1,"deviceId":id,"name":"Mock iPhone","audio":true});
    let frame = cipher
        .seal(1, &serde_json::to_vec(&hello).unwrap())
        .unwrap();
    for byte in frame {
        stream.write_all(&[byte]).await.unwrap();
    }
    (stream, cipher)
}
fn media(payload: &[u8], timestamp: u64) -> Vec<u8> {
    let mut packet = timestamp.to_be_bytes().to_vec();
    packet.extend((payload.len() as u32).to_be_bytes());
    packet.extend(payload);
    packet
}
#[tokio::test]
async fn loopback_routes_video_audio_and_reconnects_stable_identity() {
    let service = Arc::new(IosWifiReceiverService::default());
    let info = service.start_on("127.0.0.1:0").await.unwrap();
    assert!(service.start_on("127.0.0.1:0").await.is_err());
    let id = "123e4567-e89b-42d3-a456-426614174000";
    let (mut stream, mut cipher) = client(&info, id).await;
    let device = tokio::time::timeout(std::time::Duration::from_secs(2), async {
        loop {
            if let Some(d) = service.discover().await.first() {
                break d.clone();
            }
            tokio::task::yield_now().await
        }
    })
    .await
    .unwrap();
    let video = Arc::new(Packets::default());
    let audio = Arc::new(Packets::default());
    let cancel = CancellationToken::new();
    let runner = service.clone();
    let v = video.clone();
    let a = audio.clone();
    let c = cancel.clone();
    let identity = device.identity.clone();
    let task = tokio::spawn(async move { runner.run(&identity, v, a, c).await });
    tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    let config = media(&[0, 0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x68, 1], 1 << 62);
    stream
        .write_all(&cipher.seal(2, &config).unwrap())
        .await
        .unwrap();
    let frame = media(&[0, 0, 0, 1, 0x65, 1], (1 << 61) | 1);
    stream
        .write_all(&cipher.seal(2, &frame).unwrap())
        .await
        .unwrap();
    let pcm = media(&[0; 4], 1);
    stream
        .write_all(&cipher.seal(3, &pcm).unwrap())
        .await
        .unwrap();
    wait_for(|| video.0.lock().unwrap().len() == 2 && audio.0.lock().unwrap().len() == 1).await;
    cancel.cancel();
    assert!(task.await.unwrap().is_ok());
    drop(stream);
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while service.discover().await[0].availability != DeviceAvailability::Offline {
            tokio::task::yield_now().await
        }
    })
    .await
    .unwrap();
    let (mut replacement, mut cipher) = client(&info, id).await;
    replacement
        .write_all(&cipher.seal(4, b"").unwrap())
        .await
        .unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while service.discover().await[0].availability != DeviceAvailability::Ready {
            tokio::task::yield_now().await
        }
    })
    .await
    .unwrap();
    assert_eq!(service.discover().await[0].identity, device.identity);
    service.stop("old-id").await.unwrap();
    assert_eq!(service.discover().await.len(), 1);
    service.stop(&info.receiver_id).await.unwrap();
    assert!(service.discover().await.is_empty());
    assert!(TcpStream::connect(("127.0.0.1", info.port)).await.is_err());
}
#[tokio::test]
async fn loopback_rejects_wrong_key_and_oversized_hello_before_allocation() {
    let service = IosWifiReceiverService::default();
    let info = service.start_on("127.0.0.1:0").await.unwrap();
    for oversized in [false, true] {
        let mut stream = TcpStream::connect(("127.0.0.1", info.port)).await.unwrap();
        let mut greeting = [0; 20];
        stream.read_exact(&mut greeting).await.unwrap();
        let frame = if oversized {
            (u32::MAX).to_be_bytes().to_vec()
        } else {
            WireCipher::new(&[0; 32], greeting[4..].try_into().unwrap())
                .seal(1, b"hello")
                .unwrap()
        };
        stream.write_all(&frame).await.unwrap();
        let mut end = [0];
        let result = tokio::time::timeout(std::time::Duration::from_secs(2), stream.read(&mut end))
            .await
            .unwrap();
        assert!(result.is_err() || result.unwrap() == 0);
        assert!(service.discover().await.is_empty());
    }
    service.cancel_all().await;
}

#[tokio::test]
async fn malformed_stream_packets_disconnect_without_registering_another_identity() {
    let receiver = IosWifiReceiverService::default();
    let config = media(&[0, 0, 0, 1, 0x67, 1, 0, 0, 0, 1, 0x68, 1], 1 << 62);
    let cases = vec![
        vec![(2, media(&[0, 0, 0, 1, 0x65, 1], 1))],
        vec![(2, media(&[0, 0, 0, 1, 0x67, 1], 1 << 62))],
        vec![(3, media(&[0; 4], 1 << 61))],
        vec![(4, vec![1])],
        vec![
            (2, config.clone()),
            (2, media(&[0, 0, 0, 1, 0x65, 1], 2)),
            (2, media(&[0, 0, 0, 1, 0x61, 1], 1)),
        ],
        vec![(3, media(&[0; 4096], 1)), (3, media(&[0; 4100], 2))],
    ];
    for packets in cases {
        let info = receiver.start_on("127.0.0.1:0").await.unwrap();
        let (mut stream, mut cipher) = client(&info, "123e4567-e89b-42d3-a456-426614174000").await;
        for (kind, bytes) in packets {
            stream
                .write_all(&cipher.seal(kind, &bytes).unwrap())
                .await
                .unwrap();
        }
        let mut end = [0];
        let result = tokio::time::timeout(std::time::Duration::from_secs(2), stream.read(&mut end))
            .await
            .unwrap();
        assert!(result.is_err() || result.unwrap() == 0);
        assert_eq!(
            receiver.discover().await[0].availability,
            DeviceAvailability::Offline
        );
        let (mut stranger, _) = client(&info, "123e4567-e89b-42d3-a456-426614174001").await;
        let result =
            tokio::time::timeout(std::time::Duration::from_secs(2), stranger.read(&mut end))
                .await
                .unwrap();
        assert!(result.is_err() || result.unwrap() == 0);
        receiver.stop(&info.receiver_id).await.unwrap();
    }
}
#[tokio::test]
async fn diagnostics_distinguish_authenticated_broadcast_from_retained_offline_device() {
    use phone_mirror_desktop::connection_diagnostics::ProbeObservation;
    let receiver = IosWifiReceiverService::default();
    let info = receiver.start_on("127.0.0.1:0").await.unwrap();
    let (stream, _) = client(&info, "123e4567-e89b-42d3-a456-426614174000").await;
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while receiver.discover().await.is_empty() {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        receiver.diagnostic_observation().await,
        ProbeObservation::Passed
    );
    drop(stream);
    tokio::time::timeout(std::time::Duration::from_secs(1), async {
        while receiver.discover().await[0].availability != DeviceAvailability::Offline {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert_eq!(
        receiver.diagnostic_observation().await,
        ProbeObservation::Offline
    );
    receiver.stop(&info.receiver_id).await.unwrap();
}
