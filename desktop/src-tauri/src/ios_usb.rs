//! Windows iPhone USB carrier. Device handles are rediscovered by stable USB serial.
//! The injected tunnel transports the existing authenticated media protocol, never raw USB video.
use crate::{
    domain::*,
    infrastructure::{AudioPacketSink, VideoPacketSink},
    ios_receiver::{IosMediaReceiverService, ReceiverInfo},
};
use async_trait::async_trait;
use plist::{Dictionary, Value};
use std::{io::Cursor, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt},
    net::TcpStream,
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;
pub const USB_SENDER_PORT: u16 = 27483;
const MAX_MUX_MESSAGE: usize = 1024 * 1024;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UsbDevice {
    pub handle: u32,
    pub identifier: String,
}
pub trait UsbTunnel: AsyncRead + AsyncWrite + Unpin + Send {}
impl<T: AsyncRead + AsyncWrite + Unpin + Send> UsbTunnel for T {}
pub type BoxUsbTunnel = Box<dyn UsbTunnel>;
#[async_trait]
pub trait UsbMuxPort: Send + Sync {
    async fn discover(&self) -> Result<Vec<UsbDevice>, String>;
    async fn connect(&self, device: &UsbDevice, port: u16) -> Result<BoxUsbTunnel, String>;
}
pub fn encode_mux_request(
    message: &str,
    tag: u32,
    handle: Option<u32>,
    port: Option<u16>,
) -> Result<Vec<u8>, String> {
    if tag == 0
        || !matches!(message, "ListDevices" | "Connect")
        || (message == "Connect" && (handle.is_none_or(|h| h == 0) || port.is_none_or(|p| p == 0)))
    {
        return Err("잘못된 USB 통신 요청입니다.".into());
    }
    let mut dictionary = Dictionary::new();
    dictionary.insert("MessageType".into(), Value::String(message.into()));
    dictionary.insert(
        "ClientVersionString".into(),
        Value::String("PhoneMirrorDesktop/1".into()),
    );
    dictionary.insert(
        "ProgName".into(),
        Value::String("PhoneMirrorDesktop".into()),
    );
    dictionary.insert("kLibUSBMuxVersion".into(), Value::Integer(3u64.into()));
    if message == "Connect" {
        dictionary.insert(
            "DeviceID".into(),
            Value::Integer(u64::from(handle.unwrap()).into()),
        );
        dictionary.insert(
            "PortNumber".into(),
            Value::Integer(u64::from(port.unwrap().to_be()).into()),
        );
    }
    let mut payload = Vec::new();
    Value::Dictionary(dictionary)
        .to_writer_xml(&mut payload)
        .map_err(|_| "USB 요청을 만들 수 없습니다.")?;
    let mut packet = Vec::new();
    for value in [(payload.len() + 16) as u32, 1, 8, tag] {
        packet.extend(value.to_le_bytes());
    }
    packet.extend(payload);
    Ok(packet)
}
pub fn decode_mux_header(header: &[u8], tag: u32) -> Result<usize, String> {
    if header.len() != 16 {
        return Err("잘못된 USB 응답 헤더입니다.".into());
    }
    let field = |offset| u32::from_le_bytes(header[offset..offset + 4].try_into().unwrap());
    let size = field(0) as usize;
    let valid_message = match field(8) {
        8 => field(4) == 1 && (16..=MAX_MUX_MESSAGE).contains(&size),
        1 => field(4) <= 1 && size == 20,
        _ => false,
    };
    if !valid_message || field(12) != tag {
        return Err("잘못된 USB 응답 크기·버전·식별자입니다.".into());
    }
    Ok(size - 16)
}
pub fn decode_usb_devices(bytes: &[u8]) -> Result<Vec<UsbDevice>, String> {
    if bytes.len() > MAX_MUX_MESSAGE - 16 {
        return Err("USB 검색 결과가 너무 큽니다.".into());
    }
    let value =
        Value::from_reader(Cursor::new(bytes)).map_err(|_| "USB 검색 결과가 손상됐습니다.")?;
    let devices = value
        .as_dictionary()
        .and_then(|d| d.get("DeviceList"))
        .and_then(Value::as_array)
        .ok_or("USB 검색 결과에 기기 목록이 없습니다.")?;
    if devices.len() > 128 {
        return Err("USB 기기 목록이 너무 큽니다.".into());
    }
    let mut result = Vec::new();
    let mut identifiers = std::collections::HashSet::new();
    for value in devices {
        let Some(device) = value.as_dictionary() else {
            return Err("잘못된 USB 기기입니다.".into());
        };
        let Some(properties) = device.get("Properties").and_then(Value::as_dictionary) else {
            return Err("USB 기기 속성이 없습니다.".into());
        };
        if properties.get("ConnectionType").and_then(Value::as_string) != Some("USB") {
            continue;
        }
        let handle = device
            .get("DeviceID")
            .and_then(Value::as_unsigned_integer)
            .and_then(|v| u32::try_from(v).ok())
            .filter(|v| *v > 0)
            .ok_or("잘못된 USB 기기 번호입니다.")?;
        let identifier = properties
            .get("SerialNumber")
            .and_then(Value::as_string)
            .filter(|v| {
                valid_identity(v)
                    && v.len() <= 240
                    && v.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
            })
            .ok_or("잘못된 USB 기기 식별자입니다.")?;
        if identifiers.insert(identifier.to_owned()) {
            result.push(UsbDevice {
                handle,
                identifier: identifier.into(),
            });
        }
    }
    Ok(result)
}
pub struct AppleUsbMuxPort {
    address: std::net::SocketAddr,
}
impl Default for AppleUsbMuxPort {
    fn default() -> Self {
        Self {
            address: "127.0.0.1:27015".parse().unwrap(),
        }
    }
}
impl AppleUsbMuxPort {
    /// Loopback-only seam for short daemon simulation; no remote usbmux service is allowed.
    pub fn new(address: std::net::SocketAddr) -> Result<Self, String> {
        if !address.ip().is_loopback() || address.port() == 0 {
            return Err("USB 통신 서비스는 로컬 주소여야 합니다.".into());
        }
        Ok(Self { address })
    }
    async fn request(
        &self,
        message: &str,
        handle: Option<u32>,
        port: Option<u16>,
    ) -> Result<(TcpStream, Value), String> {
        let packet = encode_mux_request(message, 1, handle, port)?;
        tokio::time::timeout(Duration::from_secs(3), async {
            let mut stream = TcpStream::connect(self.address).await.map_err(|_| "Apple 기기 통신 서비스를 열 수 없습니다. Apple Devices의 기기 드라이버와 USB 신뢰 상태를 확인하세요.")?;
            stream.write_all(&packet).await.map_err(|_| "USB 요청 전송에 실패했습니다.")?;
            let mut header = [0; 16];
            stream.read_exact(&mut header).await.map_err(|_| "USB 응답이 중단됐습니다.")?;
            let size = decode_mux_header(&header, 1)?;
            let mut bytes = vec![0; size];
            stream.read_exact(&mut bytes).await.map_err(|_| "USB 응답이 잘렸습니다.")?;
            let value = if u32::from_le_bytes(header[8..12].try_into().unwrap()) == 1 {
                let mut result = Dictionary::new();
                result.insert("MessageType".into(), Value::String("Result".into()));
                result.insert("Number".into(), Value::Integer(u64::from(u32::from_le_bytes(bytes.try_into().unwrap())).into()));
                Value::Dictionary(result)
            } else {
                Value::from_reader(Cursor::new(bytes)).map_err(|_| "USB 응답이 손상됐습니다.")?
            };
            Ok((stream, value))
        }).await.map_err(|_| "Apple USB 통신 응답 시간이 초과됐습니다.")?
    }
}
#[async_trait]
impl UsbMuxPort for AppleUsbMuxPort {
    async fn discover(&self) -> Result<Vec<UsbDevice>, String> {
        let (_, value) = self.request("ListDevices", None, None).await?;
        let mut bytes = Vec::new();
        value
            .to_writer_xml(&mut bytes)
            .map_err(|_| "USB 응답을 읽을 수 없습니다.")?;
        decode_usb_devices(&bytes)
    }
    async fn connect(&self, device: &UsbDevice, port: u16) -> Result<BoxUsbTunnel, String> {
        let (stream, value) = self
            .request("Connect", Some(device.handle), Some(port))
            .await?;
        if value
            .as_dictionary()
            .and_then(|d| d.get("MessageType"))
            .and_then(Value::as_string)
            != Some("Result")
            || value
                .as_dictionary()
                .and_then(|d| d.get("Number"))
                .and_then(Value::as_unsigned_integer)
                != Some(0)
        {
            return Err(
                "iPhone USB 송출 포트가 닫혀 있습니다. 송출 앱에서 USB 화면 방송을 시작하세요."
                    .into(),
            );
        }
        Ok(Box::new(stream))
    }
}
/// Application retry time is injectable; device discovery and tunnel creation remain separate ports.
#[async_trait]
pub trait UsbRetryScheduler: Send + Sync {
    async fn wait(&self);
}
struct MonotonicUsbRetryScheduler;
#[async_trait]
impl UsbRetryScheduler for MonotonicUsbRetryScheduler {
    async fn wait(&self) {
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
}
struct UsbReceiver {
    info: ReceiverInfo,
    identifier: String,
    receiver: Arc<IosMediaReceiverService>,
    cancel: CancellationToken,
    task: tokio::task::JoinHandle<()>,
}
pub struct IosUsbReceiverService {
    port: Arc<dyn UsbMuxPort>,
    retry_scheduler: Arc<dyn UsbRetryScheduler>,
    slot: Mutex<Option<UsbReceiver>>,
}
impl Default for IosUsbReceiverService {
    fn default() -> Self {
        Self::new(Arc::new(AppleUsbMuxPort::default()))
    }
}
impl IosUsbReceiverService {
    pub fn new(port: Arc<dyn UsbMuxPort>) -> Self {
        Self::with_retry_scheduler(port, Arc::new(MonotonicUsbRetryScheduler))
    }
    pub fn with_retry_scheduler(
        port: Arc<dyn UsbMuxPort>,
        retry_scheduler: Arc<dyn UsbRetryScheduler>,
    ) -> Self {
        Self {
            port,
            retry_scheduler,
            slot: Mutex::new(None),
        }
    }
    pub async fn start(&self) -> Result<ReceiverInfo, String> {
        let mut slot = self.slot.lock().await;
        if slot.is_some() {
            return Err("iPhone USB 수신이 이미 실행 중입니다.".into());
        }
        let devices = self.port.discover().await?;
        if devices.len() != 1 {
            return Err("USB iPhone을 한 대만 연결하고 잠금 해제·컴퓨터 신뢰를 확인하세요.".into());
        }
        let identifier = devices[0].identifier.clone();
        let receiver = Arc::new(IosMediaReceiverService::default());
        let local = receiver.start_on("127.0.0.1:0").await?;
        let key = local
            .codes
            .first()
            .and_then(|code| code.rsplit('|').next())
            .ok_or("USB 연결 키를 만들 수 없습니다.")?;
        let info = ReceiverInfo {
            receiver_id: local.receiver_id.clone(),
            port: USB_SENDER_PORT,
            codes: vec![format!("PMU1|{USB_SENDER_PORT}|{key}")],
        };
        let port = self.port.clone();
        let selected = identifier.clone();
        let retry_scheduler = self.retry_scheduler.clone();
        let cancel = CancellationToken::new();
        let worker_cancel = cancel.clone();
        let task = tokio::spawn(async move {
            loop {
                let operation = async {
                    let devices = port.discover().await?;
                    let device = devices
                        .into_iter()
                        .find(|d| d.identifier == selected)
                        .ok_or("같은 USB iPhone을 기다리고 있습니다.")?;
                    let mut tunnel = port.connect(&device, USB_SENDER_PORT).await?;
                    let mut stream = TcpStream::connect(("127.0.0.1", local.port))
                        .await
                        .map_err(|_| "USB 내부 수신기가 종료됐습니다.")?;
                    tokio::io::copy_bidirectional(&mut tunnel, &mut stream)
                        .await
                        .map_err(|_| "USB 터널이 종료됐습니다.")?;
                    Ok::<(), String>(())
                };
                tokio::select! {_=worker_cancel.cancelled()=>break,_=operation=>{}}
                // Reconnect only the same USB serial; a changed usbmux handle is rediscovered.
                tokio::select! {_=worker_cancel.cancelled()=>break,_=retry_scheduler.wait()=>{}}
            }
        });
        *slot = Some(UsbReceiver {
            info: info.clone(),
            identifier,
            receiver,
            cancel,
            task,
        });
        Ok(info)
    }
    pub async fn stop(&self, id: &str) -> Result<(), String> {
        let mut slot = self.slot.lock().await;
        let Some(active) = slot.as_ref() else {
            return Ok(());
        };
        if active.info.receiver_id != id {
            return Err("다른 iPhone USB 수신입니다.".into());
        }
        let active = slot.take().unwrap();
        active.cancel.cancel();
        drop(slot);
        active.task.await.ok();
        active.receiver.cancel_all().await;
        Ok(())
    }
    pub async fn cancel_all(&self) {
        let id = self
            .slot
            .lock()
            .await
            .as_ref()
            .map(|r| r.info.receiver_id.clone());
        if let Some(id) = id {
            self.stop(&id).await.ok();
        }
    }
    pub async fn diagnostic_observation(&self) -> crate::connection_diagnostics::ProbeObservation {
        let slot = self.slot.lock().await;
        match slot.as_ref() {
            Some(active) => active.receiver.diagnostic_observation().await,
            None => crate::connection_diagnostics::ProbeObservation::Missing,
        }
    }
    pub async fn discover(&self) -> Vec<PhoneDevice> {
        let slot = self.slot.lock().await;
        let Some(active) = slot.as_ref() else {
            return vec![];
        };
        let mut devices = active.receiver.discover().await;
        for device in &mut devices {
            device.identity = format!("ios-usb:{}", active.identifier);
            device.endpoint.transport = ConnectionTransport::Usb;
            device.endpoint.identifier = active.identifier.clone();
            device.endpoint.address = "Apple USB".into();
            device.id = device.target().selection_id();
        }
        devices
    }
    pub async fn run(
        &self,
        identity: &str,
        video: Arc<dyn VideoPacketSink>,
        audio: Arc<dyn AudioPacketSink>,
        cancel: CancellationToken,
    ) -> Result<(), String> {
        let (receiver, source) = {
            let slot = self.slot.lock().await;
            let active = slot.as_ref().ok_or("USB 수신이 종료됐습니다.")?;
            if identity != format!("ios-usb:{}", active.identifier) {
                return Err("다른 USB iPhone입니다.".into());
            }
            let source = active
                .receiver
                .discover()
                .await
                .into_iter()
                .next()
                .ok_or("iPhone USB 화면 방송을 기다리고 있습니다.")?
                .identity;
            (active.receiver.clone(), source)
        };
        receiver.run(&source, video, audio, cancel).await
    }
}
