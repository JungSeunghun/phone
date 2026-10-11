use serde::{Deserialize, Serialize};
use std::{collections::HashSet, net::IpAddr};

pub const MAX_VIDEO_PACKET_SIZE: usize = 16 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionTransport {
    Usb,
    Wifi,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTarget {
    pub identity: String,
    pub transport: ConnectionTransport,
}
impl ConnectionTarget {
    pub fn validate(&self) -> Result<(), String> {
        if valid_identity(&self.identity) {
            Ok(())
        } else {
            Err("유효하지 않은 기기 식별자입니다.".into())
        }
    }
    pub fn selection_id(&self) -> String {
        format!(
            "{}:{}",
            match self.transport {
                ConnectionTransport::Usb => "usb",
                ConnectionTransport::Wifi => "wifi",
            },
            self.identity
        )
    }
}
pub fn valid_identity(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= 256
        && value.trim() == value
        && !value.chars().any(char::is_control)
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum DeviceAvailability {
    Ready,
    Unauthorized,
    Offline,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceEndpoint {
    pub transport: ConnectionTransport,
    pub address: String,
    pub identifier: String,
}
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PhonePlatform {
    #[default]
    Android,
    Ios,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCapabilities {
    pub control: bool,
    pub audio: bool,
    pub keep_screen_awake: bool,
}
impl Default for DeviceCapabilities {
    fn default() -> Self {
        Self {
            control: true,
            audio: true,
            keep_screen_awake: true,
        }
    }
}
impl DeviceCapabilities {
    pub fn ios_usb() -> Self {
        Self {
            control: false,
            audio: true,
            keep_screen_awake: false,
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PhoneDevice {
    #[serde(default)]
    pub platform: PhonePlatform,
    #[serde(default)]
    pub capabilities: DeviceCapabilities,
    pub id: String,
    pub identity: String,
    pub name: String,
    pub availability: DeviceAvailability,
    pub endpoint: DeviceEndpoint,
}
impl PhoneDevice {
    pub fn target(&self) -> ConnectionTarget {
        ConnectionTarget {
            identity: self.identity.clone(),
            transport: self.endpoint.transport,
        }
    }
}
#[derive(Clone, Debug)]
pub struct AdbTransport {
    pub identifier: String,
    pub name: String,
    pub availability: DeviceAvailability,
    pub transport: ConnectionTransport,
}
pub fn parse_transports(output: &str) -> Vec<AdbTransport> {
    let mut seen = HashSet::new();
    output
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            let position = fields
                .iter()
                .position(|value| matches!(*value, "device" | "unauthorized" | "offline"))?;
            if position == 0 {
                return None;
            }
            let identifier = fields[..position].join(" ");
            if !valid_identity(&identifier)
                || identifier.starts_with("emulator-")
                || !seen.insert(identifier.clone())
            {
                return None;
            }
            let transport = if identifier.contains("._adb-tls-connect._tcp")
                || WirelessEndpoint::parse(&identifier).is_ok()
            {
                ConnectionTransport::Wifi
            } else if identifier.contains(':') {
                return None;
            } else {
                ConnectionTransport::Usb
            };
            let availability = match fields[position] {
                "device" => DeviceAvailability::Ready,
                "unauthorized" => DeviceAvailability::Unauthorized,
                _ => DeviceAvailability::Offline,
            };
            let name = fields[position + 1..]
                .iter()
                .find_map(|field| field.strip_prefix("model:"))
                .unwrap_or(&identifier)
                .replace('_', " ");
            Some(AdbTransport {
                identifier,
                name,
                availability,
                transport,
            })
        })
        .collect()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WirelessEndpoint {
    pub address: String,
}
impl WirelessEndpoint {
    pub fn parse(input: &str) -> Result<Self, String> {
        let value = input.trim();
        let error = || "IP 주소와 1–65535 범위의 포트를 입력하세요.".to_string();
        if value.len() > 128 || value.chars().any(char::is_whitespace) {
            return Err(error());
        }
        let (host, port) = value.rsplit_once(':').ok_or_else(error)?;
        if port.is_empty() || !port.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(error());
        }
        let port = port.parse::<u16>().map_err(|_| error())?;
        if port == 0 {
            return Err(error());
        }
        let bracketed = host.starts_with('[') && host.ends_with(']');
        let host = if bracketed {
            &host[1..host.len() - 1]
        } else {
            if host.contains(':') {
                return Err(error());
            }
            host
        };
        let ip = host.parse::<IpAddr>().map_err(|_| error())?;
        if bracketed && !ip.is_ipv6() {
            return Err(error());
        }
        let address = match ip {
            IpAddr::V4(ip) => format!("{ip}:{port}"),
            IpAddr::V6(ip) => format!("[{ip}]:{port}"),
        };
        Ok(Self { address })
    }
}
// Intentionally not Debug/Serialize: the one-time secret must not enter logs or storage.
pub struct PairingRequest {
    pub endpoint: WirelessEndpoint,
    pub code: String,
}
impl PairingRequest {
    pub fn parse(address: &str, code: &str) -> Result<Self, String> {
        let endpoint = WirelessEndpoint::parse(address)?;
        if code.len() != 6 || !code.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err("6자리 숫자 페어링 코드를 입력하세요.".into());
        }
        Ok(Self {
            endpoint,
            code: code.into(),
        })
    }
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WirelessServiceKind {
    Pairing,
    Connection,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WirelessService {
    pub name: String,
    pub kind: WirelessServiceKind,
    pub address: String,
}
impl WirelessService {
    pub fn instance_number(&self) -> u32 {
        self.name
            .rsplit_once(" (")
            .and_then(|(_, suffix)| suffix.strip_suffix(')'))
            .and_then(|number| number.parse().ok())
            .filter(|n| *n >= 2)
            .unwrap_or(0)
    }
    pub fn matches_identifier(&self, identifier: &str) -> bool {
        self.address == identifier
            || identifier.trim_end_matches('.') == format!("{}._adb-tls-connect._tcp", self.name)
    }
}
pub fn parse_services(output: &str) -> Vec<WirelessService> {
    let mut seen = HashSet::new();
    output
        .lines()
        .filter_map(|line| {
            let fields: Vec<_> = line.split_whitespace().collect();
            if fields.len() < 3 {
                return None;
            }
            let kind = match fields[fields.len() - 2].trim_end_matches('.') {
                "_adb-tls-pairing._tcp" => WirelessServiceKind::Pairing,
                "_adb-tls-connect._tcp" => WirelessServiceKind::Connection,
                _ => return None,
            };
            let address = WirelessEndpoint::parse(fields[fields.len() - 1])
                .ok()?
                .address;
            let name = fields[..fields.len() - 2].join(" ");
            if !valid_identity(&name) || !seen.insert(format!("{name}:{kind:?}:{address}")) {
                return None;
            }
            Some(WirelessService {
                name,
                kind,
                address,
            })
        })
        .collect()
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WirelessBookmark {
    pub identity: String,
    pub name: String,
    pub service_name: String,
}
impl WirelessBookmark {
    pub fn is_valid(&self) -> bool {
        valid_identity(&self.identity)
            && valid_identity(&self.service_name)
            && self.service_name.starts_with("adb-")
            && self.service_name.len() > 4
    }
    pub fn matches_service(&self, name: &str) -> bool {
        self.service_name == name || name.starts_with(&format!("adb-{}-", self.identity))
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MirrorSettings {
    pub video_max_dimension: u32,
    pub video_max_frame_rate: u32,
    pub keep_screen_awake: bool,
}
impl Default for MirrorSettings {
    fn default() -> Self {
        Self {
            video_max_dimension: 1920,
            video_max_frame_rate: 60,
            keep_screen_awake: true,
        }
    }
}
impl MirrorSettings {
    pub fn validate(&self) -> Result<(), String> {
        if ![720, 1280, 1920, 2560, 3840].contains(&self.video_max_dimension)
            || ![15, 30, 60].contains(&self.video_max_frame_rate)
        {
            return Err("지원하지 않는 영상 설정입니다.".into());
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionRequest {
    pub session_id: String,
    pub target: ConnectionTarget,
    pub settings: MirrorSettings,
}
impl SessionRequest {
    pub fn validate(&self) -> Result<(), String> {
        uuid::Uuid::parse_str(&self.session_id)
            .map_err(|_| "유효하지 않은 세션입니다.".to_string())?;
        self.target.validate()?;
        self.settings.validate()
    }
}
pub struct VideoPacketHeader {
    pub configuration: bool,
    pub key_frame: bool,
    pub timestamp: u64,
    pub payload_size: usize,
}
impl VideoPacketHeader {
    pub fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() != 12 {
            return Err("잘못된 영상 헤더입니다.".into());
        }
        let flags = u64::from_be_bytes(bytes[..8].try_into().unwrap());
        let payload_size = u32::from_be_bytes(bytes[8..].try_into().unwrap()) as usize;
        let timestamp = flags & ((1 << 61) - 1);
        if flags & (1 << 63) != 0
            || payload_size == 0
            || payload_size > MAX_VIDEO_PACKET_SIZE
            || timestamp > ((1 << 53) - 1)
        {
            return Err("잘못된 영상 패킷입니다.".into());
        }
        Ok(Self {
            configuration: flags & (1 << 62) != 0,
            key_frame: flags & (1 << 61) != 0,
            timestamp,
            payload_size,
        })
    }
}
