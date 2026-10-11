//! Phone Mirror authenticated media receiver, independent of the USB or Wi-Fi carrier.
use crate::{
    domain::*,
    infrastructure::{AudioPacketSink, VideoPacketSink},
};
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use serde::{Deserialize, Serialize};
use std::{
    sync::{Arc, Mutex},
    time::Duration,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{mpsc, Semaphore},
    task::JoinSet,
};
use tokio_util::sync::CancellationToken;
pub const MAX_WIRE_PAYLOAD: usize = 4 * 1024 * 1024;
pub fn validate_wire_size(size: usize) -> Result<(), String> {
    if (25..=MAX_WIRE_PAYLOAD + 25).contains(&size) {
        Ok(())
    } else {
        Err("잘못된 iPhone 패킷 크기입니다.".into())
    }
}
pub struct WireCipher {
    cipher: Aes256Gcm,
    counter: u64,
}
impl WireCipher {
    pub fn new(secret: &[u8; 32], challenge: &[u8; 16]) -> Self {
        let mut key = [0u8; 32];
        hkdf::Hkdf::<sha2::Sha256>::new(Some(challenge), secret)
            .expand(b"PhoneMirrorWiFi/v1", &mut key)
            .expect("fixed HKDF length");
        Self {
            cipher: Aes256Gcm::new((&key).into()),
            counter: 0,
        }
    }
    pub fn seal(&mut self, kind: u8, payload: &[u8]) -> Result<Vec<u8>, String> {
        if !(1..=4).contains(&kind) || payload.len() > MAX_WIRE_PAYLOAD || self.counter == u64::MAX
        {
            return Err("잘못된 송출 데이터입니다.".into());
        }
        let length = payload.len() + 25;
        let mut header = (length as u32).to_be_bytes().to_vec();
        header.extend(self.counter.to_be_bytes());
        let mut nonce = [0u8; 12];
        nonce[4..].copy_from_slice(&self.counter.to_be_bytes());
        let mut plain = vec![kind];
        plain.extend(payload);
        let cipher = self
            .cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &plain,
                    aad: &header,
                },
            )
            .map_err(|_| "송출 암호화에 실패했습니다.")?;
        header.extend(cipher);
        self.counter += 1;
        Ok(header)
    }
    pub fn open(&mut self, frame: &[u8]) -> Result<(u8, Vec<u8>), String> {
        if frame.len() < 29 {
            return Err("잘못된 암호화 패킷입니다.".into());
        }
        let length = u32::from_be_bytes(frame[..4].try_into().unwrap()) as usize;
        validate_wire_size(length)?;
        if frame.len() != length + 4
            || u64::from_be_bytes(frame[4..12].try_into().unwrap()) != self.counter
            || self.counter == u64::MAX
        {
            return Err("암호화 패킷 순서가 유효하지 않습니다.".into());
        }
        let mut nonce = [0u8; 12];
        nonce[4..].copy_from_slice(&self.counter.to_be_bytes());
        let plain = self
            .cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &frame[12..],
                    aad: &frame[..12],
                },
            )
            .map_err(|_| "iPhone 연결 인증에 실패했습니다.")?;
        if !(1..=4).contains(&plain[0]) {
            return Err("알 수 없는 송출 패킷입니다.".into());
        }
        self.counter += 1;
        Ok((plain[0], plain[1..].to_vec()))
    }
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SenderHello {
    version: u32,
    device_id: String,
    name: String,
    audio: bool,
}
pub fn parse_sender_hello(json: &[u8]) -> Result<SenderHello, String> {
    if json.len() > 512 {
        return Err("송출 기기 정보가 너무 큽니다.".into());
    }
    let hello: SenderHello =
        serde_json::from_slice(json).map_err(|_| "잘못된 송출 기기 정보입니다.")?;
    if hello.version != 1
        || uuid::Uuid::parse_str(&hello.device_id).is_err()
        || !valid_identity(&hello.name)
        || hello.name.chars().count() > 80
    {
        return Err("지원하지 않는 송출 기기 정보입니다.".into());
    }
    Ok(hello)
}
impl SenderHello {
    pub fn device(&self, address: &str) -> PhoneDevice {
        let identity = format!("ios-wifi:{}", self.device_id);
        let target = ConnectionTarget {
            identity: identity.clone(),
            transport: ConnectionTransport::Wifi,
        };
        PhoneDevice {
            id: target.selection_id(),
            identity,
            name: self.name.clone(),
            platform: PhonePlatform::Ios,
            capabilities: DeviceCapabilities {
                control: false,
                audio: self.audio,
                keep_screen_awake: false,
            },
            availability: DeviceAvailability::Ready,
            endpoint: DeviceEndpoint {
                transport: ConnectionTransport::Wifi,
                address: address.into(),
                identifier: self.device_id.clone(),
            },
        }
    }
}
pub fn validate_sender_audio(packet: &[u8]) -> Result<(), String> {
    crate::recording_audio::validate_pcm_packet(packet)
}
fn validate_sender_video(packet: &[u8]) -> Result<VideoPacketHeader, String> {
    if packet.len() < 12 {
        return Err("잘못된 iPhone 영상입니다.".into());
    }
    let header = VideoPacketHeader::parse(&packet[..12])?;
    if header.payload_size != packet.len() - 12 || packet.len() > MAX_WIRE_PAYLOAD {
        return Err("잘못된 iPhone 영상 크기입니다.".into());
    }
    let units = crate::recording::annex_b_units(&packet[12..])?;
    if header.configuration
        && (packet.len() > 65536
            || !units.iter().any(|n| n[0] & 31 == 7)
            || !units.iter().any(|n| n[0] & 31 == 8)
            || header.key_frame)
    {
        return Err("잘못된 iPhone 영상 설정입니다.".into());
    }
    Ok(header)
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReceiverInfo {
    pub receiver_id: String,
    pub port: u16,
    pub codes: Vec<String>,
}
struct Client {
    device: PhoneDevice,
    connection: u64,
    configuration: Option<Vec<u8>>,
    subscriber: Option<(String, mpsc::Sender<QueuedPacket>)>,
}
struct ReceiverState {
    client: Option<Client>,
    paired_identity: Option<String>,
    next_connection: u64,
}
struct QueuedPacket {
    kind: u8,
    bytes: Vec<u8>,
    _permit: tokio::sync::OwnedSemaphorePermit,
}
struct Receiver {
    id: String,
    secret: [u8; 32],
    stop: CancellationToken,
    state: Mutex<ReceiverState>,
    task: Mutex<Option<tokio::task::JoinHandle<()>>>,
}
#[derive(Default)]
pub struct IosMediaReceiverService {
    receiver: tokio::sync::Mutex<Option<Arc<Receiver>>>,
}
impl IosMediaReceiverService {
    pub async fn start(&self) -> Result<ReceiverInfo, String> {
        self.start_on("0.0.0.0:0").await
    }
    pub async fn start_on(&self, bind: &str) -> Result<ReceiverInfo, String> {
        let mut slot = self.receiver.lock().await;
        if slot.is_some() {
            return Err("iPhone 수신이 이미 실행 중입니다.".into());
        }
        let listener = TcpListener::bind(bind)
            .await
            .map_err(|_| "iPhone 수신 포트를 열 수 없습니다.")?;
        let port = listener
            .local_addr()
            .map_err(|_| "수신 주소가 없습니다.")?
            .port();
        let mut secret = [0u8; 32];
        secret[..16].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
        secret[16..].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
        let key = secret
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>();
        let mut addresses: Vec<String> = if bind.starts_with("127.") {
            vec!["127.0.0.1".into()]
        } else {
            if_addrs::get_if_addrs()
                .unwrap_or_default()
                .into_iter()
                .filter_map(|i| match i.ip() {
                    std::net::IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => {
                        Some(ip.to_string())
                    }
                    _ => None,
                })
                .collect()
        };
        addresses.sort();
        addresses.dedup();
        addresses.truncate(16);
        if addresses.is_empty() {
            return Err("Wi-Fi 또는 유선 로컬 네트워크에 먼저 연결하세요.".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let info = ReceiverInfo {
            receiver_id: id.clone(),
            port,
            codes: addresses
                .into_iter()
                .map(|address| format!("PMW1|{address}:{port}|{key}"))
                .collect(),
        };
        let receiver = Arc::new(Receiver {
            id,
            secret,
            stop: CancellationToken::new(),
            state: Mutex::new(ReceiverState {
                client: None,
                paired_identity: None,
                next_connection: 0,
            }),
            task: Mutex::new(None),
        });
        let worker = receiver.clone();
        let task = tokio::spawn(async move {
            worker.listen(listener).await;
        });
        *receiver.task.lock().unwrap() = Some(task);
        *slot = Some(receiver);
        Ok(info)
    }
    pub async fn stop(&self, id: &str) -> Result<(), String> {
        let mut slot = self.receiver.lock().await;
        let Some(r) = slot.as_ref().filter(|r| r.id == id).cloned() else {
            return Ok(());
        };
        slot.take();
        drop(slot);
        r.stop.cancel();
        let task = r.task.lock().unwrap().take();
        if let Some(task) = task {
            task.await.map_err(|_| "수신 종료에 실패했습니다.")?;
        }
        Ok(())
    }
    pub async fn cancel_all(&self) {
        let id = self.receiver.lock().await.as_ref().map(|r| r.id.clone());
        if let Some(id) = id {
            self.stop(&id).await.ok();
        }
    }
    pub async fn diagnostic_observation(&self) -> crate::connection_diagnostics::ProbeObservation {
        use crate::connection_diagnostics::ProbeObservation;
        let slot = self.receiver.lock().await;
        match slot.as_ref() {
            None => ProbeObservation::Missing,
            Some(receiver) => {
                match receiver
                    .state
                    .lock()
                    .unwrap()
                    .client
                    .as_ref()
                    .map(|client| client.device.availability)
                {
                    Some(DeviceAvailability::Ready) => ProbeObservation::Passed,
                    Some(DeviceAvailability::Offline) => ProbeObservation::Offline,
                    Some(DeviceAvailability::Unauthorized) => ProbeObservation::Unauthorized,
                    None => ProbeObservation::Waiting,
                }
            }
        }
    }
    pub async fn discover(&self) -> Vec<PhoneDevice> {
        let slot = self.receiver.lock().await;
        slot.as_ref()
            .and_then(|r| {
                r.state
                    .lock()
                    .unwrap()
                    .client
                    .as_ref()
                    .map(|c| c.device.clone())
            })
            .into_iter()
            .collect()
    }
    pub async fn run(
        &self,
        identity: &str,
        video: Arc<dyn VideoPacketSink>,
        audio: Arc<dyn AudioPacketSink>,
        cancel: CancellationToken,
    ) -> Result<(), String> {
        let receiver = self
            .receiver
            .lock()
            .await
            .clone()
            .ok_or("iPhone 수신이 종료됐습니다.")?;
        let subscription = uuid::Uuid::new_v4().to_string();
        let (sender, mut packets) = mpsc::channel(32);
        let configuration = {
            let mut state = receiver.state.lock().unwrap();
            let c = state
                .client
                .as_mut()
                .filter(|c| {
                    c.device.identity == identity
                        && c.device.availability == DeviceAvailability::Ready
                })
                .ok_or("iPhone 송출 기기가 없습니다.")?;
            if c.subscriber.is_some() {
                return Err("iPhone 영상 세션이 이미 있습니다.".into());
            }
            c.subscriber = Some((subscription.clone(), sender));
            c.configuration.clone()
        };
        let operation = async {
            if let Some(configuration) = configuration { video.send(configuration)?; }
            loop {
                tokio::select! {
                    _ = cancel.cancelled() => return Ok(()),
                    _ = receiver.stop.cancelled() => return Err("iPhone 수신을 종료했습니다.".into()),
                    packet = packets.recv() => {
                        let packet = packet.ok_or("iPhone 송출 연결이 끊겼습니다.")?;
                        match packet.kind {
                            2 => video.send(packet.bytes.clone())?,
                            3 => audio.send(packet.bytes.clone())?,
                            _ => {}
                        }
                    }
                }
            }
        }.await;
        let mut state = receiver.state.lock().unwrap();
        if let Some(c) = state.client.as_mut() {
            if c.subscriber
                .as_ref()
                .is_some_and(|(id, _)| id == &subscription)
            {
                c.subscriber = None;
            }
        }
        operation
    }
}
impl Receiver {
    async fn listen(self: Arc<Self>, listener: TcpListener) {
        let slots = Arc::new(Semaphore::new(4));
        let mut tasks = JoinSet::new();
        loop {
            tokio::select! {
                _ = self.stop.cancelled() => break,
                Some(_) = tasks.join_next(), if !tasks.is_empty() => {},
                accepted = listener.accept() => {
                    let Ok((stream, _)) = accepted else { break };
                    let Ok(permit) = slots.clone().try_acquire_owned() else { drop(stream); continue };
                    let worker = self.clone();
                    tasks.spawn(async move { let _permit = permit; worker.receive(stream).await.ok(); });
                }
            }
        }
        tasks.abort_all();
        while tasks.join_next().await.is_some() {}
        if let Some(c) = self.state.lock().unwrap().client.as_mut() {
            c.device.availability = DeviceAvailability::Offline;
            c.subscriber = None;
        }
    }
    async fn receive(self: Arc<Self>, mut stream: TcpStream) -> Result<(), String> {
        stream.set_nodelay(true).ok();
        let challenge = *uuid::Uuid::new_v4().as_bytes();
        let mut greeting = b"PMW1".to_vec();
        greeting.extend(challenge);
        let mut cipher = WireCipher::new(&self.secret, &challenge);
        let hello = tokio::time::timeout(Duration::from_secs(5), async {
            stream
                .write_all(&greeting)
                .await
                .map_err(|_| "수신 준비 전송 실패")?;
            let (kind, json) = read_frame(&mut stream, &mut cipher, 1024).await?;
            if kind != 1 {
                return Err("송출 인증 정보가 필요합니다.".into());
            }
            parse_sender_hello(&json)
        })
        .await
        .map_err(|_| "송출 인증 시간이 초과됐습니다.")??;
        let device = hello.device(
            &stream
                .peer_addr()
                .map_err(|_| "주소 확인 실패")?
                .to_string(),
        );
        let connection = {
            let mut state = self.state.lock().unwrap();
            if state
                .paired_identity
                .as_ref()
                .is_some_and(|id| id != &device.identity)
                || state
                    .client
                    .as_ref()
                    .is_some_and(|c| c.device.availability == DeviceAvailability::Ready)
            {
                return Err("다른 송출 연결이 이미 있습니다.".into());
            }
            state.paired_identity = Some(device.identity.clone());
            state.next_connection += 1;
            let connection = state.next_connection;
            state.client = Some(Client {
                device,
                connection,
                configuration: None,
                subscriber: None,
            });
            connection
        };
        let result = self
            .receive_packets(&mut stream, &mut cipher, connection, hello.audio)
            .await;
        let mut state = self.state.lock().unwrap();
        if let Some(c) = state.client.as_mut().filter(|c| c.connection == connection) {
            c.device.availability = DeviceAvailability::Offline;
            c.subscriber = None;
        }
        result
    }
    async fn receive_packets(
        &self,
        stream: &mut TcpStream,
        cipher: &mut WireCipher,
        connection: u64,
        audio_enabled: bool,
    ) -> Result<(), String> {
        let budget = Arc::new(Semaphore::new(MAX_WIRE_PAYLOAD));
        let mut last_video = None;
        let mut last_audio = None;
        loop {
            let (kind, bytes) = tokio::select! {_=self.stop.cancelled()=>return Ok(()),result=tokio::time::timeout(Duration::from_secs(6),read_frame(stream,cipher,MAX_WIRE_PAYLOAD+25))=>result.map_err(|_|"iPhone 송출 응답 시간이 초과됐습니다.")??};
            if kind == 4 {
                if !bytes.is_empty() {
                    return Err("잘못된 송출 유지 패킷입니다.".into());
                }
                continue;
            }
            let mut state = self.state.lock().unwrap();
            let client = state
                .client
                .as_mut()
                .filter(|c| c.connection == connection)
                .ok_or("송출 연결이 교체됐습니다.")?;
            match kind {
                2 => {
                    let h = validate_sender_video(&bytes)?;
                    if h.configuration {
                        client.configuration = Some(bytes.clone());
                    } else {
                        if client.configuration.is_none()
                            || last_video.is_some_and(|t| h.timestamp <= t)
                        {
                            return Err("잘못된 iPhone 영상 순서입니다.".into());
                        }
                        last_video = Some(h.timestamp);
                    }
                }
                3 => {
                    if !audio_enabled {
                        return Err("오디오가 비활성화된 송출입니다.".into());
                    }
                    validate_sender_audio(&bytes)?;
                    let h = VideoPacketHeader::parse(&bytes[..12])?;
                    if last_audio.is_some_and(|t| h.timestamp <= t) {
                        return Err("잘못된 iPhone 오디오 순서입니다.".into());
                    }
                    last_audio = Some(h.timestamp);
                }
                _ => return Err("잘못된 iPhone 송출 순서입니다.".into()),
            }
            if let Some((_, subscriber)) = &client.subscriber {
                let permit = budget
                    .clone()
                    .try_acquire_many_owned(bytes.len() as u32)
                    .map_err(|_| "iPhone 영상 대기열이 혼잡합니다.")?;
                subscriber
                    .try_send(QueuedPacket {
                        kind,
                        bytes,
                        _permit: permit,
                    })
                    .map_err(|_| "iPhone 영상 수신이 느리거나 종료됐습니다.")?;
            }
        }
    }
}
async fn read_frame(
    stream: &mut TcpStream,
    cipher: &mut WireCipher,
    maximum: usize,
) -> Result<(u8, Vec<u8>), String> {
    let mut length = [0u8; 4];
    stream
        .read_exact(&mut length)
        .await
        .map_err(|_| "송출 연결이 끊겼습니다.")?;
    let size = u32::from_be_bytes(length) as usize;
    validate_wire_size(size)?;
    if size > maximum {
        return Err("송출 인증 정보가 너무 큽니다.".into());
    }
    let mut frame = vec![0u8; size + 4];
    frame[..4].copy_from_slice(&length);
    stream
        .read_exact(&mut frame[4..])
        .await
        .map_err(|_| "송출 패킷이 중간에 종료됐습니다.")?;
    cipher.open(&frame)
}
impl Drop for IosMediaReceiverService {
    fn drop(&mut self) {
        if let Some(r) = self.receiver.get_mut().as_ref() {
            r.stop.cancel();
        }
    }
}

// Compatibility names for existing Wi-Fi callers. Wire v1 remains unchanged.
pub type IosWifiReceiverService = IosMediaReceiverService;
pub use validate_sender_audio as validate_wifi_audio;
