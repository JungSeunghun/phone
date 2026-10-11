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
