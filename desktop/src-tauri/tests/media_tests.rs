use phone_mirror_desktop::media::{save_media, validate_media, MediaFormat};
#[test]
fn media_boundaries_and_format_validation() {
    assert!(validate_media(MediaFormat::Png, &[]).is_err());
    assert!(validate_media(MediaFormat::Png, b"not png").is_err());
    assert!(validate_media(MediaFormat::Png, b"\x89PNG\r\n\x1a\nrest").is_ok());
    assert!(validate_media(MediaFormat::Mp4, b"\0\0\0\x18ftypisom").is_ok());
    assert!(validate_media(MediaFormat::Webm, b"\x1a\x45\xdf\xa3rest").is_ok());
    assert!(validate_media(MediaFormat::Webm, b"\x1a\x45\xdf").is_err());
    assert!(MediaFormat::parse("../../png").is_err());
}
#[test]
fn save_is_atomic_and_does_not_overwrite_or_leave_partial_files() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("shot.png");
    let png = b"\x89PNG\r\n\x1a\nrest";
    save_media(&path, MediaFormat::Png, png).unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), png);
    assert!(save_media(&path, MediaFormat::Png, png).is_err());
    assert!(save_media(&dir.path().join("bad.png"), MediaFormat::Png, b"bad").is_err());
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    assert!(save_media(&dir.path().join("wrong.mp4"), MediaFormat::Png, png).is_err());
}

#[test]
fn media_size_checks_exact_boundaries_without_allocating_large_buffers() {
    use phone_mirror_desktop::media::{valid_media_size, MEDIA_BYTE_LIMIT};
    assert!(!valid_media_size(0));
    assert!(valid_media_size(1));
    assert!(valid_media_size(MEDIA_BYTE_LIMIT));
    assert!(!valid_media_size(MEDIA_BYTE_LIMIT + 1));
    assert!(!valid_media_size(usize::MAX));
}
