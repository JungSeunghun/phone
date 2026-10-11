use async_trait::async_trait;
use phone_mirror_desktop::{
    connection_diagnostics::*,
    domain::{ConnectionTransport, PhonePlatform},
    infrastructure::{AdbCommandExecutor, CommandResult, ProcessConnectionDiagnosticPort},
};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tokio_util::sync::CancellationToken;
struct Executor {
    calls: Mutex<Vec<Vec<String>>>,
    output: String,
    success: bool,
}
#[async_trait]
impl AdbCommandExecutor for Executor {
    fn executable(&self) -> Result<PathBuf, String> {
        Ok("mock-adb".into())
    }
    async fn execute(
        &self,
        args: Vec<String>,
        input: Option<String>,
        _: CancellationToken,
    ) -> Result<CommandResult, String> {
        assert!(input.is_none());
        self.calls.lock().unwrap().push(args);
        Ok(CommandResult {
            success: self.success,
            output: self.output.clone(),
        })
    }
}
#[tokio::test]
async fn raw_offline_wireless_devices_are_not_hidden_by_normal_discovery_and_no_mutation_is_used() {
    let executor = Arc::new(Executor {
        calls: Mutex::new(vec![]),
        output: "1.2.3.4:5555 offline\nother device\n".into(),
        success: true,
    });
    let port = ProcessConnectionDiagnosticPort::new(
        executor.clone(),
        PathBuf::from("missing"),
        Default::default(),
        Default::default(),
    );
    let request = DiagnosticRequest {
        platform: PhonePlatform::Android,
        transport: ConnectionTransport::Wifi,
        identifier: Some("1.2.3.4:5555".into()),
        address: None,
    };
    assert_eq!(
        port.inspect(
            DiagnosticProbe::AndroidDevice,
            &request,
            CancellationToken::new()
        )
        .await,
        ProbeObservation::Offline
    );
    assert_eq!(
        executor.calls.lock().unwrap().as_slice(),
        [vec!["devices".to_string(), "-l".to_string()]]
    );
    assert_eq!(
        port.inspect(
            DiagnosticProbe::VideoServer,
            &request,
            CancellationToken::new()
        )
        .await,
        ProbeObservation::Missing
    );
}
#[tokio::test]
async fn failed_commands_are_not_mistaken_for_success_or_exposed() {
    let executor = Arc::new(Executor {
        calls: Mutex::new(vec![]),
        output: "private-secret device".into(),
        success: false,
    });
    let port = ProcessConnectionDiagnosticPort::new(
        executor,
        PathBuf::from("missing"),
        Default::default(),
        Default::default(),
    );
    let request = DiagnosticRequest {
        platform: PhonePlatform::Android,
        transport: ConnectionTransport::Usb,
        identifier: None,
        address: None,
    };
    assert_eq!(
        port.inspect(DiagnosticProbe::Adb, &request, CancellationToken::new())
            .await,
        ProbeObservation::Unavailable
    );
    assert_eq!(
        port.inspect(
            DiagnosticProbe::AndroidDevice,
            &request,
            CancellationToken::new()
        )
        .await,
        ProbeObservation::Unavailable
    );
}
#[tokio::test]
async fn short_loopback_probe_distinguishes_open_and_closed_ports() {
    let executor = Arc::new(Executor {
        calls: Mutex::new(vec![]),
        output: String::new(),
        success: true,
    });
    let port = ProcessConnectionDiagnosticPort::new(
        executor,
        PathBuf::from("missing"),
        Default::default(),
        Default::default(),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap().to_string();
    let request = DiagnosticRequest {
        platform: PhonePlatform::Android,
        transport: ConnectionTransport::Wifi,
        identifier: None,
        address: Some(address),
    };
    assert_eq!(
        port.inspect(
            DiagnosticProbe::ConnectionPort,
            &request,
            CancellationToken::new()
        )
        .await,
        ProbeObservation::Passed
    );
    drop(listener);
    assert_eq!(
        port.inspect(
            DiagnosticProbe::ConnectionPort,
            &request,
            CancellationToken::new()
        )
        .await,
        ProbeObservation::Unreachable
    );
}
