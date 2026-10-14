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

#[cfg(unix)]
#[test]
fn saved_capture_has_owner_only_permissions_in_shared_directory() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    std::fs::set_permissions(directory.path(), std::fs::Permissions::from_mode(0o777)).unwrap();
    let path = directory.path().join("private.png");
    save_media(&path, MediaFormat::Png, b"\x89PNG\r\n\x1a\nprivate screen").unwrap();
    assert_eq!(
        std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
        0o600
    );
}

#[cfg(windows)]
#[test]
fn saved_capture_has_protected_owner_only_windows_acl() {
    use std::{os::windows::ffi::OsStrExt, ptr};
    use windows_sys::Win32::{
        Foundation::LocalFree,
        Security::{
            Authorization::{GetNamedSecurityInfoW, SE_FILE_OBJECT},
            EqualSid, GetAce, GetSecurityDescriptorControl, ACCESS_ALLOWED_ACE,
            DACL_SECURITY_INFORMATION, OWNER_SECURITY_INFORMATION, SE_DACL_PROTECTED,
        },
        Storage::FileSystem::FILE_ALL_ACCESS,
        System::SystemServices::ACCESS_ALLOWED_ACE_TYPE,
    };
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("private.png");
    save_media(&path, MediaFormat::Png, b"\x89PNG\r\n\x1a\nprivate screen").unwrap();
    let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        let (mut owner, mut dacl, mut descriptor) =
            (ptr::null_mut(), ptr::null_mut(), ptr::null_mut());
        assert_eq!(
            GetNamedSecurityInfoW(
                path.as_ptr(),
                SE_FILE_OBJECT,
                DACL_SECURITY_INFORMATION | OWNER_SECURITY_INFORMATION,
                &mut owner,
                ptr::null_mut(),
                &mut dacl,
                ptr::null_mut(),
                &mut descriptor
            ),
            0
        );
        let check = || {
            let (mut control, mut revision) = (0, 0);
            assert_ne!(
                GetSecurityDescriptorControl(descriptor, &mut control, &mut revision),
                0
            );
            assert_ne!(control & SE_DACL_PROTECTED, 0);
            assert!(!dacl.is_null());
            assert_eq!((*dacl).AceCount, 1);
            let mut ace = ptr::null_mut();
            assert_ne!(GetAce(dacl, 0, &mut ace), 0);
            let ace = &*(ace as *const ACCESS_ALLOWED_ACE);
            assert_eq!(ace.Header.AceType, ACCESS_ALLOWED_ACE_TYPE as u8);
            assert_eq!(ace.Mask, FILE_ALL_ACCESS);
            assert_ne!(EqualSid(owner, ptr::addr_of!(ace.SidStart) as *mut _), 0);
        };
        let result = std::panic::catch_unwind(check);
        LocalFree(descriptor);
        result.unwrap();
    }
}

#[cfg(target_os = "macos")]
#[test]
fn saved_capture_does_not_inherit_shared_folder_acl() {
    let directory = tempfile::tempdir().unwrap();
    assert!(std::process::Command::new("/bin/chmod")
        .args([
            "+a",
            "everyone allow read,readattr,readextattr,readsecurity,file_inherit"
        ])
        .arg(directory.path())
        .status()
        .unwrap()
        .success());
    let path = directory.path().join("private.png");
    save_media(&path, MediaFormat::Png, b"\x89PNG\r\n\x1a\nprivate screen").unwrap();
    let listing = std::process::Command::new("/bin/ls")
        .arg("-le")
        .arg(path)
        .output()
        .unwrap();
    assert!(listing.status.success());
    assert!(
        !String::from_utf8(listing.stdout)
            .unwrap()
            .contains("everyone allow"),
        "private capture inherited a grant to everyone despite mode 0600"
    );
}
