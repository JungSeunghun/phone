use phone_mirror_desktop::recording_audio::{AlignedAudio, RecordingTimeline};
#[test]
fn timeline_excludes_pause_and_waits_for_resume_keyframe() {
    let mut t = RecordingTimeline::default();
    assert_eq!(t.video(10, false).unwrap(), None);
    assert_eq!(t.audio(10), None);
    assert_eq!(t.video(100, true).unwrap(), Some(0));
    assert_eq!(t.video(40_100, false).unwrap(), Some(40_000));
    assert_eq!(t.audio(20_100), Some(20_000));
    t.pause(80_000).unwrap();
    assert_eq!(t.video(500_100, true).unwrap(), None);
    assert_eq!(t.audio(500_100), None);
    t.resume();
    assert_eq!(t.video(900_100, false).unwrap(), None);
    assert_eq!(t.video(1_000_100, true).unwrap(), Some(80_000));
    assert_eq!(t.audio(1_000_100), Some(80_000));
    assert_eq!(t.video(1_040_100, false).unwrap(), Some(120_000));
    assert!(t.video(1_040_099, false).is_err());
}
#[test]
fn audio_alignment_trims_overlap_fills_gaps_and_bounds_allocations() {
    let mut a = AlignedAudio::default();
    assert_eq!(a.append(0, &[1, 2, 3, 4]).unwrap(), vec![1, 2, 3, 4]);
    assert_eq!(a.append(0, &[9, 9, 9, 9]).unwrap(), Vec::<u8>::new());
    assert_eq!(
        a.append(62, &[5, 6, 7, 8]).unwrap(),
        vec![0, 0, 0, 0, 0, 0, 0, 0, 5, 6, 7, 8]
    );
    assert!(a.append(u64::MAX, &[0; 4]).is_err());
    assert!(a.append(0, &[]).is_err());
    assert!(a.append(0, &[1, 2, 3]).is_err());
    assert!(a.append(0, &vec![0; 4100]).is_err());
    assert!(a.append(3_000_000, &[0; 4]).is_err());
}
#[test]
fn timeline_repeated_actions_and_empty_pause_do_not_shift_start() {
    let mut t = RecordingTimeline::default();
    t.pause(0).unwrap();
    t.pause(0).unwrap();
    t.resume();
    t.resume();
    assert_eq!(t.video((1 << 53) - 1, true).unwrap(), Some(0));
    assert!(t.video(1 << 53, true).is_err());
    assert!(t.pause(u64::MAX).is_err());
}
use phone_mirror_desktop::recording::{RecordingClock, RecordingSession};
use std::{
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
struct Clock(Mutex<Instant>);
impl RecordingClock for Clock {
    fn now(&self) -> Instant {
        *self.0.lock().unwrap()
    }
}
fn packet(timestamp: u64, payload: &[u8]) -> Vec<u8> {
    let mut p = timestamp.to_be_bytes().to_vec();
    p.extend((payload.len() as u32).to_be_bytes());
    p.extend(payload);
    p
}
fn config() -> Vec<u8> {
    packet(
        1 << 62,
        &[0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x1e, 1, 0, 0, 1, 0x68, 1],
    )
}
#[test]
fn muxes_aac_and_video_with_equal_edit_duration_and_pause_removed() {
    let directory = tempfile::tempdir().unwrap();
    let origin = Instant::now();
    let clock = Arc::new(Clock(Mutex::new(origin)));
    let session = RecordingSession::with_clock(clock.clone());
    session.push(&config());
    let id = session
        .start_with_audio(directory.path(), 320, 180, 25, true)
        .unwrap();
    for segment in 0..2 {
        let base = if segment == 0 { 100_000 } else { 3_000_000 };
        if segment == 1 {
            session.set_paused(&id, false).unwrap();
            session.set_paused(&id, false).unwrap();
            session.push(&packet(base - 1, &[0, 0, 1, 0x41, 1]));
        }
        for frame in 0..3 {
            *clock.0.lock().unwrap() = origin
                + Duration::from_millis(if segment == 0 {
                    frame * 40
                } else {
                    2120 + frame * 40
                });
            let flags = if frame == 0 { 1 << 61 } else { 0 };
            session.push(&packet(
                flags | (base + frame * 40_000),
                &[0, 0, 1, if frame == 0 { 0x65 } else { 0x41 }, 1],
            ));
        }
        for block in 0..4 {
            let mut pcm = Vec::new();
            for sample in 0..1024 {
                let value = ((sample as f64 * 440.0 * std::f64::consts::TAU / 48000.0).sin()
                    * 10000.0) as i16;
                pcm.extend(value.to_le_bytes());
                pcm.extend(value.to_le_bytes());
            }
            session.push_audio(&packet(base + block * 1_024_000_000 / 48000, &pcm));
        }
        *clock.0.lock().unwrap() =
            origin + Duration::from_millis(if segment == 0 { 120 } else { 2240 });
        if segment == 0 {
            session.set_paused(&id, true).unwrap();
            session.set_paused(&id, true).unwrap();
            session.push_audio(&packet(base + 200000, &[0; 4]));
            session.push(&packet((1 << 61) | (base + 200000), &[0, 0, 1, 0x65, 1]));
            *clock.0.lock().unwrap() = origin + Duration::from_millis(2120);
        }
    }
    assert!(session.set_paused("wrong", true).is_err());
    let file = session.finish(&id).unwrap();
    let mut reader = mp4::Mp4Reader::read_header(
        std::fs::File::open(file.path()).unwrap(),
        std::fs::metadata(file.path()).unwrap().len(),
    )
    .unwrap();
    assert_eq!(reader.tracks().len(), 2);
    assert_eq!(reader.sample_count(1).unwrap(), 6);
    assert!(reader.sample_count(2).unwrap() >= 12);
    assert!(reader.read_sample(1, 4).unwrap().unwrap().is_sync);
    let audio = &reader.moov.traks[1];
    let edit = &audio.edts.as_ref().unwrap().elst.as_ref().unwrap().entries[0];
    assert_eq!(edit.media_time, 1024);
    assert_eq!(edit.segment_duration, 240_000);
    assert_eq!(reader.moov.mvhd.duration, 240_000);
    assert!(session.set_paused(&id, false).is_err());
}
#[test]
fn malformed_audio_fails_without_leaking_partial_file() {
    let dir = tempfile::tempdir().unwrap();
    let s = RecordingSession::default();
    s.push(&config());
    let id = s.start_with_audio(dir.path(), 1, 1, 60, true).unwrap();
    s.push(&packet(1 << 61, &[0, 0, 1, 0x65, 1]));
    s.push_audio(&packet(0, &[0; 3]));
    assert!(s.finish(&id).is_err());
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}
#[test]
fn pause_before_first_keyframe_and_finish_while_paused() {
    let d = tempfile::tempdir().unwrap();
    let s = RecordingSession::default();
    s.push(&config());
    let id = s.start(d.path(), 320, 180, 30).unwrap();
    s.set_paused(&id, true).unwrap();
    s.push(&packet(1 << 61, &[0, 0, 1, 0x65, 1]));
    s.set_paused(&id, false).unwrap();
    s.push(&packet((1 << 61) | 500000, &[0, 0, 1, 0x65, 1]));
    s.set_paused(&id, true).unwrap();
    assert!(s.finish(&id).is_ok());
}
#[cfg(target_os = "macos")]
#[test]
fn native_synthetic_video_and_audio_export_decodable_mp4() {
    use phone_mirror_desktop::infrastructure::VideoPacketSink;
    use tokio_util::sync::CancellationToken;
    #[derive(Default)]
    struct Sink(Mutex<Vec<Vec<u8>>>);
    impl VideoPacketSink for Sink {
        fn send(&self, p: Vec<u8>) -> Result<(), String> {
            self.0.lock().unwrap().push(p);
            Ok(())
        }
    }
    let sink = Arc::new(Sink::default());
    phone_mirror_desktop::ios_capture::verify_native_encoder(
        sink.clone(),
        CancellationToken::new(),
    )
    .unwrap();
    let packets = sink.0.lock().unwrap();
    let directory = tempfile::tempdir().unwrap();
    let origin = Instant::now();
    let clock = Arc::new(Clock(Mutex::new(origin)));
    let session = RecordingSession::with_clock(clock.clone());
    session.push(&packets[0]);
    let id = session
        .start_with_audio(directory.path(), 320, 640, 30, true)
        .unwrap();
    let mut block = 0u64;
    for p in packets.iter().skip(1).take(8) {
        let pts = phone_mirror_desktop::domain::VideoPacketHeader::parse(&p[..12])
            .unwrap()
            .timestamp;
        *clock.0.lock().unwrap() = origin + Duration::from_micros(pts);
        session.push(p);
        while block * 1_024_000_000 / 48000 <= pts {
            let timestamp = block * 1_024_000_000 / 48000;
            let mut pcm = Vec::new();
            for sample in 0..1024 {
                let time = timestamp as f64 / 1e6 + sample as f64 / 48000.0;
                let value = if time < 0.1 {
                    0
                } else {
                    (time * 440.0 * std::f64::consts::TAU)
                        .sin()
                        .mul_add(10000.0, 0.0) as i16
                };
                pcm.extend(value.to_le_bytes());
                pcm.extend(value.to_le_bytes());
            }
            session.push_audio(&packet(timestamp, &pcm));
            block += 1;
        }
    }
    *clock.0.lock().unwrap() = origin + Duration::from_micros(266667);
    let file = session.finish(&id).unwrap();
    if let Some(path) = std::env::var_os("PHONE_MIRROR_AV_VERIFY_DIRECTORY") {
        let output = std::path::PathBuf::from(path);
        std::fs::create_dir_all(&output).unwrap();
        file.publish(&output.join("synthetic-av.mp4")).unwrap();
    }
    let reader = mp4::Mp4Reader::read_header(
        std::fs::File::open(file.path()).unwrap(),
        std::fs::metadata(file.path()).unwrap().len(),
    )
    .unwrap();
    assert_eq!(reader.tracks().len(), 2);
    assert_eq!(reader.sample_count(1).unwrap(), 8);
    assert!(reader.sample_count(2).unwrap() > 8);
}
#[test]
fn pause_cannot_reverse_output_time_or_overflow_next_segment() {
    let mut t = RecordingTimeline::default();
    t.video(0, true).unwrap();
    t.video(100, false).unwrap();
    assert!(t.pause(99).is_err());
    t.pause((1 << 53) - 1).unwrap();
    t.resume();
    assert_eq!(t.video(0, true).unwrap(), Some((1 << 53) - 1));
    assert!(t.video(1, false).is_err());
}
#[test]
fn injected_audio_encoder_failure_does_not_leave_a_job_or_cached_file() {
    use phone_mirror_desktop::recording_audio::{
        RecordingAudioEncoder, RecordingAudioEncoderFactory,
    };
    struct FailingFactory;
    impl RecordingAudioEncoderFactory for FailingFactory {
        fn create(&self) -> Result<Box<dyn RecordingAudioEncoder>, String> {
            Err("mock encoder init".into())
        }
    }
    let directory = tempfile::tempdir().unwrap();
    let session = RecordingSession::with_clock_and_audio_factory(
        Arc::new(Clock(Mutex::new(Instant::now()))),
        Arc::new(FailingFactory),
    );
    session.push(&config());
    assert!(session
        .start_with_audio(directory.path(), 320, 180, 30, true)
        .is_err());
    assert!(!session.has_job());
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
    // The same video-only session remains usable when audio is unavailable.
    let id = session.start(directory.path(), 320, 180, 30).unwrap();
    session.push(&packet(1 << 61, &[0, 0, 1, 0x65, 1]));
    assert!(session.finish(&id).is_ok());
}
#[test]
fn audio_crossing_first_keyframe_is_trimmed_at_sample_precision() {
    use phone_mirror_desktop::recording_audio::{
        RecordingAudioEncoder, RecordingAudioEncoderFactory,
    };
    struct Factory(Arc<Mutex<Vec<Vec<i16>>>>);
    struct Encoder(Arc<Mutex<Vec<Vec<i16>>>>);
    impl RecordingAudioEncoder for Encoder {
        fn encode(&mut self, pcm: &[i16]) -> Result<Vec<u8>, String> {
            self.0.lock().unwrap().push(pcm.to_vec());
            Ok(vec![1, 2])
        }
        fn flush(&mut self) -> Result<Vec<u8>, String> {
            Ok(vec![1, 2])
        }
    }
    impl RecordingAudioEncoderFactory for Factory {
        fn create(&self) -> Result<Box<dyn RecordingAudioEncoder>, String> {
            Ok(Box::new(Encoder(self.0.clone())))
        }
    }
    let captured = Arc::new(Mutex::new(Vec::new()));
    let directory = tempfile::tempdir().unwrap();
    let origin = Instant::now();
    let clock = Arc::new(Clock(Mutex::new(origin)));
    let session = RecordingSession::with_clock_and_audio_factory(
        clock.clone(),
        Arc::new(Factory(captured.clone())),
    );
    session.push(&config());
    let id = session
        .start_with_audio(directory.path(), 320, 180, 30, true)
        .unwrap();
    let mut pcm = Vec::new();
    for value in 1i16..=1024 {
        pcm.extend(value.to_le_bytes());
        pcm.extend(value.to_le_bytes());
    }
    session.push_audio(&packet(98_000, &pcm));
    session.push(&packet((1 << 61) | 100_000, &[0, 0, 1, 0x65, 1]));
    *clock.0.lock().unwrap() = origin + Duration::from_millis(34);
    session.finish(&id).unwrap();
    let blocks = captured.lock().unwrap();
    assert_eq!(blocks[0][0], 97);
    assert_eq!(blocks[0][1854], 1024);
    assert_eq!(blocks[0][1856], 0);
}
