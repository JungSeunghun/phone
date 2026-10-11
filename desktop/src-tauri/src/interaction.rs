use serde::Deserialize;
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TouchAction {
    Down,
    Up,
    Move,
    Cancel,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum ControlInput {
    Touch {
        action: TouchAction,
        x: u32,
        y: u32,
        width: u16,
        height: u16,
    },
    Scroll {
        x: u32,
        y: u32,
        width: u16,
        height: u16,
        horizontal: f64,
        vertical: f64,
    },
    Back,
}
fn position(x: u32, y: u32, width: u16, height: u16) -> Result<Vec<u8>, String> {
    if width == 0
        || height == 0
        || width > 8192
        || height > 8192
        || x >= width as u32
        || y >= height as u32
    {
        return Err("잘못된 폰 입력 좌표입니다.".into());
    }
    let mut bytes = Vec::new();
    bytes.extend(x.to_be_bytes());
    bytes.extend(y.to_be_bytes());
    bytes.extend(width.to_be_bytes());
    bytes.extend(height.to_be_bytes());
    Ok(bytes)
}
impl ControlInput {
    pub fn encode(&self) -> Result<Vec<u8>, String> {
        match *self {
            Self::Touch {
                action,
                x,
                y,
                width,
                height,
            } => {
                let action = match action {
                    TouchAction::Down => 0,
                    TouchAction::Up => 1,
                    TouchAction::Move => 2,
                    TouchAction::Cancel => 3,
                };
                let mut bytes = vec![2, action];
                bytes.extend((-2_i64).to_be_bytes());
                bytes.extend(position(x, y, width, height)?);
                bytes.extend(
                    if action == 1 || action == 3 {
                        0_u16
                    } else {
                        u16::MAX
                    }
                    .to_be_bytes(),
                );
                bytes.extend(0_u32.to_be_bytes());
                bytes.extend(0_u32.to_be_bytes());
                Ok(bytes)
            }
            Self::Scroll {
                x,
                y,
                width,
                height,
                horizontal,
                vertical,
            } => {
                if !horizontal.is_finite()
                    || !vertical.is_finite()
                    || horizontal.abs() > 16.
                    || vertical.abs() > 16.
                {
                    return Err("잘못된 스크롤 입력입니다.".into());
                }
                let mut bytes = vec![3];
                bytes.extend(position(x, y, width, height)?);
                for value in [horizontal, vertical] {
                    bytes.extend(
                        ((value / 16. * 32768.).round().clamp(-32768., 32767.) as i16)
                            .to_be_bytes(),
                    );
                }
                bytes.extend(0_u32.to_be_bytes());
                Ok(bytes)
            }
            Self::Back => Ok(vec![4, 0, 4, 1]),
        }
    }
}
pub fn validate_audio_packet(packet: &[u8]) -> Result<(), String> {
    if packet.len() < 12 {
        return Err("오디오 헤더가 잘렸습니다.".into());
    }
    let header = crate::domain::VideoPacketHeader::parse(&packet[..12])?;
    if header.configuration
        || header.payload_size > 4096
        || header.payload_size % 4 != 0
        || packet.len() != 12 + header.payload_size
    {
        return Err("잘못된 PCM 오디오 패킷입니다.".into());
    }
    Ok(())
}
