//! iOS USB capture protocol and discovery, independent of Tauri and native media APIs.
use crate::{domain::*, infrastructure::VideoPacketSink};
use serde::Deserialize;
use tokio_util::sync::CancellationToken;

pub fn is_ios_target(target: &ConnectionTarget) -> bool {
    (target.transport == ConnectionTransport::Usb
        && (target.identity.starts_with("ios:") || target.identity.starts_with("ios-usb:")))
        || (target.transport == ConnectionTransport::Wifi
            && target.identity.starts_with("ios-wifi:"))
}
#[derive(Deserialize)]
struct CaptureDevice {
    identifier: String,
    name: String,
    model: String,
    #[serde(default)]
    denied: bool,
}
pub fn parse_ios_devices(json: &str) -> Result<Vec<PhoneDevice>, String> {
    if json.len() > 1024 * 1024 {
        return Err("iPhone 검색 결과가 너무 큽니다.".into());
    }
    let devices: Vec<CaptureDevice> =
        serde_json::from_str(json).map_err(|_| "iPhone 검색 결과를 읽을 수 없습니다.")?;
    let mut seen = std::collections::HashSet::new();
    Ok(devices
        .into_iter()
        .filter_map(|d| {
            let identity = format!("ios:{}", d.identifier);
            if d.model != "iOS Device"
                || !valid_identity(&d.identifier)
                || !valid_identity(&identity)
                || !seen.insert(identity.clone())
            {
                return None;
            }
            let target = ConnectionTarget {
                identity: identity.clone(),
                transport: ConnectionTransport::Usb,
            };
            Some(PhoneDevice {
                id: target.selection_id(),
                identity,
                name: if valid_identity(&d.name) {
                    d.name
                } else {
                    "iPhone".into()
                },
                platform: PhonePlatform::Ios,
                capabilities: DeviceCapabilities::ios_usb(),
                availability: if d.denied {
                    DeviceAvailability::Unauthorized
                } else {
                    DeviceAvailability::Ready
                },
                endpoint: DeviceEndpoint {
                    transport: ConnectionTransport::Usb,
                    address: d.identifier.clone(),
                    identifier: d.identifier,
                },
            })
        })
        .collect())
}
pub fn merge_device_results(
    android: Result<Vec<PhoneDevice>, String>,
    ios: Result<Vec<PhoneDevice>, String>,
) -> Result<Vec<PhoneDevice>, String> {
    match (android, ios) {
        (Ok(mut a), Ok(i)) => {
            a.extend(i);
            Ok(a)
        }
        (Ok(a), Err(_)) | (Err(_), Ok(a)) => Ok(a),
        (Err(a), Err(i)) => Err(format!("{a} {i}")),
    }
}
pub fn ios_video_packet(
    payload: &[u8],
    timestamp: u64,
    configuration: bool,
    key_frame: bool,
) -> Result<Vec<u8>, String> {
    if payload.is_empty() || payload.len() > MAX_VIDEO_PACKET_SIZE || timestamp >= 1u64 << 53 {
        return Err("잘못된 iPhone 영상 패킷입니다.".into());
    }
    let flags =
        timestamp | if configuration { 1 << 62 } else { 0 } | if key_frame { 1 << 61 } else { 0 };
    let mut packet = Vec::with_capacity(payload.len() + 12);
    packet.extend(flags.to_be_bytes());
    packet.extend((payload.len() as u32).to_be_bytes());
    packet.extend(payload);
    Ok(packet)
}
pub fn forward_ios_packet(
    packet: &[u8],
    sink: &dyn VideoPacketSink,
    cancellation: &CancellationToken,
) -> Result<(), String> {
    if cancellation.is_cancelled() {
        return Err("iPhone 화면 연결을 취소했습니다.".into());
    }
    if packet.len() < 12 {
        return Err("잘못된 iPhone 영상 패킷입니다.".into());
    }
    let header = VideoPacketHeader::parse(&packet[..12])?;
    if packet.len() - 12 != header.payload_size {
        return Err("잘못된 iPhone 영상 크기입니다.".into());
    }
    sink.send(packet.to_vec())
}

/// USB audio uses the same 48 kHz stereo Int16 packet contract as Android and Wi-Fi.
pub fn ios_audio_packet(pcm: &[u8], timestamp: u64) -> Result<Vec<u8>, String> {
    if pcm.is_empty() || pcm.len() > 4096 || !pcm.len().is_multiple_of(4) || timestamp >= 1u64 << 53
    {
        return Err("잘못된 iPhone USB 오디오 패킷입니다.".into());
    }
    let packet = ios_video_packet(pcm, timestamp, false, false)?;
    crate::recording_audio::validate_pcm_packet(&packet)?;
    Ok(packet)
}
pub fn forward_ios_audio_packet(
    packet: &[u8],
    sink: &dyn crate::infrastructure::AudioPacketSink,
    cancellation: &CancellationToken,
) -> Result<(), String> {
    if cancellation.is_cancelled() {
        return Err("iPhone 소리 연결을 취소했습니다.".into());
    }
    crate::recording_audio::validate_pcm_packet(packet)?;
    sink.send(packet.to_vec())
}
