use std::{
    fs::{self, OpenOptions},
    io::Write,
    path::Path,
};
#[derive(Clone, Copy)]
pub enum MediaFormat {
    Png,
    Mp4,
    Webm,
}
impl MediaFormat {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "png" => Ok(Self::Png),
            "mp4" => Ok(Self::Mp4),
            "webm" => Ok(Self::Webm),
            _ => Err("지원하지 않는 파일 형식입니다.".into()),
        }
    }
    pub fn extension(self) -> &'static str {
        match self {
            Self::Png => "png",
            Self::Mp4 => "mp4",
            Self::Webm => "webm",
        }
    }
}
pub const MEDIA_BYTE_LIMIT: usize = 256 * 1024 * 1024;
pub fn valid_media_size(size: usize) -> bool {
    (1..=MEDIA_BYTE_LIMIT).contains(&size)
}
pub fn validate_media(format: MediaFormat, bytes: &[u8]) -> Result<(), String> {
    let valid = match format {
        MediaFormat::Png => bytes.starts_with(b"\x89PNG\r\n\x1a\n"),
        MediaFormat::Mp4 => bytes.len() >= 12 && &bytes[4..8] == b"ftyp",
        MediaFormat::Webm => bytes.starts_with(b"\x1a\x45\xdf\xa3"),
    };
    if !valid_media_size(bytes.len()) || !valid {
        return Err("빈 파일, 손상된 형식 또는 저장 용량 초과입니다.".into());
    }
    Ok(())
}
// Publish a completed file without replacing any existing destination. A sibling
// hard link is atomic on both NTFS and APFS; failures remove the temporary file.
pub fn save_media(path: &Path, format: MediaFormat, bytes: &[u8]) -> Result<(), String> {
    validate_media(format, bytes)?;
    if path.extension().and_then(|value| value.to_str()) != Some(format.extension()) {
        return Err("파일 확장자가 형식과 다릅니다.".into());
    }
    let temp = path.with_file_name(format!(".phone-mirror-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        fs::hard_link(&temp, path)?;
        Ok(())
    })();
    let _ = fs::remove_file(temp);
    result.map_err(|_| "파일을 저장할 수 없습니다. 새 파일 이름과 쓰기 권한을 확인하세요.".into())
}
