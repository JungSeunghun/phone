//! Ephemeral Android QR pairing policy; discovery, ADB execution and time are injected.
use crate::domain::{valid_identity, WirelessEndpoint, WirelessService, WirelessServiceKind};
use crate::infrastructure::{AdbCommandExecutor, AdbWirelessConnectionService};
use async_trait::async_trait;
use serde::Serialize;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidQrPairingInfo {
    pub session_id: String,
    pub payload: String,
    pub expires_in_seconds: u64,
}
#[derive(Serialize)]
pub struct AndroidQrPairingResult {
    pub address: String,
}
#[async_trait]
pub trait AndroidQrPairingPort: Send + Sync {
    async fn discover(&self) -> Result<Vec<WirelessService>, String>;
    async fn pair(&self, address: &str, password: &str) -> Result<String, String>;
    async fn connect(&self, address: &str) -> Result<(), String>;
}
#[async_trait]
pub trait AndroidQrPairingClock: Send + Sync {
    fn now(&self) -> Duration;
    async fn wait(&self);
}
pub struct MonotonicAndroidQrPairingClock(Instant);
impl Default for MonotonicAndroidQrPairingClock {
    fn default() -> Self {
        Self(Instant::now())
    }
}
#[async_trait]
impl AndroidQrPairingClock for MonotonicAndroidQrPairingClock {
    fn now(&self) -> Duration {
        self.0.elapsed()
    }
    async fn wait(&self) {
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}
pub struct AdbAndroidQrPairingPort {
    executor: Arc<dyn AdbCommandExecutor>,
    wireless: AdbWirelessConnectionService,
}
impl AdbAndroidQrPairingPort {
    pub fn new(executor: Arc<dyn AdbCommandExecutor>) -> Self {
        Self {
            wireless: AdbWirelessConnectionService::new(executor.clone()),
            executor,
        }
    }
}
#[async_trait]
impl AndroidQrPairingPort for AdbAndroidQrPairingPort {
    async fn discover(&self) -> Result<Vec<WirelessService>, String> {
        self.wireless.discover(CancellationToken::new()).await
    }
    async fn pair(&self, address: &str, password: &str) -> Result<String, String> {
        let endpoint = WirelessEndpoint::parse(address)?;
        if password.len() != 32 || !password.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("잘못된 QR 페어링 키입니다.".into());
        }
        let result = self
            .executor
            .execute(
                vec!["pair".into(), endpoint.address],
                Some(format!("{password}\n")),
                CancellationToken::new(),
            )
            .await
            .map_err(|_| "QR 페어링에 실패했습니다.")?;
        if !result.success {
            return Err("QR 페어링에 실패했습니다.".into());
        }
        let guid = result
            .output
            .lines()
            .find_map(|line| {
                let line = line
                    .trim()
                    .strip_prefix("Enter pairing code: ")
                    .unwrap_or(line.trim());
                if !line.starts_with("Successfully paired to ") {
                    return None;
                }
                line.rsplit_once(" [guid=")
                    .and_then(|(_, v)| v.strip_suffix(']'))
                    .filter(|v| {
                        v.starts_with("adb-")
                            && valid_identity(v)
                            && v.len() <= 128
                            && v.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
                    })
                    .map(str::to_owned)
            })
            .ok_or(
                "페어링 결과의 기기 식별자를 확인할 수 없습니다. 최신 Platform Tools를 사용하세요.",
            )?;
        Ok(guid)
    }
    async fn connect(&self, address: &str) -> Result<(), String> {
        self.wireless
            .connect(address, CancellationToken::new())
            .await
    }
}
struct PendingPairing {
    info: AndroidQrPairingInfo,
    name: String,
    password: String,
    expires: Duration,
    cancel: CancellationToken,
    claimed: bool,
}
pub struct AndroidQrPairingService {
    port: Arc<dyn AndroidQrPairingPort>,
    clock: Arc<dyn AndroidQrPairingClock>,
    pending: Mutex<Option<PendingPairing>>,
}
impl AndroidQrPairingService {
    pub fn new(port: Arc<dyn AndroidQrPairingPort>, clock: Arc<dyn AndroidQrPairingClock>) -> Self {
        Self {
            port,
            clock,
            pending: Mutex::new(None),
        }
    }
    pub async fn start(&self) -> Result<AndroidQrPairingInfo, String> {
        let mut pending = self.pending.lock().await;
        if pending
            .as_ref()
            .is_some_and(|p| self.clock.now() < p.expires)
        {
            return Err("QR 페어링이 이미 실행 중입니다.".into());
        }
        if let Some(old) = pending.take() {
            old.cancel.cancel();
        }
        let name = format!("studio-{}", uuid::Uuid::new_v4().simple());
        let password = uuid::Uuid::new_v4().simple().to_string();
        let info = AndroidQrPairingInfo {
            session_id: uuid::Uuid::new_v4().to_string(),
            payload: format!("WIFI:T:ADB;S:{name};P:{password};;"),
            expires_in_seconds: 120,
        };
        *pending = Some(PendingPairing {
            info: info.clone(),
            name,
            password,
            expires: self.clock.now() + Duration::from_secs(120),
            cancel: CancellationToken::new(),
            claimed: false,
        });
        Ok(info)
    }
    pub async fn cancel(&self, id: &str) -> Result<(), String> {
        let mut pending = self.pending.lock().await;
        if let Some(active) = pending.as_ref() {
            if active.info.session_id != id {
                return Err("다른 QR 페어링입니다.".into());
            }
        }
        if let Some(active) = pending.take() {
            active.cancel.cancel();
        }
        Ok(())
    }
    pub async fn cancel_all(&self) {
        if let Some(active) = self.pending.lock().await.take() {
            active.cancel.cancel();
        }
    }
    pub async fn wait(&self, id: &str) -> Result<AndroidQrPairingResult, String> {
        let (name, password, expires, cancel) = {
            let mut pending = self.pending.lock().await;
            let active = pending.as_mut().ok_or("QR 페어링이 종료됐습니다.")?;
            if active.info.session_id != id || active.claimed {
                return Err("유효하지 않거나 이미 처리 중인 QR 페어링입니다.".into());
            }
            active.claimed = true;
            (
                active.name.clone(),
                active.password.clone(),
                active.expires,
                active.cancel.clone(),
            )
        };
        let remaining = expires.saturating_sub(self.clock.now());
        let operation = async {
            let mut guid: Option<String> = None;
            loop {
                if self.clock.now() >= expires {
                    return Err("QR 페어링 시간이 초과됐습니다. 새 QR을 만드세요.".into());
                }
                let services=self.port.discover().await.map_err(|_|"무선 검색에 실패했습니다. 같은 Wi-Fi와 Platform Tools를 확인하거나 코드로 페어링하세요.")?;
                if self.clock.now() >= expires {
                    continue;
                }
                if let Some(guid) = guid.as_ref() {
                    if let Some(connection) = services
                        .iter()
                        .find(|s| s.kind == WirelessServiceKind::Connection && s.name == *guid)
                    {
                        let address = WirelessEndpoint::parse(&connection.address)?.address;
                        self.port.connect(&address).await.map_err(|_|"페어링은 완료했지만 연결하지 못했습니다. 연결 포트를 직접 입력할 수 있습니다.")?;
                        if self.clock.now() >= expires {
                            continue;
                        }
                        return Ok(AndroidQrPairingResult { address });
                    }
                } else if let Some(pairing) = services
                    .iter()
                    .find(|s| s.kind == WirelessServiceKind::Pairing && s.name == name)
                {
                    guid = Some(self.port.pair(&pairing.address, &password).await.map_err(
                        |_| "QR 페어링에 실패했습니다. 새 QR을 만들거나 코드로 페어링하세요.",
                    )?);
                }
                self.clock.wait().await;
            }
        };
        let result = tokio::select! {biased;_=cancel.cancelled()=>Err("QR 페어링을 취소했습니다.".into()),result=tokio::time::timeout(remaining,operation)=>result.unwrap_or_else(|_|Err("QR 페어링 시간이 초과됐습니다. 새 QR을 만드세요.".to_owned()))};
        let mut pending = self.pending.lock().await;
        if pending.as_ref().is_some_and(|p| p.info.session_id == id) {
            pending.take();
        }
        result
    }
}
