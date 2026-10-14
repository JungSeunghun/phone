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
    Paste {
        text: String,
    },
    Keyboard {
        usage: u8,
        modifiers: u8,
    },
    KeyboardSettings,
    Key {
        key: EditingKey,
    },
}
#[derive(Clone, Copy, Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EditingKey {
    Backspace,
    Delete,
    Enter,
    Left,
    Right,
    Up,
    Down,
}

pub const MAXIMUM_PHONE_TEXT_BYTES: usize = (1 << 18) - 14;
pub fn validate_phone_text(text: &str) -> Result<(), String> {
    if text.is_empty() || text.contains('\0') || text.len() > MAXIMUM_PHONE_TEXT_BYTES {
        return Err("지원하지 않는 텍스트 또는 텍스트 길이입니다.".into());
    }
    Ok(())
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
        if let Self::Paste { text } = self {
            validate_phone_text(text)?;
            let mut bytes = vec![9];
            bytes.extend(1_u64.to_be_bytes()); // One outstanding clipboard message per writer
            bytes.push(1); // paste into the focused Android field
            bytes.extend((text.len() as u32).to_be_bytes());
            bytes.extend(text.as_bytes());
            return Ok(bytes);
        }
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
            Self::Paste { .. } => unreachable!(),
            Self::Keyboard { usage, modifiers } => {
                if !(4..=0x63).contains(&usage) || modifiers > 15 {
                    return Err("잘못된 키보드 입력입니다.".into());
                }
                let mut bytes = vec![13, 0, 1, 0, 8, modifiers, 0, usage, 0, 0, 0, 0, 0];
                // Every key press includes its release, including modifier keys.
                bytes.extend([13, 0, 1, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0]);
                Ok(bytes)
            }
            Self::KeyboardSettings => Ok(vec![15]),
            Self::Key { key } => {
                let code: u32 = match key {
                    EditingKey::Backspace => 67,
                    EditingKey::Delete => 112,
                    EditingKey::Enter => 66,
                    EditingKey::Left => 21,
                    EditingKey::Right => 22,
                    EditingKey::Up => 19,
                    EditingKey::Down => 20,
                };
                let mut bytes = Vec::with_capacity(28);
                for action in [0, 1] {
                    bytes.extend([0, action]);
                    bytes.extend(code.to_be_bytes());
                    bytes.extend([0; 8]);
                }
                Ok(bytes)
            }
        }
    }
}

pub fn keyboard_create_packet() -> Vec<u8> {
    // Standard USB boot keyboard: modifier byte, reserved byte and six usages.
    const DESCRIPTOR: &[u8] = &[
        0x05, 0x01, 0x09, 0x06, 0xa1, 0x01, 0x05, 0x07, 0x19, 0xe0, 0x29, 0xe7, 0x15, 0x00, 0x25,
        0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02, 0x95, 0x01, 0x75, 0x08, 0x81, 0x01, 0x95, 0x06,
        0x75, 0x08, 0x15, 0x00, 0x25, 0x65, 0x05, 0x07, 0x19, 0x00, 0x29, 0x65, 0x81, 0x00, 0xc0,
    ];
    let name = b"Phone Mirror Keyboard";
    let mut bytes = vec![12, 0, 1, 0, 0, 0, 0, name.len() as u8];
    bytes.extend(name);
    bytes.extend((DESCRIPTOR.len() as u16).to_be_bytes());
    bytes.extend(DESCRIPTOR);
    bytes
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
