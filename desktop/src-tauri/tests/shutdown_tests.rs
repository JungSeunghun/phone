use phone_mirror_desktop::shutdown::{
    ShutdownActivity, ShutdownCoordinator, ShutdownDecision, ShutdownWake,
};
use std::time::Duration;

#[tokio::test(start_paused = true)]
async fn timeout_boundary_never_exits_during_media_finalization_or_save() {
    for activity in [
        ShutdownActivity {
            media_operations: 1,
            ..Default::default()
        },
        ShutdownActivity {
            media_operations: usize::MAX,
            ..Default::default()
        },
        ShutdownActivity {
            pending_recordings: true,
            ..Default::default()
        },
        ShutdownActivity {
            recording_jobs: true,
            ..Default::default()
        },
    ] {
        let coordinator = ShutdownCoordinator::default();
        let attempt = coordinator.begin().unwrap();
        assert!(coordinator.begin().is_none());
        let waiting = tokio::spawn({
            let attempt = attempt.clone();
            async move { attempt.wait().await }
        });
        tokio::task::yield_now().await;
        tokio::time::advance(Duration::from_millis(179_999)).await;
        tokio::task::yield_now().await;
        assert!(!waiting.is_finished());
        tokio::time::advance(Duration::from_millis(1)).await;
        let wake = waiting.await.unwrap();
        assert_eq!(wake, ShutdownWake::TimedOut);
        assert_eq!(
            coordinator.finish(&attempt, wake, activity),
            ShutdownDecision::Cancel
        );
        assert!(!coordinator.is_committing());
        assert!(coordinator.begin().is_some());
    }
}

#[tokio::test(start_paused = true)]
async fn previous_responses_cannot_cancel_or_complete_the_next_attempt() {
    for old_response in [false, true] {
        let coordinator = ShutdownCoordinator::default();
        let old = coordinator.begin().unwrap();
        tokio::time::advance(Duration::from_secs(180)).await;
        let wake = old.wait().await;
        assert_eq!(
            coordinator.finish(
                &old,
                wake,
                ShutdownActivity {
                    pending_recordings: true,
                    ..Default::default()
                }
            ),
            ShutdownDecision::Cancel
        );
        let current = coordinator.begin().unwrap();
        assert_ne!(old.id(), current.id());
        assert!(!coordinator.respond(old.id(), old_response));
        assert!(!coordinator.respond("invalid", true));
        let waiting = tokio::spawn({
            let current = current.clone();
            async move { current.wait().await }
        });
        tokio::task::yield_now().await;
        assert!(!waiting.is_finished());
        assert_eq!(
            coordinator.finish(&old, ShutdownWake::Allowed, ShutdownActivity::default()),
            ShutdownDecision::Stale
        );
        assert!(coordinator.respond(current.id(), true));
        assert!(!coordinator.respond(current.id(), false));
        assert_eq!(
            coordinator.finish(
                &current,
                waiting.await.unwrap(),
                ShutdownActivity::default()
            ),
            ShutdownDecision::Exit
        );
        assert!(coordinator.is_committing());
        assert!(!coordinator.respond(current.id(), false));
        assert!(coordinator.begin().is_none());
    }
}

#[tokio::test(start_paused = true)]
async fn idle_timeout_and_responses_before_at_and_after_deadline() {
    for milliseconds in [0, 179_999, 180_000, 180_001] {
        let coordinator = ShutdownCoordinator::default();
        let attempt = coordinator.begin().unwrap();
        tokio::time::advance(Duration::from_millis(milliseconds)).await;
        assert_eq!(
            coordinator.respond(attempt.id(), false),
            milliseconds <= 180_000
        );
        let wake = attempt.wait().await;
        assert_eq!(
            wake,
            if milliseconds <= 180_000 {
                ShutdownWake::Denied
            } else {
                ShutdownWake::TimedOut
            }
        );
        assert_eq!(
            coordinator.finish(&attempt, wake, ShutdownActivity::default()),
            if milliseconds <= 180_000 {
                ShutdownDecision::Cancel
            } else {
                ShutdownDecision::Exit
            }
        );
    }
    let coordinator = ShutdownCoordinator::default();
    let attempt = coordinator.begin().unwrap();
    tokio::time::advance(Duration::from_secs(180)).await;
    assert_eq!(
        coordinator.finish(&attempt, attempt.wait().await, ShutdownActivity::default()),
        ShutdownDecision::Exit
    );
}

#[tokio::test(start_paused = true)]
async fn positive_frontend_response_cannot_override_native_media_activity() {
    let coordinator = ShutdownCoordinator::default();
    let attempt = coordinator.begin().unwrap();
    assert!(coordinator.respond(attempt.id(), true));
    assert_eq!(
        coordinator.finish(
            &attempt,
            attempt.wait().await,
            ShutdownActivity {
                media_operations: 1,
                ..Default::default()
            }
        ),
        ShutdownDecision::Cancel
    );
}

