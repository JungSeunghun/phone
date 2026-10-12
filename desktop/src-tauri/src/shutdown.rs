//! Per-request shutdown coordination, independent of Tauri and device/media APIs.
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{sync::Notify, time::Instant};

const MEDIA_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(180);
#[derive(Default)]
pub struct ShutdownActivity {
    pub media_operations: usize,
    pub pending_recordings: bool,
    pub recording_jobs: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShutdownWake {
    Allowed,
    Denied,
    TimedOut,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ShutdownDecision {
    Exit,
    Cancel,
    Stale,
}
#[derive(Clone)]
pub struct ShutdownAttempt {
    id: String,
    deadline: Instant,
    response: Arc<Mutex<Option<bool>>>,
    notification: Arc<Notify>,
}
impl ShutdownAttempt {
    pub fn id(&self) -> &str {
        &self.id
    }
    pub async fn wait(&self) -> ShutdownWake {
        let response = async {
            loop {
                if let Some(allow) = *self.response.lock().unwrap() {
                    return if allow {
                        ShutdownWake::Allowed
                    } else {
                        ShutdownWake::Denied
                    };
                }
                self.notification.notified().await;
            }
        };
        tokio::select! {
            biased;
            wake = response => wake,
            _ = tokio::time::sleep_until(self.deadline) => ShutdownWake::TimedOut,
        }
    }
}
struct ActiveShutdown {
    attempt: ShutdownAttempt,
    committing: bool,
}
#[derive(Default)]
pub struct ShutdownCoordinator {
    active: Mutex<Option<ActiveShutdown>>,
}
impl ShutdownCoordinator {
    pub fn begin(&self) -> Option<ShutdownAttempt> {
        let mut active = self.active.lock().unwrap();
        if active.is_some() {
            return None;
        }
        let attempt = ShutdownAttempt {
            id: uuid::Uuid::new_v4().to_string(),
            deadline: Instant::now() + MEDIA_SHUTDOWN_TIMEOUT,
            response: Arc::new(Mutex::new(None)),
            notification: Arc::new(Notify::new()),
        };
        *active = Some(ActiveShutdown {
            attempt: attempt.clone(),
            committing: false,
        });
        Some(attempt)
    }
    pub fn respond(&self, id: &str, allow_exit: bool) -> bool {
        let active = self.active.lock().unwrap();
        let Some(current) = active
            .as_ref()
            .filter(|current| current.attempt.id == id && !current.committing)
        else {
            return false;
        };
        if Instant::now() > current.attempt.deadline {
            return false;
        }
        let mut response = current.attempt.response.lock().unwrap();
        if response.is_some() {
            return false;
        }
        *response = Some(allow_exit);
        current.attempt.notification.notify_one();
        true
    }
    /// Call with the application's activity lock held so no media operation can
    /// begin between checking activity and reserving the final exit.
    pub fn finish(
        &self,
        attempt: &ShutdownAttempt,
        wake: ShutdownWake,
        activity: ShutdownActivity,
    ) -> ShutdownDecision {
        let mut active = self.active.lock().unwrap();
        let Some(current) = active
            .as_mut()
            .filter(|current| current.attempt.id == attempt.id && !current.committing)
        else {
            return ShutdownDecision::Stale;
        };
        // A response accepted exactly at the deadline may arrive after the
        // timer wakes but before this final reservation acquires the lock.
        let denied = *current.attempt.response.lock().unwrap() == Some(false);
        if wake == ShutdownWake::Denied
            || denied
            || activity.media_operations > 0
            || activity.pending_recordings
            || activity.recording_jobs
        {
            *active = None;
            ShutdownDecision::Cancel
        } else {
            current.committing = true;
            ShutdownDecision::Exit
        }
    }
    pub fn is_committing(&self) -> bool {
        self.active
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|current| current.committing)
    }
}
