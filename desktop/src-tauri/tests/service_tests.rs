use async_trait::async_trait;
use phone_mirror_desktop::domain::{ConnectionTransport, WirelessBookmark};
use phone_mirror_desktop::infrastructure::{
    AdbCommandExecutor, AdbDeviceDiscovery, AdbWirelessConnectionService, BookmarkStore,
    CommandResult, MemoryBookmarkStore,
};
use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
struct FakeExecutor {
    responses: Mutex<VecDeque<CommandResult>>,
    commands: Mutex<Vec<(Vec<String>, Option<String>)>>,
}
impl FakeExecutor {
    fn enqueue(&self, outputs: &[&str]) {
        self.responses
            .lock()
            .unwrap()
            .extend(outputs.iter().map(|output| CommandResult {
                success: true,
                output: output.to_string(),
            }));
    }
}
#[async_trait]
impl AdbCommandExecutor for FakeExecutor {
    async fn execute(
        &self,
        arguments: Vec<String>,
        input: Option<String>,
        _: CancellationToken,
    ) -> Result<CommandResult, String> {
        self.commands.lock().unwrap().push((arguments, input));
        Ok(self
            .responses
            .lock()
            .unwrap()
            .pop_front()
            .unwrap_or(CommandResult {
                success: true,
                output: String::new(),
            }))
    }
}
#[tokio::test]
async fn pairing_uses_stdin_and_never_includes_the_secret_in_errors_or_arguments() {
    let executor = Arc::new(FakeExecutor::default());
    let service = AdbWirelessConnectionService::new(executor.clone());
    executor.enqueue(&["Successfully paired to 1.2.3.4:1"]);
    service
        .pair("1.2.3.4:1", "000000", CancellationToken::new())
        .await
        .unwrap();
    {
        let calls = executor.commands.lock().unwrap();
        assert_eq!(calls[0].0, ["pair", "1.2.3.4:1"]);
        assert_eq!(calls[0].1.as_deref(), Some("000000\n"));
    }
    executor.enqueue(&["Failed pairing code 123456"]);
    let error = service
        .pair("1.2.3.4:1", "123456", CancellationToken::new())
        .await
        .unwrap_err();
    assert!(!error.contains("123456"));
    let count = executor.commands.lock().unwrap().len();
    assert!(service
        .pair("1.2.3.4:0", "123456", CancellationToken::new())
        .await
        .is_err());
    assert_eq!(executor.commands.lock().unwrap().len(), count);
}
#[tokio::test]
async fn stable_serial_keeps_usb_wifi_separate_and_mdns_loss_does_not_change_endpoint() {
    let executor = Arc::new(FakeExecutor::default());
    let store = Arc::new(MemoryBookmarkStore::default());
    let discovery = AdbDeviceDiscovery::new(executor.clone(), store.clone());
    for service in [
        "adb-A-guid (2) _adb-tls-connect._tcp 1.2.3.4:2",
        "",
        "adb-A-guid (2) _adb-tls-connect._tcp 1.2.3.5:65535",
    ] {
        executor.enqueue(&[
            "A device usb:1 model:Galaxy\nadb-A-guid (2)._adb-tls-connect._tcp device model:Galaxy",
            service,
            "A",
            "",
        ]);
    }
    let first = discovery.discover(CancellationToken::new()).await.unwrap();
    let second = discovery.discover(CancellationToken::new()).await.unwrap();
    let changed = discovery.discover(CancellationToken::new()).await.unwrap();
    assert_eq!(first.len(), 2);
    assert_eq!(first[0].endpoint.transport, ConnectionTransport::Usb);
    assert_eq!(first[1].id, "wifi:A");
    assert_eq!(first[1].endpoint, second[1].endpoint);
    assert_eq!(changed[1].endpoint.address, "1.2.3.5:65535");
    let saved = serde_json::to_string(&store.load().unwrap()).unwrap();
    assert!(!saved.contains("1.2.3.4"));
    assert!(!saved.contains("65535"));
}
#[tokio::test]
async fn bookmark_resolves_a_new_service_address_and_verifies_serial_before_using_it() {
    let executor = Arc::new(FakeExecutor::default());
    let store = Arc::new(MemoryBookmarkStore::default());
    store
        .save(&[WirelessBookmark {
            identity: "A".into(),
            name: "Galaxy".into(),
            service_name: "adb-A-old".into(),
        }])
        .unwrap();
    executor.enqueue(&[
        "",
        "adb-A-new _adb-tls-connect._tcp 1.2.3.9:65535",
        "connected to 1.2.3.9:65535",
        "1.2.3.9:65535 device model:Galaxy",
        "A",
        "",
    ]);
    let devices = AdbDeviceDiscovery::new(executor.clone(), store)
        .discover(CancellationToken::new())
        .await
        .unwrap();
    assert_eq!(devices[0].identity, "A");
    assert_eq!(devices[0].endpoint.address, "1.2.3.9:65535");
    assert!(executor
        .commands
        .lock()
        .unwrap()
        .iter()
        .any(|c| c.0 == ["connect", "1.2.3.9:65535"]));
}
#[tokio::test]
async fn a_reused_address_cannot_impersonate_the_bookmarked_phone() {
    let executor = Arc::new(FakeExecutor::default());
    let store = Arc::new(MemoryBookmarkStore::default());
    store
        .save(&[WirelessBookmark {
            identity: "A".into(),
            name: "Galaxy".into(),
            service_name: "adb-A-guid".into(),
        }])
        .unwrap();
    executor.enqueue(&[
        "1.2.3.4:1 device",
        "adb-A-guid _adb-tls-connect._tcp 1.2.3.4:1",
        "B",
        "A-guid",
    ]);
    let devices = AdbDeviceDiscovery::new(executor, store.clone())
        .discover(CancellationToken::new())
        .await
        .unwrap();
    assert!(devices.is_empty());
    assert_eq!(store.load().unwrap()[0].identity, "A");
}

#[test]
fn stream_encoder_bounds_reference_recovery_for_all_frame_rates() {
    use phone_mirror_desktop::{
        domain::MirrorSettings, infrastructure::server_arguments_with_audio,
    };
    for rate in [15, 30, 60] {
        let settings = MirrorSettings {
            video_max_frame_rate: rate,
            ..MirrorSettings::default()
        };
        let arguments =
            server_arguments_with_audio("device", "/server", "12345678", &settings, true);
        assert!(arguments
            .iter()
            .any(|value| value == "video_codec_options=i-frame-interval=1"));
        assert!(arguments
            .iter()
            .any(|value| value == &format!("max_fps={rate}")));
        assert!(arguments
            .iter()
            .any(|value| value == "video_bit_rate=8000000"));
    }
}