#[tokio::test(start_paused = true)]
async fn actual_recording_worker_finalization_gap_is_protected_at_180_seconds() {
    use phone_mirror_desktop::{
        recording::{CompletedRecordingStore, RecordingClock, RecordingSession},
        recording_audio::{RecordingAudioEncoder, RecordingAudioEncoderFactory},
    };
    use std::sync::{mpsc, Arc, Mutex};
    struct Clock(std::time::Instant);
    impl RecordingClock for Clock {
        fn now(&self) -> std::time::Instant {
            self.0
        }
    }
    struct Factory {
        entered: mpsc::Sender<()>,
        release: Arc<Mutex<mpsc::Receiver<()>>>,
    }
    struct Encoder {
        entered: mpsc::Sender<()>,
        release: Arc<Mutex<mpsc::Receiver<()>>>,
    }
    impl RecordingAudioEncoderFactory for Factory {
        fn create(&self) -> Result<Box<dyn RecordingAudioEncoder>, String> {
            Ok(Box::new(Encoder {
                entered: self.entered.clone(),
                release: self.release.clone(),
            }))
        }
    }
    impl RecordingAudioEncoder for Encoder {
        fn encode(&mut self, _: &[i16]) -> Result<Vec<u8>, String> {
            Ok(vec![1, 2, 3])
        }
        fn flush(&mut self) -> Result<Vec<u8>, String> {
            self.entered.send(()).unwrap();
            self.release.lock().unwrap().recv().unwrap();
            Ok(vec![1, 2, 3])
        }
    }
    fn packet(flags: u64, payload: &[u8]) -> Vec<u8> {
        let mut bytes = flags.to_be_bytes().to_vec();
        bytes.extend((payload.len() as u32).to_be_bytes());
        bytes.extend(payload);
        bytes
    }
    let directory = tempfile::tempdir().unwrap();
    let (entered, waiting) = mpsc::channel();
    let (release, blocked) = mpsc::channel();
    let session = Arc::new(RecordingSession::with_clock_and_audio_factory(
        Arc::new(Clock(std::time::Instant::now())),
        Arc::new(Factory {
            entered,
            release: Arc::new(Mutex::new(blocked)),
        }),
    ));
    session.push(&packet(
        1 << 62,
        &[0, 0, 0, 1, 0x67, 0x42, 0xc0, 0x1e, 1, 0, 0, 1, 0x68, 1],
    ));
    let id = session
        .start_with_audio(directory.path(), 320, 180, 60, true)
        .unwrap();
    session.push(&packet(1 << 61, &[0, 0, 1, 0x65, 1]));
    let worker = session.clone();
    let finishing = std::thread::spawn(move || worker.finish(&id));
    // Release the fixture even if an assertion fails, so the worker cannot leak.
    struct Release(mpsc::Sender<()>);
    impl Drop for Release {
        fn drop(&mut self) {
            let _ = self.0.send(());
        }
    }
    let release = Release(release);
    waiting.recv_timeout(Duration::from_secs(3)).unwrap();
    assert!(!finishing.is_finished());
    assert!(!session.has_job());
    let completed = CompletedRecordingStore::default();
    let coordinator = ShutdownCoordinator::default();
    let attempt = coordinator.begin().unwrap();
    tokio::time::advance(Duration::from_secs(180)).await;
    assert_eq!(
        coordinator.finish(
            &attempt,
            attempt.wait().await,
            ShutdownActivity {
                media_operations: 1,
                pending_recordings: completed.has_pending(),
                recording_jobs: session.has_job(),
            }
        ),
        ShutdownDecision::Cancel
    );
    drop(release);
    let file = finishing.join().unwrap().unwrap();
    completed.insert("finished".into(), file);
    let retry = coordinator.begin().unwrap();
    assert!(coordinator.respond(retry.id(), true));
    assert_eq!(
        coordinator.finish(
            &retry,
            retry.wait().await,
            ShutdownActivity {
                pending_recordings: completed.has_pending(),
                ..Default::default()
            }
        ),
        ShutdownDecision::Cancel
    );
    completed.save("finished", |_| Ok(None)).unwrap();
    let final_attempt = coordinator.begin().unwrap();
    assert!(coordinator.respond(final_attempt.id(), true));
    assert_eq!(
        coordinator.finish(
            &final_attempt,
            final_attempt.wait().await,
            ShutdownActivity::default()
        ),
        ShutdownDecision::Exit
    );
}

#[tokio::test(start_paused = true)]
async fn denial_at_deadline_after_timer_wakes_still_cancels_before_exit_is_reserved() {
    let coordinator = ShutdownCoordinator::default();
    let attempt = coordinator.begin().unwrap();
    tokio::time::advance(Duration::from_secs(180)).await;
    let wake = attempt.wait().await;
    assert_eq!(wake, ShutdownWake::TimedOut);
    assert!(coordinator.respond(attempt.id(), false));
    assert_eq!(
        coordinator.finish(&attempt, wake, ShutdownActivity::default()),
        ShutdownDecision::Cancel
    );
}

#[tokio::test(start_paused = true)]
async fn permission_before_and_at_deadline_is_accepted_but_later_permission_is_ignored() {
    for milliseconds in [179_999, 180_000, 180_001] {
        let coordinator = ShutdownCoordinator::default();
        let attempt = coordinator.begin().unwrap();
        tokio::time::advance(Duration::from_millis(milliseconds)).await;
        assert_eq!(
            coordinator.respond(attempt.id(), true),
            milliseconds <= 180_000
        );
        let wake = attempt.wait().await;
        assert_eq!(
            wake,
            if milliseconds <= 180_000 {
                ShutdownWake::Allowed
            } else {
                ShutdownWake::TimedOut
            }
        );
        assert_eq!(
            coordinator.finish(&attempt, wake, ShutdownActivity::default()),
            ShutdownDecision::Exit
        );
    }
}
