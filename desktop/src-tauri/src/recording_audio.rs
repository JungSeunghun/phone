//! Shared media clock and PCM alignment. No device, Tauri, disk or OS API dependencies.
#[derive(Default)]
pub struct RecordingTimeline {
    source_base: Option<u64>,
    output_base: u64,
    last_video: Option<u64>,
    paused: bool,
    waiting_key: bool,
}
impl RecordingTimeline {
    pub fn video(&mut self, timestamp: u64, key: bool) -> Result<Option<u64>, String> {
        if timestamp >= 1 << 53 {
            return Err("잘못된 녹화 시간입니다.".into());
        }
        if self.paused {
            return Ok(None);
        }
        if self.source_base.is_none() || self.waiting_key {
            if !key {
                return Ok(None);
            }
            self.source_base = Some(timestamp);
            self.waiting_key = false;
            self.last_video = None;
        }
        if self.last_video.is_some_and(|last| timestamp <= last) {
            return Err("녹화 시간이 역행했습니다.".into());
        }
        let output = self
            .output_base
            .checked_add(
                timestamp
                    .checked_sub(self.source_base.unwrap())
                    .ok_or("녹화 시간 역행")?,
            )
            .ok_or("녹화 시간 초과")?;
        if output >= 1 << 53 {
            return Err("녹화 시간 초과".into());
        }
        self.last_video = Some(timestamp);
        Ok(Some(output))
    }
    pub fn audio(&self, timestamp: u64) -> Option<u64> {
        if self.paused || self.waiting_key || timestamp >= 1 << 53 {
            return None;
        }
        self.output_base
            .checked_add(timestamp.checked_sub(self.source_base?)?)
    }
    pub fn pause(&mut self, output_end: u64) -> Result<(), String> {
        if output_end >= 1 << 53 {
            return Err("녹화 시간 초과".into());
        }
        if !self.paused {
            if let Some(last) = self.last_video {
                let current = self.output_base + last - self.source_base.unwrap();
                if output_end < current {
                    return Err("녹화 정지 시간이 역행했습니다.".into());
                }
            }
            self.output_base = output_end;
            self.paused = true;
        }
        Ok(())
    }
    pub fn resume(&mut self) {
        if self.paused {
            self.paused = false;
            self.waiting_key = true;
        }
    }
    pub fn source_base(&self) -> Option<u64> {
        if self.paused || self.waiting_key {
            None
        } else {
            self.source_base
        }
    }
}
pub fn audio_sample_position(timestamp: u64) -> Result<u64, String> {
    timestamp
        .checked_mul(48_000)
        .and_then(|v| v.checked_add(500_000))
        .map(|v| v / 1_000_000)
        .ok_or("오디오 시간 초과".into())
}
#[derive(Default)]
pub struct AlignedAudio {
    frames: u64,
}
impl AlignedAudio {
    pub fn cursor(&self) -> u64 {
        self.frames
    }
    pub fn append(&mut self, timestamp: u64, pcm: &[u8]) -> Result<Vec<u8>, String> {
        if pcm.is_empty() || pcm.len() > 4096 || !pcm.len().is_multiple_of(4) {
            return Err("잘못된 녹화 PCM 크기입니다.".into());
        }
        let target = audio_sample_position(timestamp)?;
        let count = (pcm.len() / 4) as u64;
        let gap = target.saturating_sub(self.frames);
        if gap > 96_000 {
            return Err("오디오 간격이 너무 큽니다.".into());
        }
        let trim = self.frames.saturating_sub(target).min(count);
        let mut bytes = vec![0; (gap * 4) as usize];
        bytes.extend(&pcm[(trim * 4) as usize..]);
        self.frames = self
            .frames
            .checked_add(gap + count - trim)
            .ok_or("오디오 길이 초과")?;
        Ok(bytes)
    }
    pub fn silence(&mut self, frames: u64) -> Vec<u8> {
        let count = frames.min(1024);
        self.frames += count;
        vec![0; (count * 4) as usize]
    }
}
pub trait RecordingAudioEncoder: Send {
    fn encode(&mut self, pcm: &[i16]) -> Result<Vec<u8>, String>;
    fn flush(&mut self) -> Result<Vec<u8>, String>;
}
pub struct AacRecordingEncoder(oxideav_aac::encoder::StreamEncoder);
impl AacRecordingEncoder {
    pub fn new() -> Result<Self, String> {
        oxideav_aac::encoder::StreamEncoder::new(oxideav_aac::encoder::EncoderConfig {
            sample_rate: 48000,
            channels: 2,
            bitrate: 128000,
        })
        .map(Self)
        .map_err(|_| "오디오 인코더 초기화 실패".into())
    }
}
fn adts_payload(packet: Vec<u8>) -> Result<Vec<u8>, String> {
    if packet.len() < 8 || packet[0] != 0xff || packet[1] & 0xf6 != 0xf0 {
        return Err("AAC 프레임 오류".into());
    }
    let header = if packet[1] & 1 == 1 { 7 } else { 9 };
    if packet.len() <= header {
        return Err("AAC 크기 오류".into());
    }
    Ok(packet[header..].to_vec())
}
impl RecordingAudioEncoder for AacRecordingEncoder {
    fn encode(&mut self, pcm: &[i16]) -> Result<Vec<u8>, String> {
        if pcm.len() != 2048 {
            return Err("AAC 입력 크기 오류".into());
        }
        adts_payload(self.0.encode_frame(pcm).map_err(|_| "AAC 인코딩 실패")?)
    }
    fn flush(&mut self) -> Result<Vec<u8>, String> {
        adts_payload(self.0.finish().map_err(|_| "AAC 마무리 실패")?)
    }
}

pub fn validate_pcm_packet(packet: &[u8]) -> Result<(), String> {
    if !(16..=4108).contains(&packet.len()) {
        return Err("잘못된 PCM 패킷 크기입니다.".into());
    }
    let header = crate::domain::VideoPacketHeader::parse(&packet[..12])?;
    if header.configuration
        || header.key_frame
        || !header.payload_size.is_multiple_of(4)
        || header.payload_size != packet.len() - 12
    {
        return Err("잘못된 PCM 오디오입니다.".into());
    }
    Ok(())
}

/// Encoders vend raw AAC-LC access units at 48kHz stereo; the worker owns their lifetime.
pub trait RecordingAudioEncoderFactory: Send + Sync {
    fn create(&self) -> Result<Box<dyn RecordingAudioEncoder>, String>;
}
pub struct SoftwareAacEncoderFactory;
impl RecordingAudioEncoderFactory for SoftwareAacEncoderFactory {
    fn create(&self) -> Result<Box<dyn RecordingAudioEncoder>, String> {
        Ok(Box::new(AacRecordingEncoder::new()?))
    }
}
