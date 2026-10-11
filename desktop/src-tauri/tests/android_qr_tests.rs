use phone_mirror_desktop::android_qr::*;
use phone_mirror_desktop::domain::{WirelessService, WirelessServiceKind};
use std::{
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
#[derive(Default)]
struct Clock(AtomicU64);
#[async_trait::async_trait]
impl AndroidQrPairingClock for Clock {
    fn now(&self) -> Duration {
        Duration::from_secs(self.0.load(Ordering::SeqCst))
    }
    async fn wait(&self) {
        self.0.fetch_add(1, Ordering::SeqCst);
        tokio::task::yield_now().await;
    }
}
struct Port {
    name: Mutex<String>,
    calls: Mutex<Vec<String>>,
    stall: bool,
}
#[async_trait::async_trait]
impl AndroidQrPairingPort for Port {
    async fn discover(&self) -> Result<Vec<WirelessService>, String> {
        if self.stall {
            std::future::pending().await
        } else {
            Ok(vec![
                WirelessService {
                    name: self.name.lock().unwrap().clone(),
                    kind: WirelessServiceKind::Pairing,
                    address: "192.168.0.44:1".into(),
                },
                WirelessService {
                    name: "adb-matched".into(),
                    kind: WirelessServiceKind::Connection,
                    address: "192.168.0.44:65535".into(),
                },
                WirelessService {
                    name: "adb-other".into(),
                    kind: WirelessServiceKind::Connection,
                    address: "192.168.0.55:1234".into(),
                },
            ])
        }
    }
    async fn pair(&self, address: &str, password: &str) -> Result<String, String> {
        assert_eq!(password.len(), 32);
        self.calls.lock().unwrap().push(format!("pair:{address}"));
        Ok("adb-matched".into())
    }
    async fn connect(&self, address: &str) -> Result<(), String> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("connect:{address}"));
        Ok(())
    }
}
#[tokio::test]
async fn matches_only_scanned_service_then_authenticated_guid_and_rotates_credentials() {
    let port = Arc::new(Port {
        name: Mutex::new("unrelated".into()),
        calls: Mutex::new(vec![]),
        stall: false,
    });
    let clock = Arc::new(Clock::default());
    let service = AndroidQrPairingService::new(port.clone(), clock.clone());
    let first = service.start().await.unwrap();
    assert!(first.payload.starts_with("WIFI:T:ADB;S:studio-"));
    assert!(first.payload.ends_with(";;"));
    assert_eq!(first.expires_in_seconds, 120);
    assert!(service.start().await.is_err());
    assert!(service.cancel("wrong").await.is_err());
    let name = first
        .payload
        .split("S:")
        .nth(1)
        .unwrap()
        .split(';')
        .next()
        .unwrap();
    *port.name.lock().unwrap() = name.into();
    let result = service.wait(&first.session_id).await.unwrap();
    assert_eq!(result.address, "192.168.0.44:65535");
    assert_eq!(
        *port.calls.lock().unwrap(),
        vec!["pair:192.168.0.44:1", "connect:192.168.0.44:65535"]
    );
    assert!(service.wait(&first.session_id).await.is_err());
    let second = service.start().await.unwrap();
    assert_ne!(first.payload, second.payload);
    service.cancel(&second.session_id).await.unwrap();
    service.cancel(&second.session_id).await.unwrap();
}
#[tokio::test]
async fn expires_exactly_at_boundary_without_pairing_unrelated_services() {
    let port = Arc::new(Port {
        name: Mutex::new("other".into()),
        calls: Mutex::new(vec![]),
        stall: false,
    });
    let clock = Arc::new(Clock::default());
    let service = AndroidQrPairingService::new(port.clone(), clock.clone());
    let info = service.start().await.unwrap();
    clock.0.store(120, Ordering::SeqCst);
    assert!(service.wait(&info.session_id).await.is_err());
    assert!(port.calls.lock().unwrap().is_empty());
    assert!(service.start().await.is_ok());
    service.cancel_all().await;
}
#[tokio::test]
async fn cancellation_interrupts_stalled_discovery_and_rejects_duplicate_waits() {
    let port = Arc::new(Port {
        name: Mutex::new("other".into()),
        calls: Mutex::new(vec![]),
        stall: true,
    });
    let service = Arc::new(AndroidQrPairingService::new(
        port.clone(),
        Arc::new(Clock::default()),
    ));
    let info = service.start().await.unwrap();
    let worker = service.clone();
    let id = info.session_id.clone();
    let task = tokio::spawn(async move { worker.wait(&id).await });
    tokio::task::yield_now().await;
    assert!(service.wait(&info.session_id).await.is_err());
    service.cancel(&info.session_id).await.unwrap();
    assert!(tokio::time::timeout(Duration::from_secs(1), task)
        .await
        .unwrap()
        .unwrap()
        .is_err());
    assert!(port.calls.lock().unwrap().is_empty());
}
#[tokio::test]
async fn deadline_cleans_up_a_stalled_operation_and_allows_a_fresh_qr() {
    let port = Arc::new(Port {
        name: Mutex::new("other".into()),
        calls: Mutex::new(vec![]),
        stall: true,
    });
    let clock = Arc::new(Clock::default());
    let service = AndroidQrPairingService::new(port, clock.clone());
    let info = service.start().await.unwrap();
    clock.0.store(119, Ordering::SeqCst);
    assert!(service.wait(&info.session_id).await.is_err());
    // Cancellation must find no old session even if native timeout fired before injected time advanced.
    assert!(service.cancel("already-ended").await.is_ok());
    assert!(service.start().await.is_ok());
    service.cancel_all().await;
}
#[tokio::test]
async fn adb_adapter_accepts_qr_password_only_through_stdin_and_sanitizes_failures() {
    use phone_mirror_desktop::infrastructure::{AdbCommandExecutor, CommandResult};
    struct Executor {
        output: Mutex<String>,
        calls: Mutex<Vec<(Vec<String>, Option<String>)>>,
    }
    #[async_trait::async_trait]
    impl AdbCommandExecutor for Executor {
        async fn execute(
            &self,
            args: Vec<String>,
            input: Option<String>,
            _: tokio_util::sync::CancellationToken,
        ) -> Result<CommandResult, String> {
            self.calls.lock().unwrap().push((args, input));
            Ok(CommandResult {
                success: true,
                output: self.output.lock().unwrap().clone(),
            })
        }
    }
    let executor = Arc::new(Executor {
        output: Mutex::new(
            "Enter pairing code: Successfully paired to 1.2.3.4:1 [guid=adb-phone]".into(),
        ),
        calls: Mutex::new(vec![]),
    });
    let port = AdbAndroidQrPairingPort::new(executor.clone());
    let password = "ab".repeat(16);
    assert_eq!(
        port.pair("1.2.3.4:1", &password).await.unwrap(),
        "adb-phone"
    );
    assert_eq!(
        executor.calls.lock().unwrap()[0],
        (
            vec!["pair".into(), "1.2.3.4:1".into()],
            Some(format!("{password}\n"))
        )
    );
    for invalid in ["", "123456", "semicolon;", &"x".repeat(32)] {
        assert!(port.pair("1.2.3.4:1", invalid).await.is_err());
    }
    assert!(port.pair("1.2.3.4:0", &password).await.is_err());
    assert_eq!(executor.calls.lock().unwrap().len(), 1);
    for output in [
        format!("Failed: Successfully paired secret {password}"),
        "Successfully paired to 1.2.3.4:1 [guid=adb-bad;value]".into(),
        "Successfully paired to 1.2.3.4:1".into(),
    ] {
        *executor.output.lock().unwrap() = output;
        let error = port.pair("1.2.3.4:1", &password).await.unwrap_err();
        assert!(!error.contains(&password));
    }
}
