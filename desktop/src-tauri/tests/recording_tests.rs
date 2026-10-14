use phone_mirror_desktop::recording::{annex_b_units, PacketBudget, RecordingSession};
fn packet(flags: u64, payload: &[u8]) -> Vec<u8> {
    let mut p = flags.to_be_bytes().to_vec();
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
fn parses_start_codes_and_rejects_malformed_units() {
    assert_eq!(
        annex_b_units(&[0, 0, 1, 0x65, 1, 0, 0, 0, 1, 0x41, 2])
            .unwrap()
            .len(),
        2
    );
    for data in [&[][..], &[1, 2], &[0, 0, 1], &[0, 0, 1, 0]] {
        assert!(annex_b_units(data).is_err());
    }
}
#[test]
fn budget_is_bounded_and_releases_exact_reservations() {
    let b = PacketBudget::new(10);
    assert!(b.reserve(10));
    assert!(!b.reserve(1));
    assert!(!b.reserve(usize::MAX));
    b.release(10);
    assert!(b.reserve(1));
}
#[test]
fn waits_for_keyframe_and_preserves_timestamps_without_encoding() {
    let dir = tempfile::tempdir().unwrap();
    let s = RecordingSession::default();
    s.push(&config());
    let id = s.start(dir.path(), 320, 180, 60).unwrap();
    assert!(s.start(dir.path(), 320, 180, 60).is_err());
    s.push(&packet(1, &[0, 0, 1, 0x41, 1]));
    s.push(&packet((1 << 61) | 1000, &[0, 0, 1, 0x65, 1]));
    s.push(&packet(17667, &[0, 0, 1, 0x41, 2]));
    let file = s.finish(&id).unwrap();
    let f = std::fs::File::open(file.path()).unwrap();
    let reader =
        mp4::Mp4Reader::read_header(f, std::fs::metadata(file.path()).unwrap().len()).unwrap();
    assert_eq!(reader.sample_count(1).unwrap(), 2);
    assert!(s.finish(&id).is_err());
    drop(file);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}
#[test]
fn rejects_bad_dimensions_missing_configuration_and_empty_recordings() {
    let d = tempfile::tempdir().unwrap();
    let s = RecordingSession::default();
    assert!(s.start(d.path(), 1, 1, 60).is_err());
    s.push(&config());
    for (w, h, fps) in [(0, 1, 60), (8193, 1, 60), (1, 0, 60), (1, 1, 0), (1, 1, 61)] {
        assert!(s.start(d.path(), w, h, fps).is_err());
    }
    let id = s.start(d.path(), 320, 180, 60).unwrap();
    assert!(s.finish(&id).is_err());
    assert_eq!(std::fs::read_dir(d.path()).unwrap().count(), 0);
}
#[test]
fn session_close_finishes_recording_and_rejects_late_start() {
    let d = tempfile::tempdir().unwrap();
    let s = RecordingSession::default();
    s.push(&config());
    let id = s.start(d.path(), 320, 180, 60).unwrap();
    s.push(&packet(1 << 61, &[0, 0, 1, 0x65, 1]));
    s.close();
    assert!(!s.is_running(&id));
    assert!(s.start(d.path(), 320, 180, 60).is_err());
    assert!(s.finish(&id).is_ok());
}
#[test]
fn configuration_change_ends_valid_recording_before_new_resolution() {
    let d = tempfile::tempdir().unwrap();
    let s = RecordingSession::default();
    s.push(&config());
    let id = s.start(d.path(), 320, 180, 60).unwrap();
    s.push(&packet(1 << 61, &[0, 0, 1, 0x65, 1]));
    s.push(&packet(
        1 << 62,
        &[0, 0, 1, 0x67, 0x42, 0, 0x20, 1, 0, 0, 1, 0x68, 1],
    ));
    assert!(!s.is_running(&id));
    assert!(s.finish(&id).is_ok());
}
#[test]
fn wrong_recording_id_cannot_stop_active_recording() {
    let d = tempfile::tempdir().unwrap();
    let s = RecordingSession::default();
    s.push(&config());
    let id = s.start(d.path(), 320, 180, 60).unwrap();
    assert!(s.finish("wrong").is_err());
    assert!(s.is_running(&id));
    s.push(&packet(1 << 61, &[0, 0, 1, 0x65, 1]));
    assert!(s.finish(&id).is_ok());
}
#[test]
fn backward_timestamp_fails_without_leaving_a_file() {
    let d = tempfile::tempdir().unwrap();
    let s = RecordingSession::default();
    s.push(&config());
    let id = s.start(d.path(), 320, 180, 60).unwrap();
    s.push(&packet((1 << 61) | 100, &[0, 0, 1, 0x65, 1]));
    s.push(&packet(99, &[0, 0, 1, 0x41, 1]));
    assert!(s.finish(&id).is_err());
    assert_eq!(std::fs::read_dir(d.path()).unwrap().count(), 0);
}
#[test]
fn invalid_budget_release_and_size_boundaries_do_not_wrap() {
    let b = PacketBudget::new(10);
    assert!(b.reserve(10));
    b.release(11);
    assert!(!b.reserve(1));
    b.release(10);
    assert!(b.reserve(10));
    use phone_mirror_desktop::recording::accept_recording_sample;
    let ceiling = phone_mirror_desktop::media::MEDIA_BYTE_LIMIT - 8 * 1024 * 1024;
    assert!(accept_recording_sample(ceiling - 1, 1, 0));
    assert!(!accept_recording_sample(ceiling, 1, 0));
    assert!(!accept_recording_sample(usize::MAX, 1, 0));
    assert!(!accept_recording_sample(0, 0, 0));
    assert!(!accept_recording_sample(0, 1, 200_000));
}
#[test]
fn published_recording_preserves_existing_destination_and_cleans_temporary_files() {
    let dir = tempfile::tempdir().unwrap();
    let s = RecordingSession::default();
    s.push(&config());
    let id = s.start(dir.path(), 320, 180, 60).unwrap();
    s.push(&packet(1 << 61, &[0, 0, 1, 0x65, 1]));
    let file = s.finish(&id).unwrap();
    let destination = dir.path().join("saved.mp4");
    file.publish(&destination).unwrap();
    let before = std::fs::read(&destination).unwrap();
    assert!(file.publish(&destination).is_err());
    assert_eq!(std::fs::read(&destination).unwrap(), before);
    assert!(file.publish(&dir.path().join("wrong.webm")).is_err());
    drop(file);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
}
#[test]
fn malformed_packet_fails_recording_and_cleans_partial_output() {
    let dir = tempfile::tempdir().unwrap();
    let s = RecordingSession::default();
    s.push(&config());
    let id = s.start(dir.path(), 320, 180, 60).unwrap();
    s.push(&packet(1 << 61, &[0, 0, 1, 0x65, 1]));
    s.push(&[1, 2, 3]);
    assert!(s.finish(&id).is_err());
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
}
#[test]
fn recording_time_limit_has_exact_boundary() {
    use phone_mirror_desktop::recording::recording_time_expired;
    use std::time::Duration;
    assert!(!recording_time_expired(Duration::ZERO));
    assert!(!recording_time_expired(Duration::from_millis(3_599_999)));
    assert!(recording_time_expired(Duration::from_secs(3600)));
    assert!(recording_time_expired(Duration::MAX));
}

#[test]
fn completed_recording_save_failure_preserves_original_and_allows_retry() {
    use phone_mirror_desktop::recording::CompletedRecordingStore;
    let directory = tempfile::tempdir().unwrap();
    let session = RecordingSession::default();
    session.push(&config());
    let id = session.start(directory.path(), 320, 180, 60).unwrap();
    session.push(&packet(1 << 61, &[0, 0, 1, 0x65, 1]));
    let file = session.finish(&id).unwrap();
    let original = file.path().to_owned();
    let store = CompletedRecordingStore::default();
    store.insert("recording".into(), file);
    let existing = directory.path().join("existing.mp4");
    std::fs::write(&existing, b"existing file").unwrap();
    assert!(store
        .save("recording", |file| {
            file.publish(&existing)?;
            Ok(Some(existing.to_string_lossy().into_owned()))
        })
        .is_err());
    assert!(original.exists());
    assert!(store.has_pending());
    let destination = directory.path().join("retry.mp4");
    assert!(store
        .save("recording", |file| {
            assert!(store.save("recording", |_| Ok(None)).is_err());
            file.publish(&destination)?;
            Ok(Some(destination.to_string_lossy().into_owned()))
        })
        .unwrap()
        .is_some());
    assert!(!original.exists());
    assert!(!store.has_pending());
    assert!(destination.exists());
    assert_eq!(std::fs::read(existing).unwrap(), b"existing file");
    assert!(store.save("missing", |_| Ok(None)).is_err());
}

#[test]
fn completed_recording_survives_missing_directory_and_save_panic_until_explicit_cancel() {
    use phone_mirror_desktop::recording::CompletedRecordingStore;
    let directory = tempfile::tempdir().unwrap();
    let session = RecordingSession::default();
    session.push(&config());
    let id = session.start(directory.path(), 320, 180, 60).unwrap();
    session.push(&packet(1 << 61, &[0, 0, 1, 0x65, 1]));
    let file = session.finish(&id).unwrap();
    let original = file.path().to_owned();
    let store = CompletedRecordingStore::default();
    store.insert("recording".into(), file);
    assert!(store
        .save("recording", |file| {
            file.publish(&directory.path().join("missing/video.mp4"))?;
            Ok(None)
        })
        .is_err());
    assert!(original.exists());
    assert!(
        std::panic::catch_unwind(|| store.save("recording", |_| panic!("dialog failure"))).is_err()
    );
    assert!(original.exists());
    assert_eq!(store.save("recording", |_| Ok(None)).unwrap(), None);
    assert!(!original.exists());
    assert!(!store.has_pending());
}

#[derive(Default)]
struct FrameRequests {
    count: std::sync::atomic::AtomicUsize,
    fail: std::sync::atomic::AtomicBool,
}
impl phone_mirror_desktop::recording::RecordingFrameRequester for FrameRequests {
    fn request_key_frame(&self) -> Result<(), String> {
        use std::sync::atomic::Ordering;
        self.count.fetch_add(1, Ordering::SeqCst);
        if self.fail.load(Ordering::SeqCst) {
            Err("frame request failed".into())
        } else {
            Ok(())
        }
    }
}
#[test]
fn recording_requests_new_key_frames_at_start_and_each_resume_without_replaying_old_frames() {
    use std::sync::{atomic::Ordering, Arc};
    let directory = tempfile::tempdir().unwrap();
    let requests = Arc::new(FrameRequests::default());
    let session = RecordingSession::with_frame_requester(requests.clone());
    session.push(&config());
    session.push(&packet((1 << 61) | 1, &[0, 0, 1, 0x65, 1])); // Before the user starts.
    let id = session.start(directory.path(), 320, 180, 60).unwrap();
    assert_eq!(requests.count.load(Ordering::SeqCst), 1);
    assert!(session.start(directory.path(), 320, 180, 60).is_err());
    session.set_paused(&id, false).unwrap();
    assert_eq!(requests.count.load(Ordering::SeqCst), 1);
    session.push(&packet(100, &[0, 0, 1, 0x41, 1])); // Delta before the requested key frame.
    session.push(&packet((1 << 61) | 200, &[0, 0, 1, 0x65, 2]));
    session.set_paused(&id, true).unwrap();
    session.set_paused(&id, true).unwrap();
    session.push(&packet((1 << 61) | 300, &[0, 0, 1, 0x65, 3])); // Paused media is excluded.
    session.set_paused(&id, false).unwrap();
    session.set_paused(&id, false).unwrap();
    assert_eq!(requests.count.load(Ordering::SeqCst), 2);
    session.push(&packet(400, &[0, 0, 1, 0x41, 4]));
    session.push(&packet((1 << 61) | 500, &[0, 0, 1, 0x65, 5]));
    let file = session.finish(&id).unwrap();
    let mut reader = mp4::Mp4Reader::read_header(
        std::fs::File::open(file.path()).unwrap(),
        std::fs::metadata(file.path()).unwrap().len(),
    )
    .unwrap();
    assert_eq!(reader.sample_count(1).unwrap(), 2);
    assert!(reader.read_sample(1, 1).unwrap().unwrap().is_sync);
    assert!(reader.read_sample(1, 2).unwrap().unwrap().is_sync);
    assert!(session.set_paused(&id, false).is_err());
    session.close();
    assert!(session.start(directory.path(), 320, 180, 60).is_err());
    assert_eq!(requests.count.load(Ordering::SeqCst), 2);
}
#[test]
fn failed_frame_requests_do_not_start_recordings_or_resume_paused_recordings() {
    use std::sync::{atomic::Ordering, Arc};
    let directory = tempfile::tempdir().unwrap();
    let requests = Arc::new(FrameRequests::default());
    let session = RecordingSession::with_frame_requester(requests.clone());
    assert!(session.start(directory.path(), 320, 180, 60).is_err());
    assert_eq!(requests.count.load(Ordering::SeqCst), 0);
    session.push(&config());
    requests.fail.store(true, Ordering::SeqCst);
    assert!(session.start(directory.path(), 320, 180, 60).is_err());
    assert!(!session.has_job());
    requests.fail.store(false, Ordering::SeqCst);
    let id = session.start(directory.path(), 320, 180, 60).unwrap();
    session.push(&packet(1 << 61, &[0, 0, 1, 0x65, 1]));
    session.set_paused(&id, true).unwrap();
    requests.fail.store(true, Ordering::SeqCst);
    assert!(session.set_paused(&id, false).is_err());
    session.push(&packet((1 << 61) | 100, &[0, 0, 1, 0x65, 2]));
    let file = session.finish(&id).unwrap();
    let reader = mp4::Mp4Reader::read_header(
        std::fs::File::open(file.path()).unwrap(),
        std::fs::metadata(file.path()).unwrap().len(),
    )
    .unwrap();
    assert_eq!(reader.sample_count(1).unwrap(), 1);
}

#[tokio::test]
async fn readiness_waits_for_valid_new_video_and_cancels_when_session_closes() {
    use std::sync::Arc;
    let directory = tempfile::tempdir().unwrap();
    let session = Arc::new(RecordingSession::default());
    session.push(&config());
    session.push(&packet(1 << 61, &[0, 0, 1, 0x65, 1]));
    let id = session.start(directory.path(), 320, 180, 60).unwrap();
    let waiter = {
        let session = session.clone();
        let id = id.clone();
        tokio::spawn(async move { session.wait_until_ready(&id).await })
    };
    tokio::task::yield_now().await;
    assert!(
        !waiter.is_finished(),
        "start readiness returned before a new key frame"
    );
    session.push(&packet(100, &[0, 0, 1, 0x41, 1]));
    tokio::task::yield_now().await;
    assert!(!waiter.is_finished());
    session.push(&packet((1 << 61) | 200, &[0, 0, 1, 0x65, 2]));
    tokio::time::timeout(std::time::Duration::from_secs(1), waiter)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    assert!(session.finish(&id).is_ok());
    let id = session.start(directory.path(), 320, 180, 60).unwrap();
    session.close();
    assert!(session.wait_until_ready(&id).await.is_err());
    assert!(!session.has_job());
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
}
#[tokio::test(start_paused = true)]
async fn readiness_times_out_at_five_seconds_and_removes_partial_output() {
    use std::{sync::Arc, time::Duration};
    let directory = tempfile::tempdir().unwrap();
    let session = Arc::new(RecordingSession::default());
    session.push(&config());
    let id = session.start(directory.path(), 320, 180, 60).unwrap();
    let waiter = {
        let session = session.clone();
        let id = id.clone();
        tokio::spawn(async move { session.wait_until_ready(&id).await })
    };
    tokio::task::yield_now().await;
    tokio::time::advance(Duration::from_millis(4999)).await;
    assert!(!waiter.is_finished());
    tokio::time::advance(Duration::from_millis(1)).await;
    assert!(waiter.await.unwrap().is_err());
    assert!(!session.has_job());
    session.push(&packet((1 << 61) | 999, &[0, 0, 1, 0x65, 2]));
    assert!(
        !session.has_job(),
        "late frames must not revive timed-out startup"
    );
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn readiness_rejects_a_key_frame_flag_without_an_idr_sample() {
    let directory = tempfile::tempdir().unwrap();
    let session = RecordingSession::default();
    session.push(&config());
    let id = session.start(directory.path(), 320, 180, 60).unwrap();
    session.push(&packet(1 << 61, &[0, 0, 1, 0x41, 1]));
    assert!(session.wait_until_ready(&id).await.is_err());
    assert!(!session.has_job());
    assert_eq!(std::fs::read_dir(directory.path()).unwrap().count(), 0);
}

#[tokio::test]
async fn readiness_preserves_a_received_frame_when_disconnect_finishes_startup() {
    let directory = tempfile::tempdir().unwrap();
    let session = RecordingSession::default();
    session.push(&config());
    let id = session.start(directory.path(), 320, 180, 60).unwrap();
    session.push(&packet(1 << 61, &[0, 0, 1, 0x65, 1]));
    session.wait_until_ready(&id).await.unwrap();
    session.close();
    session.wait_until_ready(&id).await.unwrap();
    assert!(session.finish(&id).is_ok());
}
