use phone_mirror_desktop::{
    domain::VideoPacketHeader,
    infrastructure::AudioPacketSink,
    ios::{forward_ios_audio_packet, ios_audio_packet},
};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;
#[derive(Default)]
struct AudioSink(Mutex<Vec<Vec<u8>>>);
impl AudioPacketSink for AudioSink {
    fn send(&self, packet: Vec<u8>) -> Result<(), String> {
        self.0.lock().unwrap().push(packet);
        Ok(())
    }
    fn status(&self, _: &str) {}
}
#[test]
fn usb_audio_packet_boundaries_and_cancelled_late_delivery() {
    let sink = AudioSink::default();
    let cancel = CancellationToken::new();
    for size in [4, 4096] {
        let packet = ios_audio_packet(&vec![0; size], (1u64 << 53) - 1).unwrap();
        assert_eq!(
            VideoPacketHeader::parse(&packet[..12]).unwrap().timestamp,
            (1u64 << 53) - 1
        );
        forward_ios_audio_packet(&packet, &sink, &cancel).unwrap();
    }
    for size in [0, 1, 3, 5, 4100] {
        assert!(ios_audio_packet(&vec![0; size], 0).is_err());
    }
    for timestamp in [1u64 << 53, u64::MAX] {
        assert!(ios_audio_packet(&[0; 4], timestamp).is_err());
    }
    let mut packet = ios_audio_packet(&[0; 4], 100_000).unwrap();
    assert!(forward_ios_audio_packet(&packet[..15], &sink, &cancel).is_err());
    packet[0] = 0x40;
    assert!(forward_ios_audio_packet(&packet, &sink, &cancel).is_err());
    packet[0] = 0;
    cancel.cancel();
    assert!(forward_ios_audio_packet(&packet, &sink, &cancel).is_err());
    assert_eq!(sink.0.lock().unwrap().len(), 2);
}
#[cfg(target_os = "macos")]
#[test]
fn synthetic_usb_media_uses_shared_timestamps_and_records_audio() {
    use phone_mirror_desktop::infrastructure::VideoPacketSink;
    #[derive(Default)]
    struct VideoSink(Mutex<Vec<Vec<u8>>>);
    impl VideoPacketSink for VideoSink {
        fn send(&self, packet: Vec<u8>) -> Result<(), String> {
            self.0.lock().unwrap().push(packet);
            Ok(())
        }
    }
    let video = Arc::new(VideoSink::default());
    let audio = Arc::new(AudioSink::default());
    phone_mirror_desktop::ios_capture::verify_native_media(
        video.clone(),
        audio.clone(),
        CancellationToken::new(),
    )
    .unwrap();
    let videos = video.0.lock().unwrap();
    let audios = audio.0.lock().unwrap();
    assert!(!audios.is_empty());
    assert_eq!(
        VideoPacketHeader::parse(&audios[0][..12])
            .unwrap()
            .timestamp,
        100_000
    );
    assert!(audios.iter().all(|p| p.len() <= 4108));
    assert!(audios
        .windows(2)
        .all(|p| VideoPacketHeader::parse(&p[0][..12]).unwrap().timestamp
            < VideoPacketHeader::parse(&p[1][..12]).unwrap().timestamp));
    let recording = phone_mirror_desktop::recording::RecordingSession::default();
    let directory = tempfile::tempdir().unwrap();
    recording.push(&videos[0]);
    let id = recording
        .start_with_audio(directory.path(), 320, 640, 30, true)
        .unwrap();
    // Feed each audio packet after the preceding video time; capture delegates have independent arrival order.
    let mut index = 0;
    for packet in videos.iter().skip(1) {
        recording.push(packet);
        let time = VideoPacketHeader::parse(&packet[..12]).unwrap().timestamp;
        while index < audios.len()
            && VideoPacketHeader::parse(&audios[index][..12])
                .unwrap()
                .timestamp
                <= time
        {
            recording.push_audio(&audios[index]);
            index += 1;
        }
    }
    for packet in &audios[index..] {
        recording.push_audio(packet);
    }
    let file = recording.finish(&id).unwrap();
    let reader = mp4::Mp4Reader::read_header(
        std::fs::File::open(file.path()).unwrap(),
        std::fs::metadata(file.path()).unwrap().len(),
    )
    .unwrap();
    assert_eq!(reader.tracks().len(), 2);
    assert_eq!(reader.tracks()[&2].trak.mdia.mdhd.timescale, 48000);
    if let Some(output) = std::env::var_os("PHONE_MIRROR_USB_AUDIO_VERIFY_DIRECTORY") {
        std::fs::create_dir_all(&output).unwrap();
        std::fs::copy(
            file.path(),
            std::path::Path::new(&output).join("synthetic-usb-av.mp4"),
        )
        .unwrap();
    }
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    let empty_video = Arc::new(VideoSink::default());
    let empty_audio = Arc::new(AudioSink::default());
    phone_mirror_desktop::ios_capture::verify_native_media(
        empty_video.clone(),
        empty_audio.clone(),
        cancelled,
    )
    .unwrap();
    assert!(empty_video.0.lock().unwrap().is_empty());
    assert!(empty_audio.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn injected_usb_port_routes_audio_and_skips_cancelled_start() {
    use phone_mirror_desktop::{
        domain::*,
        infrastructure::VideoPacketSink,
        ios_capture::{IosCapturePort, IosCaptureService},
    };
    struct Port;
    impl IosCapturePort for Port {
        fn discover(&self) -> Result<Vec<PhoneDevice>, String> {
            Ok(vec![])
        }
        fn run(
            &self,
            _: &str,
            _: &MirrorSettings,
            _: Arc<dyn VideoPacketSink>,
            _: CancellationToken,
        ) -> Result<(), String> {
            panic!("audio path required")
        }
        fn run_with_audio(
            &self,
            _: &str,
            _: &MirrorSettings,
            _: Arc<dyn VideoPacketSink>,
            audio: Arc<dyn AudioPacketSink>,
            cancel: CancellationToken,
        ) -> Result<(), String> {
            let packet = ios_audio_packet(&[1, 0, 1, 0], 0)?;
            forward_ios_audio_packet(&packet, audio.as_ref(), &cancel)
        }
    }
    struct Video;
    impl VideoPacketSink for Video {
        fn send(&self, _: Vec<u8>) -> Result<(), String> {
            Ok(())
        }
    }
    let service = IosCaptureService::new(Arc::new(Port));
    let audio = Arc::new(AudioSink::default());
    let endpoint = DeviceEndpoint {
        transport: ConnectionTransport::Usb,
        identifier: "mock".into(),
        address: "mock".into(),
    };
    let cancel = CancellationToken::new();
    cancel.cancel();
    service
        .run_with_audio(
            endpoint.clone(),
            MirrorSettings::default(),
            Arc::new(Video),
            audio.clone(),
            cancel,
        )
        .await
        .unwrap();
    assert!(audio.0.lock().unwrap().is_empty());
    service
        .run_with_audio(
            endpoint,
            MirrorSettings::default(),
            Arc::new(Video),
            audio.clone(),
            CancellationToken::new(),
        )
        .await
        .unwrap();
    assert_eq!(audio.0.lock().unwrap().len(), 1);
}
#[test]
fn usb_audio_sink_failure_is_propagated() {
    struct Failed;
    impl AudioPacketSink for Failed {
        fn send(&self, _: Vec<u8>) -> Result<(), String> {
            Err("simulated closed receiver".into())
        }
        fn status(&self, _: &str) {}
    }
    assert!(forward_ios_audio_packet(
        &ios_audio_packet(&[0; 4], 0).unwrap(),
        &Failed,
        &CancellationToken::new()
    )
    .unwrap_err()
    .contains("closed receiver"));
}

#[cfg(target_os = "macos")]
#[test]
fn native_usb_audio_cancellation_drains_callbacks_and_sink_failure_propagates() {
    use phone_mirror_desktop::infrastructure::VideoPacketSink;
    struct Video;
    impl VideoPacketSink for Video {
        fn send(&self, _: Vec<u8>) -> Result<(), String> {
            Ok(())
        }
    }
    struct CancelAudio {
        cancellation: CancellationToken,
        count: std::sync::atomic::AtomicUsize,
    }
    impl AudioPacketSink for CancelAudio {
        fn send(&self, _: Vec<u8>) -> Result<(), String> {
            self.count.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            self.cancellation.cancel();
            Ok(())
        }
        fn status(&self, _: &str) {}
    }
    let token = CancellationToken::new();
    let audio = Arc::new(CancelAudio {
        cancellation: token.clone(),
        count: 0.into(),
    });
    phone_mirror_desktop::ios_capture::verify_native_media(Arc::new(Video), audio.clone(), token)
        .unwrap();
    assert_eq!(audio.count.load(std::sync::atomic::Ordering::SeqCst), 1);
    struct Failed;
    impl AudioPacketSink for Failed {
        fn send(&self, _: Vec<u8>) -> Result<(), String> {
            Err("simulated native sink failure".into())
        }
        fn status(&self, _: &str) {}
    }
    let failure = phone_mirror_desktop::ios_capture::verify_native_media(
        Arc::new(Video),
        Arc::new(Failed),
        CancellationToken::new(),
    )
    .unwrap_err();
    assert!(failure.contains("native sink failure"));
}

#[tokio::test]
async fn legacy_video_only_service_uses_video_only_port_without_audio_permission() {
    use phone_mirror_desktop::{
        domain::*,
        infrastructure::VideoPacketSink,
        ios_capture::{IosCapturePort, IosCaptureService},
    };
    struct Port;
    impl IosCapturePort for Port {
        fn discover(&self) -> Result<Vec<PhoneDevice>, String> {
            Ok(vec![])
        }
        fn run(
            &self,
            _: &str,
            _: &MirrorSettings,
            _: Arc<dyn VideoPacketSink>,
            _: CancellationToken,
        ) -> Result<(), String> {
            Err("legacy video port called".into())
        }
        fn run_with_audio(
            &self,
            _: &str,
            _: &MirrorSettings,
            _: Arc<dyn VideoPacketSink>,
            _: Arc<dyn AudioPacketSink>,
            _: CancellationToken,
        ) -> Result<(), String> {
            panic!("legacy path must not request audio")
        }
    }
    struct Video;
    impl VideoPacketSink for Video {
        fn send(&self, _: Vec<u8>) -> Result<(), String> {
            Ok(())
        }
    }
    let service = IosCaptureService::new(Arc::new(Port));
    let endpoint = DeviceEndpoint {
        transport: ConnectionTransport::Usb,
        address: "mock".into(),
        identifier: "mock".into(),
    };
    assert!(service
        .run(
            endpoint,
            MirrorSettings::default(),
            Arc::new(Video),
            CancellationToken::new()
        )
        .await
        .unwrap_err()
        .contains("legacy video port"));
}
