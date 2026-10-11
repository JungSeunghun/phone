use phone_mirror_desktop::{domain::*, ios::*};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;
#[test]
fn ios_identity_filters_and_namespaces_usb_screen_devices() {
    let devices = parse_ios_devices(r#"[{"identifier":"abc","name":"My iPhone","model":"iOS Device"},{"identifier":"camera","name":"Camera","model":"FaceTime"},{"identifier":"abc","name":"duplicate","model":"iOS Device"}]"#).unwrap();
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].identity, "ios:abc");
    assert_eq!(devices[0].id, "usb:ios:abc");
    assert_eq!(devices[0].platform, PhonePlatform::Ios);
    assert!(!devices[0].capabilities.control);
    assert!(devices[0].capabilities.audio);
    assert!(is_ios_target(&devices[0].target()));
    assert!(!is_ios_target(&ConnectionTarget {
        identity: "abc".into(),
        transport: ConnectionTransport::Usb
    }));
    assert!(!is_ios_target(&ConnectionTarget {
        identity: "ios:abc".into(),
        transport: ConnectionTransport::Wifi
    }));
}
#[test]
fn ios_device_boundaries_and_corrupt_discovery_are_rejected() {
    for id in ["", " a", "a\n", &"a".repeat(253)] {
        let json =
            serde_json::json!([{"identifier":id,"name":"iPhone","model":"iOS Device"}]).to_string();
        assert!(parse_ios_devices(&json).unwrap().is_empty());
    }
    let json = serde_json::json!([{"identifier":"a".repeat(252),"name":"","model":"iOS Device"}])
        .to_string();
    assert_eq!(parse_ios_devices(&json).unwrap()[0].name, "iPhone");
    for json in ["null", "{", "{}", "[{}]"] {
        assert!(parse_ios_devices(json).is_err());
    }
}
#[test]
fn discovery_keeps_independent_platforms_available() {
    let ios =
        parse_ios_devices(r#"[{"identifier":"abc","name":"Phone","model":"iOS Device"}]"#).unwrap();
    assert_eq!(
        merge_device_results(Err("ADB missing".into()), Ok(ios.clone()))
            .unwrap()
            .len(),
        1
    );
    assert_eq!(
        merge_device_results(Ok(ios), Err("native unavailable".into()))
            .unwrap()
            .len(),
        1
    );
    assert!(merge_device_results(Err("ADB".into()), Err("iOS".into())).is_err());
}
#[derive(Default)]
struct Sink(Mutex<Vec<Vec<u8>>>);
impl phone_mirror_desktop::infrastructure::VideoPacketSink for Sink {
    fn send(&self, p: Vec<u8>) -> Result<(), String> {
        self.0.lock().unwrap().push(p);
        Ok(())
    }
}
#[test]
fn packet_forwarding_validates_lengths_and_cancellation_before_delivery() {
    let sink = Arc::new(Sink::default());
    let cancel = CancellationToken::new();
    let packet = ios_video_packet(&[0, 0, 0, 1, 0x65, 1], 42, false, true).unwrap();
    forward_ios_packet(&packet, sink.as_ref(), &cancel).unwrap();
    assert_eq!(sink.0.lock().unwrap().len(), 1);
    let parsed = VideoPacketHeader::parse(&packet[..12]).unwrap();
    assert!(parsed.key_frame);
    assert_eq!(parsed.timestamp, 42);
    for p in [&packet[..11], &packet[..13]] {
        assert!(forward_ios_packet(p, sink.as_ref(), &cancel).is_err());
    }
    for timestamp in [(1u64 << 53), u64::MAX] {
        assert!(ios_video_packet(&[1], timestamp, false, false).is_err());
    }
    assert!(ios_video_packet(&[], 0, false, false).is_err());
    cancel.cancel();
    assert!(forward_ios_packet(&packet, sink.as_ref(), &cancel).is_err());
    assert_eq!(sink.0.lock().unwrap().len(), 1);
}
#[cfg(target_os = "macos")]
#[test]
fn native_synthetic_encoder_feeds_the_shared_mp4_pipeline() {
    let sink = Arc::new(Sink::default());
    phone_mirror_desktop::ios_capture::verify_native_encoder(
        sink.clone(),
        CancellationToken::new(),
    )
    .unwrap();
    let packets = sink.0.lock().unwrap();
    let configurations: Vec<_> = packets
        .iter()
        .filter(|p| VideoPacketHeader::parse(&p[..12]).unwrap().configuration)
        .collect();
    assert_eq!(configurations.len(), 1);
    let frames: Vec<_> = packets
        .iter()
        .filter(|p| !VideoPacketHeader::parse(&p[..12]).unwrap().configuration)
        .collect();
    assert_eq!(frames.len(), 30);
    assert!(
        VideoPacketHeader::parse(&frames[0][..12])
            .unwrap()
            .key_frame
    );
    let mut previous = None;
    for p in &frames {
        let t = VideoPacketHeader::parse(&p[..12]).unwrap().timestamp;
        if let Some(previous) = previous {
            assert!(t > previous);
        }
        previous = Some(t);
    }
    let directory = tempfile::tempdir().unwrap();
    let recording = phone_mirror_desktop::recording::RecordingSession::default();
    recording.push(configurations[0]);
    let id = recording.start(directory.path(), 320, 640, 30).unwrap();
    for p in &frames {
        recording.push(p);
    }
    let file = recording.finish(&id).unwrap();
    let reader = mp4::Mp4Reader::read_header(
        std::fs::File::open(file.path()).unwrap(),
        std::fs::metadata(file.path()).unwrap().len(),
    )
    .unwrap();
    assert_eq!(reader.sample_count(1).unwrap(), 30);
    if let Some(path) = std::env::var_os("PHONE_MIRROR_IOS_VERIFY_DIRECTORY") {
        let path = std::path::PathBuf::from(path);
        std::fs::create_dir_all(&path).unwrap();
        std::fs::write(
            path.join("packets.json"),
            serde_json::to_vec(&*packets).unwrap(),
        )
        .unwrap();
        std::fs::copy(file.path(), path.join("native-synthetic.mp4")).unwrap();
    }
    let canceled = CancellationToken::new();
    canceled.cancel();
    let empty = Arc::new(Sink::default());
    phone_mirror_desktop::ios_capture::verify_native_encoder(empty.clone(), canceled).unwrap();
    assert!(empty.0.lock().unwrap().is_empty());
}
struct MockCapture {
    calls: std::sync::atomic::AtomicUsize,
    failure: bool,
}
impl phone_mirror_desktop::ios_capture::IosCapturePort for MockCapture {
    fn discover(&self) -> Result<Vec<PhoneDevice>, String> {
        if self.failure {
            Err("permission denied simulated".into())
        } else {
            parse_ios_devices(
                r#"[{"identifier":"mock","name":"Mock iPhone","model":"iOS Device"}]"#,
            )
        }
    }
    fn run(
        &self,
        _identifier: &str,
        _settings: &MirrorSettings,
        _sink: Arc<dyn phone_mirror_desktop::infrastructure::VideoPacketSink>,
        _cancellation: CancellationToken,
    ) -> Result<(), String> {
        self.calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        if self.failure {
            Err("disconnected simulated".into())
        } else {
            Ok(())
        }
    }
}
#[tokio::test]
async fn injected_capture_validates_before_native_access_and_propagates_failures() {
    use phone_mirror_desktop::ios_capture::IosCaptureService;
    let port = Arc::new(MockCapture {
        calls: 0.into(),
        failure: false,
    });
    let service = IosCaptureService::new(port.clone());
    let devices = service.discover().await.unwrap();
    let endpoint = devices[0].endpoint.clone();
    let canceled = CancellationToken::new();
    canceled.cancel();
    service
        .run(
            endpoint.clone(),
            MirrorSettings::default(),
            Arc::new(Sink::default()),
            canceled,
        )
        .await
        .unwrap();
    let mut invalid = endpoint.clone();
    invalid.transport = ConnectionTransport::Wifi;
    assert!(service
        .run(
            invalid,
            MirrorSettings::default(),
            Arc::new(Sink::default()),
            CancellationToken::new()
        )
        .await
        .is_err());
    let bad = MirrorSettings {
        video_max_frame_rate: 0,
        ..Default::default()
    };
    assert!(service
        .run(
            endpoint.clone(),
            bad,
            Arc::new(Sink::default()),
            CancellationToken::new()
        )
        .await
        .is_err());
    assert_eq!(port.calls.load(std::sync::atomic::Ordering::SeqCst), 0);
    service
        .run(
            endpoint.clone(),
            MirrorSettings::default(),
            Arc::new(Sink::default()),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(port.calls.load(std::sync::atomic::Ordering::SeqCst), 1);
    let failure = IosCaptureService::new(Arc::new(MockCapture {
        calls: 0.into(),
        failure: true,
    }));
    assert!(failure.discover().await.unwrap_err().contains("permission"));
    assert!(failure
        .run(
            endpoint,
            MirrorSettings::default(),
            Arc::new(Sink::default()),
            CancellationToken::new()
        )
        .await
        .unwrap_err()
        .contains("disconnected"));
}
