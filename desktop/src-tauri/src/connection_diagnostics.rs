//! Read-only diagnosis policy. Hardware, process execution and media APIs are injected.
use crate::domain::{valid_identity, ConnectionTransport, PhonePlatform, WirelessEndpoint};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticRequest {
    pub platform: PhonePlatform,
    pub transport: ConnectionTransport,
    pub identifier: Option<String>,
    pub address: Option<String>,
}
impl DiagnosticRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.identifier.as_ref().is_some_and(|s| !valid_identity(s)) {
            return Err("잘못된 진단 기기 식별자입니다.".into());
        }
        if let Some(address) = &self.address {
            if self.platform != PhonePlatform::Android
                || self.transport != ConnectionTransport::Wifi
                || address.trim() != address
                || WirelessEndpoint::parse(address).is_err()
            {
                return Err("Android Wi-Fi 연결 IP 주소와 1~65535 포트를 확인하세요.".into());
            }
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiagnosticHost {
    Macos,
    Windows,
    Other,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DiagnosticProbe {
    Adb,
    AndroidDevice,
    VideoServer,
    WirelessDiscovery,
    ConnectionPort,
    NativeIosDevices,
    AppleUsbDevices,
    IosUsbReceiver,
    IosWifiReceiver,
    LocalNetwork,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ProbeObservation {
    Passed,
    Missing,
    Unauthorized,
    Offline,
    Waiting,
    Unavailable,
    Unreachable,
    MultipleDevices,
    TimedOut,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DiagnosticStatus {
    Passed,
    Warning,
    Failed,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticCheck {
    pub code: &'static str,
    pub title: &'static str,
    pub status: DiagnosticStatus,
    pub message: &'static str,
    pub action: &'static str,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticReport {
    pub checks: Vec<DiagnosticCheck>,
    pub elapsed_milliseconds: u64,
}
#[async_trait]
pub trait ConnectionDiagnosticPort: Send + Sync {
    async fn inspect(
        &self,
        probe: DiagnosticProbe,
        request: &DiagnosticRequest,
        cancellation: CancellationToken,
    ) -> ProbeObservation;
}
#[async_trait]
pub trait DiagnosticTimer: Send + Sync {
    fn now_milliseconds(&self) -> u64;
    async fn wait(&self, duration: Duration);
}
pub struct MonotonicDiagnosticTimer {
    origin: tokio::time::Instant,
}
impl Default for MonotonicDiagnosticTimer {
    fn default() -> Self {
        Self {
            origin: tokio::time::Instant::now(),
        }
    }
}
#[async_trait]
impl DiagnosticTimer for MonotonicDiagnosticTimer {
    fn now_milliseconds(&self) -> u64 {
        self.origin.elapsed().as_millis().min(u64::MAX as u128) as u64
    }
    async fn wait(&self, duration: Duration) {
        tokio::time::sleep(duration).await;
    }
}
pub struct ConnectionDiagnosticsService {
    port: Arc<dyn ConnectionDiagnosticPort>,
    host: DiagnosticHost,
    timeout: Duration,
    timer: Arc<dyn DiagnosticTimer>,
    active: Mutex<Option<(String, CancellationToken)>>,
}
impl ConnectionDiagnosticsService {
    pub fn new(port: Arc<dyn ConnectionDiagnosticPort>, host: DiagnosticHost) -> Self {
        Self::with_probe_timeout(port, host, Duration::from_secs(2)).unwrap()
    }
    pub fn with_probe_timeout(
        port: Arc<dyn ConnectionDiagnosticPort>,
        host: DiagnosticHost,
        timeout: Duration,
    ) -> Result<Self, String> {
        Self::with_timer(
            port,
            host,
            timeout,
            Arc::new(MonotonicDiagnosticTimer::default()),
        )
    }
    pub fn with_timer(
        port: Arc<dyn ConnectionDiagnosticPort>,
        host: DiagnosticHost,
        timeout: Duration,
        timer: Arc<dyn DiagnosticTimer>,
    ) -> Result<Self, String> {
        if timeout.is_zero() || timeout > Duration::from_secs(3) {
            return Err("잘못된 진단 제한 시간입니다.".into());
        }
        Ok(Self {
            port,
            host,
            timeout,
            timer,
            active: Mutex::new(None),
        })
    }
    pub async fn cancel_all(&self) {
        if let Some((_, token)) = &*self.active.lock().await {
            token.cancel();
        }
    }
    pub async fn cancel(&self, id: &str) -> Result<(), String> {
        if !valid_identity(id) {
            return Err("잘못된 진단 식별자입니다.".into());
        }
        if let Some((active, token)) = &*self.active.lock().await {
            if active == id {
                token.cancel();
            }
        }
        Ok(())
    }
    pub async fn run(
        &self,
        id: &str,
        request: DiagnosticRequest,
    ) -> Result<DiagnosticReport, String> {
        request.validate()?;
        if !valid_identity(id) {
            return Err("잘못된 진단 식별자입니다.".into());
        }
        let token = CancellationToken::new();
        {
            let mut active = self.active.lock().await;
            if active.is_some() {
                return Err("연결 진단이 이미 실행 중입니다.".into());
            }
            *active = Some((id.into(), token.clone()));
        }
        let start = self.timer.now_milliseconds();
        let operation = async {
            let mut probes = match (request.platform, request.transport, self.host) {
                (PhonePlatform::Android, ConnectionTransport::Usb, _) => vec![
                    DiagnosticProbe::Adb,
                    DiagnosticProbe::AndroidDevice,
                    DiagnosticProbe::VideoServer,
                ],
                (PhonePlatform::Android, ConnectionTransport::Wifi, _) => vec![
                    DiagnosticProbe::Adb,
                    DiagnosticProbe::AndroidDevice,
                    DiagnosticProbe::VideoServer,
                    DiagnosticProbe::WirelessDiscovery,
                ],
                (PhonePlatform::Ios, ConnectionTransport::Usb, DiagnosticHost::Macos) => {
                    vec![DiagnosticProbe::NativeIosDevices]
                }
                (PhonePlatform::Ios, ConnectionTransport::Usb, DiagnosticHost::Windows) => vec![
                    DiagnosticProbe::AppleUsbDevices,
                    DiagnosticProbe::IosUsbReceiver,
                ],
                (PhonePlatform::Ios, ConnectionTransport::Wifi, _) => vec![
                    DiagnosticProbe::LocalNetwork,
                    DiagnosticProbe::IosWifiReceiver,
                ],
                _ => vec![DiagnosticProbe::NativeIosDevices],
            };
            if request.address.is_some() {
                probes.push(DiagnosticProbe::ConnectionPort);
            }
            let mut checks = Vec::new();
            for probe in probes {
                let child = token.child_token();
                let observation = tokio::select! {
                    biased;
                    observation = self.port.inspect(probe, &request, child.clone()) => observation,
                    _ = self.timer.wait(self.timeout) => { child.cancel(); ProbeObservation::TimedOut },
                };
                checks.push(explain(probe, observation));
            }
            Ok(DiagnosticReport {
                checks,
                elapsed_milliseconds: self.timer.now_milliseconds().saturating_sub(start),
            })
        };
        let result = tokio::select! {biased;_=token.cancelled()=>Err("연결 진단을 취소했습니다.".into()),result=operation=>result};
        self.active.lock().await.take();
        result
    }
}
fn explain(probe: DiagnosticProbe, observation: ProbeObservation) -> DiagnosticCheck {
    let (code,title,action)=match probe {
  DiagnosticProbe::Adb=>("adb","Android 연결 도구","Android Platform Tools를 설치하고 ADB 경로를 확인하세요."),
  DiagnosticProbe::AndroidDevice=>("android-device","Android 기기 상태","USB 디버깅 허용을 승인하세요. 오프라인이면 케이블 또는 무선 디버깅 상태를 확인하세요."),
  DiagnosticProbe::VideoServer=>("video-server","Android 화면 전송 모듈","앱을 다시 설치하거나 실행해 화면 전송 모듈을 준비하세요."),
  DiagnosticProbe::WirelessDiscovery=>("wireless-discovery","Android 무선 기기 검색","같은 Wi-Fi에서 무선 디버깅을 켜세요. 검색이 차단되면 연결 주소를 직접 입력하세요."),
  DiagnosticProbe::ConnectionPort=>("connection-port","Android 연결 포트 접근","폰에 표시된 최신 연결 IP와 포트를 확인하세요. 페어링 포트와 연결 포트는 다릅니다. VPN·방화벽·게스트 Wi-Fi 격리도 확인하세요."),
  DiagnosticProbe::NativeIosDevices=>("ios-native-usb","Mac iPhone USB 검색","iPhone 잠금을 해제하고 컴퓨터 신뢰와 macOS 카메라 권한, 데이터 케이블을 확인하세요."),
  DiagnosticProbe::AppleUsbDevices=>("apple-usb-devices","Windows Apple 기기 서비스","Apple Devices 기기 드라이버를 확인하고 USB iPhone 한 대만 연결해 컴퓨터 신뢰를 승인하세요."),
  DiagnosticProbe::IosUsbReceiver=>("ios-usb-receiver","iPhone USB 송출 수신","USB 수신을 시작하고 최신 QR 코드를 송출 앱에 저장한 뒤 화면 방송을 시작하세요."),
  DiagnosticProbe::IosWifiReceiver=>("ios-wifi-receiver","iPhone Wi-Fi 송출 수신","Wi-Fi 수신을 시작하고 같은 네트워크에서 최신 QR을 송출 앱에 저장해 화면 방송을 시작하세요. 로컬 네트워크 권한과 방화벽을 확인하세요."),
  DiagnosticProbe::LocalNetwork=>("local-network","컴퓨터 네트워크 주소","컴퓨터와 iPhone을 같은 Wi-Fi에 연결하고 VPN·게스트 Wi-Fi 격리 여부를 확인하세요."),
 };
    let (status, message) = match observation {
        ProbeObservation::Passed => (
            DiagnosticStatus::Passed,
            if probe == DiagnosticProbe::ConnectionPort {
                "TCP 포트에 접근했습니다. 페어링·화면 수신 성공을 뜻하지는 않습니다."
            } else {
                "이 점검을 통과했습니다. 전체 화면 연결 성공을 뜻하지는 않습니다."
            },
        ),
        ProbeObservation::Unauthorized => (
            DiagnosticStatus::Failed,
            "폰 또는 운영체제의 승인이 필요합니다.",
        ),
        ProbeObservation::Offline => (DiagnosticStatus::Failed, "선택한 기기가 오프라인입니다."),
        ProbeObservation::Unreachable => (
            DiagnosticStatus::Failed,
            "연결 포트에 접근할 수 없습니다. 원인은 아직 확정할 수 없습니다.",
        ),
        ProbeObservation::MultipleDevices => (
            DiagnosticStatus::Warning,
            "여러 USB iPhone이 검색됐습니다. 한 대만 연결하세요.",
        ),
        ProbeObservation::Waiting => (
            DiagnosticStatus::Warning,
            "수신기는 준비됐지만 인증된 iPhone 방송이 아직 없습니다.",
        ),
        ProbeObservation::Unavailable => (
            DiagnosticStatus::Warning,
            "점검 결과를 가져올 수 없습니다. 원인을 확정하지 않았습니다.",
        ),
        ProbeObservation::TimedOut => (
            DiagnosticStatus::Warning,
            "점검 응답 시간이 초과됐습니다. 다른 점검 결과를 확인하세요.",
        ),
        ProbeObservation::Missing => (
            if matches!(probe, DiagnosticProbe::Adb | DiagnosticProbe::VideoServer) {
                DiagnosticStatus::Failed
            } else {
                DiagnosticStatus::Warning
            },
            match probe {
                DiagnosticProbe::Adb => "ADB 실행 파일을 찾을 수 없습니다.",
                DiagnosticProbe::VideoServer => "Android 화면 전송 모듈이 없거나 비어 있습니다.",
                DiagnosticProbe::AndroidDevice => "선택한 연결 방식의 Android 기기가 검색되지 않습니다.",
                DiagnosticProbe::WirelessDiscovery => "무선 디버깅 서비스가 검색되지 않습니다. 이미 연결된 기기는 계속 사용할 수 있습니다.",
                DiagnosticProbe::NativeIosDevices => "선택한 iPhone USB 캡처 기기가 검색되지 않습니다.",
                DiagnosticProbe::AppleUsbDevices => "Apple 기기 서비스에서 해당 USB iPhone이 검색되지 않습니다.",
                DiagnosticProbe::IosUsbReceiver | DiagnosticProbe::IosWifiReceiver => "iPhone 수신기가 실행 중이지 않습니다.",
                DiagnosticProbe::LocalNetwork => "컴퓨터에서 루프백 외의 네트워크 주소를 찾지 못했습니다.",
                DiagnosticProbe::ConnectionPort => "연결 주소를 확인할 수 없습니다.",
            },
        ),
    };
    DiagnosticCheck {
        code,
        title,
        status,
        message,
        action: if status == DiagnosticStatus::Passed {
            ""
        } else {
            action
        },
    }
}
