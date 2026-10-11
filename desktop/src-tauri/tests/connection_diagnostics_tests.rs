use async_trait::async_trait;
use phone_mirror_desktop::{
    connection_diagnostics::*,
    domain::{ConnectionTransport, PhonePlatform},
};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio_util::sync::CancellationToken;
struct FakePort {
    calls: Mutex<Vec<DiagnosticProbe>>,
    observation: ProbeObservation,
    delayed: bool,
}
#[async_trait]
impl ConnectionDiagnosticPort for FakePort {
    async fn inspect(
        &self,
        probe: DiagnosticProbe,
        _: &DiagnosticRequest,
        _: CancellationToken,
    ) -> ProbeObservation {
        self.calls.lock().unwrap().push(probe);
        if self.delayed {
            std::future::pending::<()>().await;
        }
        self.observation
    }
}
fn request(platform: PhonePlatform, transport: ConnectionTransport) -> DiagnosticRequest {
    DiagnosticRequest {
        platform,
        transport,
        identifier: None,
        address: None,
    }
}
fn port(observation: ProbeObservation, delayed: bool) -> Arc<FakePort> {
    Arc::new(FakePort {
        calls: Mutex::new(vec![]),
        observation,
        delayed,
    })
}
#[tokio::test]
async fn usb_and_wifi_have_targeted_read_only_checks_and_fixed_safe_guidance() {
    let p = port(ProbeObservation::Unauthorized, false);
    let service = ConnectionDiagnosticsService::new(p.clone(), DiagnosticHost::Macos);
    let report = service
        .run(
            "one",
            request(PhonePlatform::Android, ConnectionTransport::Usb),
        )
        .await
        .unwrap();
    assert!(report
        .checks
        .iter()
        .any(|c| c.status == DiagnosticStatus::Failed && c.action.contains("허용")));
    assert!(!p
        .calls
        .lock()
        .unwrap()
        .contains(&DiagnosticProbe::WirelessDiscovery));
    assert!(!serde_json::to_string(&report).unwrap().contains("one"));
    let p = port(ProbeObservation::Passed, false);
    let service = ConnectionDiagnosticsService::new(p.clone(), DiagnosticHost::Windows);
    let mut r = request(PhonePlatform::Android, ConnectionTransport::Wifi);
    r.address = Some("[::1]:65535".into());
    service.run("two", r).await.unwrap();
    assert!(p
        .calls
        .lock()
        .unwrap()
        .contains(&DiagnosticProbe::ConnectionPort));
}
#[tokio::test]
async fn input_boundaries_and_invalid_requests_never_reach_the_port() {
    for address in ["127.0.0.1:1", "127.0.0.1:65535", "[::1]:1"] {
        let mut r = request(PhonePlatform::Android, ConnectionTransport::Wifi);
        r.address = Some(address.into());
        assert!(r.validate().is_ok());
    }
    for address in [
        "1.2.3.4:0",
        "1.2.3.4:65536",
        "host:1",
        "PMW1|secret",
        "1.2.3.4:1\n",
    ] {
        let p = port(ProbeObservation::Passed, false);
        let s = ConnectionDiagnosticsService::new(p.clone(), DiagnosticHost::Macos);
        let mut r = request(PhonePlatform::Android, ConnectionTransport::Wifi);
        r.address = Some(address.into());
        assert!(s.run("one", r).await.is_err());
        assert!(p.calls.lock().unwrap().is_empty());
    }
    assert!(serde_json::from_str::<DiagnosticRequest>(
        r#"{"platform":"android","transport":"usb","code":"secret"}"#
    )
    .is_err());
    let mut r = request(PhonePlatform::Ios, ConnectionTransport::Wifi);
    r.address = Some("1.2.3.4:1".into());
    assert!(r.validate().is_err());
}
#[tokio::test]
async fn timeout_cancellation_repeated_actions_and_late_results_are_bounded() {
    let p = port(ProbeObservation::Passed, true);
    let s = Arc::new(
        ConnectionDiagnosticsService::with_probe_timeout(
            p,
            DiagnosticHost::Macos,
            Duration::from_millis(10),
        )
        .unwrap(),
    );
    let running = {
        let s = s.clone();
        tokio::spawn(async move {
            s.run(
                "one",
                request(PhonePlatform::Android, ConnectionTransport::Usb),
            )
            .await
        })
    };
    tokio::task::yield_now().await;
    assert!(s
        .run(
            "two",
            request(PhonePlatform::Ios, ConnectionTransport::Wifi)
        )
        .await
        .is_err());
    s.cancel("other").await.unwrap();
    let report = running.await.unwrap().unwrap();
    assert!(report
        .checks
        .iter()
        .all(|c| c.status == DiagnosticStatus::Warning));
    let running = {
        let s = s.clone();
        tokio::spawn(async move {
            s.run(
                "three",
                request(PhonePlatform::Ios, ConnectionTransport::Wifi),
            )
            .await
        })
    };
    tokio::task::yield_now().await;
    s.cancel("three").await.unwrap();
    assert!(running.await.unwrap().is_err());
    assert!(ConnectionDiagnosticsService::with_probe_timeout(
        port(ProbeObservation::Passed, false),
        DiagnosticHost::Macos,
        Duration::ZERO
    )
    .is_err());
    assert!(ConnectionDiagnosticsService::with_probe_timeout(
        port(ProbeObservation::Passed, false),
        DiagnosticHost::Macos,
        Duration::from_secs(4)
    )
    .is_err());
}
#[tokio::test]
async fn iphone_windows_usb_and_wifi_do_not_probe_android_or_sender_media_ports() {
    for (host, transport, expected) in [
        (
            DiagnosticHost::Windows,
            ConnectionTransport::Usb,
            DiagnosticProbe::AppleUsbDevices,
        ),
        (
            DiagnosticHost::Macos,
            ConnectionTransport::Usb,
            DiagnosticProbe::NativeIosDevices,
        ),
        (
            DiagnosticHost::Windows,
            ConnectionTransport::Wifi,
            DiagnosticProbe::IosWifiReceiver,
        ),
    ] {
        let p = port(ProbeObservation::Waiting, false);
        let s = ConnectionDiagnosticsService::new(p.clone(), host);
        let report = s
            .run("one", request(PhonePlatform::Ios, transport))
            .await
            .unwrap();
        assert!(!report.checks.is_empty());
        let calls = p.calls.lock().unwrap();
        assert!(calls.contains(&expected));
        assert!(!calls.contains(&DiagnosticProbe::Adb));
        assert!(!calls.contains(&DiagnosticProbe::ConnectionPort));
    }
}
#[tokio::test]
async fn receiver_state_reports_waiting_without_exposing_codes_or_starting_broadcast() {
    let receiver = phone_mirror_desktop::ios_receiver::IosMediaReceiverService::default();
    assert_eq!(
        receiver.diagnostic_observation().await,
        ProbeObservation::Missing
    );
    let info = receiver.start_on("127.0.0.1:0").await.unwrap();
    assert_eq!(
        receiver.diagnostic_observation().await,
        ProbeObservation::Waiting
    );
    receiver.stop(&info.receiver_id).await.unwrap();
    assert_eq!(
        receiver.diagnostic_observation().await,
        ProbeObservation::Missing
    );
}
#[tokio::test]
async fn application_shutdown_cancels_pending_diagnosis() {
    let service = Arc::new(ConnectionDiagnosticsService::new(
        port(ProbeObservation::Passed, true),
        DiagnosticHost::Windows,
    ));
    let running = {
        let service = service.clone();
        tokio::spawn(async move {
            service
                .run(
                    "shutdown",
                    request(PhonePlatform::Ios, ConnectionTransport::Usb),
                )
                .await
        })
    };
    tokio::task::yield_now().await;
    service.cancel_all().await;
    assert!(running.await.unwrap().is_err());
    service.cancel_all().await;
}
struct ImmediateTimer(std::sync::atomic::AtomicU64);
#[async_trait]
impl DiagnosticTimer for ImmediateTimer {
    fn now_milliseconds(&self) -> u64 {
        self.0.load(std::sync::atomic::Ordering::SeqCst)
    }
    async fn wait(&self, duration: Duration) {
        tokio::task::yield_now().await;
        self.0.fetch_add(
            duration.as_millis() as u64,
            std::sync::atomic::Ordering::SeqCst,
        );
    }
}
#[tokio::test]
async fn injected_time_bounds_slow_probes_without_waiting_for_real_deadlines() {
    let service = ConnectionDiagnosticsService::with_timer(
        port(ProbeObservation::Passed, true),
        DiagnosticHost::Macos,
        Duration::from_secs(2),
        Arc::new(ImmediateTimer(std::sync::atomic::AtomicU64::new(0))),
    )
    .unwrap();
    let report = service
        .run(
            "clock",
            request(PhonePlatform::Android, ConnectionTransport::Usb),
        )
        .await
        .unwrap();
    assert_eq!(report.elapsed_milliseconds, 6000);
    assert_eq!(report.checks.len(), 3);
    assert!(report
        .checks
        .iter()
        .all(|check| check.status == DiagnosticStatus::Warning));
}
