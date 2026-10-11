use phone_mirror_desktop::application::SessionRegistry;
use phone_mirror_desktop::domain::MirrorSettings;
use phone_mirror_desktop::infrastructure::{
    AdbCommandExecutor, BookmarkStore, JsonBookmarkStore, ProcessAdbCommandExecutor,
};
use std::time::Duration;
use tokio_util::sync::CancellationToken;

#[test]
fn stop_before_start_duplicate_start_replacement_and_late_stop_are_isolated() {
    let mut registry = SessionRegistry::default();
    let stopped = uuid::Uuid::new_v4().to_string();
    registry.stop(&stopped);
    assert!(registry.start(&stopped).is_err());
    let first = uuid::Uuid::new_v4().to_string();
    let first_token = registry.start(&first).unwrap();
    assert!(registry.start(&first).is_err());
    let second = uuid::Uuid::new_v4().to_string();
    let second_token = registry.start(&second).unwrap();
    assert!(first_token.is_cancelled());
    assert!(
        registry.start(&first).is_err(),
        "a replaced session cannot start again"
    );
    registry.stop(&first);
    assert!(!second_token.is_cancelled());
    registry.stop_all();
    assert!(second_token.is_cancelled());
    assert!(
        registry.start(&second).is_err(),
        "app shutdown remembers canceled sessions"
    );
    assert!(registry.start("bad").is_err());
}
#[test]
fn settings_accept_only_supported_dimensions_and_frame_rates() {
    for size in [720, 1280, 1920, 2560, 3840] {
        for fps in [15, 30, 60] {
            assert!(MirrorSettings {
                video_max_dimension: size,
                video_max_frame_rate: fps,
                keep_screen_awake: true
            }
            .validate()
            .is_ok());
        }
    }
    for size in [0, 719, 3841, u32::MAX] {
        assert!(MirrorSettings {
            video_max_dimension: size,
            ..MirrorSettings::default()
        }
        .validate()
        .is_err());
    }
    for fps in [0, 14, 61, u32::MAX] {
        assert!(MirrorSettings {
            video_max_frame_rate: fps,
            ..MirrorSettings::default()
        }
        .validate()
        .is_err());
    }
}
#[test]
fn corrupted_missing_and_replaced_bookmark_files_are_safe() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("settings/wireless.json");
    let store = JsonBookmarkStore::new(path.clone());
    assert!(store.load().unwrap().is_empty());
    store.save(&[]).unwrap();
    store.save(&[]).unwrap();
    std::fs::write(&path, "{broken").unwrap();
    assert!(store.load().unwrap().is_empty());
    std::fs::write(
        &path,
        r#"[{"identity":"","name":"bad","serviceName":"adb-X"}]"#,
    )
    .unwrap();
    assert!(store.load().unwrap().is_empty());
}
#[test]
fn process_timeout_boundaries_are_checked_before_spawn() {
    for duration in [Duration::ZERO, Duration::from_secs(61)] {
        assert!(ProcessAdbCommandExecutor::new("missing".into(), duration).is_err());
    }
    assert!(ProcessAdbCommandExecutor::new("missing".into(), Duration::from_secs(60)).is_ok());
}
#[tokio::test]
async fn cancelled_process_is_never_launched() {
    let executor =
        ProcessAdbCommandExecutor::new("missing".into(), Duration::from_secs(1)).unwrap();
    let cancellation = CancellationToken::new();
    cancellation.cancel();
    assert!(executor
        .execute(vec![], None, cancellation)
        .await
        .unwrap_err()
        .contains("취소"));
}
#[cfg(unix)]
#[tokio::test]
async fn process_transmits_stdin_and_cancellation_interrupts_a_running_child() {
    let executor =
        ProcessAdbCommandExecutor::new("/bin/cat".into(), Duration::from_secs(1)).unwrap();
    assert_eq!(
        executor
            .execute(
                vec![],
                Some("stdin fixture\n".into()),
                CancellationToken::new()
            )
            .await
            .unwrap()
            .output,
        "stdin fixture\n"
    );
    let sleeper =
        ProcessAdbCommandExecutor::new("/bin/sleep".into(), Duration::from_secs(12)).unwrap();
    let cancellation = CancellationToken::new();
    let worker_token = cancellation.clone();
    let worker =
        tokio::spawn(async move { sleeper.execute(vec!["10".into()], None, worker_token).await });
    tokio::time::sleep(Duration::from_millis(30)).await;
    cancellation.cancel();
    assert!(tokio::time::timeout(Duration::from_secs(1), worker)
        .await
        .unwrap()
        .unwrap()
        .unwrap_err()
        .contains("취소"));
}
#[cfg(unix)]
#[tokio::test]
async fn process_deadline_terminates_a_stalled_child() {
    let executor =
        ProcessAdbCommandExecutor::new("/bin/sleep".into(), Duration::from_millis(30)).unwrap();
    let result = tokio::time::timeout(
        Duration::from_secs(1),
        executor.execute(vec!["10".into()], None, CancellationToken::new()),
    )
    .await
    .unwrap();
    assert!(result.unwrap_err().contains("초과"));
}
