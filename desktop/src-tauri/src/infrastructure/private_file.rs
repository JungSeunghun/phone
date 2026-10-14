//! Create sensitive output with owner-only access before any contents are written.
use std::{fs::File, io, path::Path};

#[cfg(unix)]
pub(crate) fn create_private_file(path: &Path) -> io::Result<File> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)?;
    if file.metadata()?.permissions().mode() & 0o077 != 0 {
        return Err(io::Error::new(
            io::ErrorKind::PermissionDenied,
            "Owner-only permissions were not applied",
        ));
    }
    Ok(file)
}

#[cfg(windows)]
pub(crate) fn create_private_file(path: &Path) -> io::Result<File> {
    use std::{
        os::windows::{ffi::OsStrExt, io::FromRawHandle},
        ptr,
    };
    use windows_sys::Win32::{
        Foundation::{CloseHandle, LocalFree, GENERIC_WRITE, INVALID_HANDLE_VALUE},
        Security::{
            Authorization::{
                ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
                SDDL_REVISION_1,
            },
            GetTokenInformation, TokenUser, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
        },
        Storage::FileSystem::{
            CreateFileW, GetVolumeInformationByHandleW, CREATE_NEW, FILE_ATTRIBUTE_NORMAL,
            FILE_READ_ATTRIBUTES,
        },
        System::{
            SystemServices::FILE_PERSISTENT_ACLS,
            Threading::{GetCurrentProcess, OpenProcessToken},
        },
    };
    let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    if path[..path.len() - 1].contains(&0) {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid file path",
        ));
    }
    // Win32 allocates descriptors and SID strings using LocalAlloc.
    struct LocalAllocation(*mut std::ffi::c_void);
    impl Drop for LocalAllocation {
        fn drop(&mut self) {
            unsafe {
                LocalFree(self.0);
            }
        }
    }
    // SAFETY: all API output buffers are sized/aligned, allocations stay alive through
    // CreateFileW, and the successful file handle is transferred exactly once to File.
    unsafe {
        let mut token = ptr::null_mut();
        if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
            return Err(io::Error::last_os_error());
        }
        let result = (|| {
            let mut size = 0;
            GetTokenInformation(token, TokenUser, ptr::null_mut(), 0, &mut size);
            if size == 0 {
                return Err(io::Error::last_os_error());
            }
            let mut user = vec![0usize; (size as usize).div_ceil(std::mem::size_of::<usize>())];
            if GetTokenInformation(token, TokenUser, user.as_mut_ptr().cast(), size, &mut size) == 0
            {
                return Err(io::Error::last_os_error());
            }
            let mut sid = ptr::null_mut();
            if ConvertSidToStringSidW((*(user.as_ptr() as *const TOKEN_USER)).User.Sid, &mut sid)
                == 0
            {
                return Err(io::Error::last_os_error());
            }
            let _sid_allocation = LocalAllocation(sid.cast());
            let mut length = 0;
            while *sid.add(length) != 0 {
                length += 1;
            }
            let sid = String::from_utf16(std::slice::from_raw_parts(sid, length))
                .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "Invalid owner SID"))?;
            // Explicit owner and protected DACL: do not inherit shared-folder grants.
            let sddl: Vec<u16> = format!("O:{sid}D:P(A;;FA;;;{sid})")
                .encode_utf16()
                .chain(Some(0))
                .collect();
            let mut descriptor = ptr::null_mut();
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut descriptor,
                ptr::null_mut(),
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }
            let _descriptor_allocation = LocalAllocation(descriptor);
            let attributes = SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: descriptor,
                bInheritHandle: 0,
            };
            let handle = CreateFileW(
                path.as_ptr(),
                GENERIC_WRITE | FILE_READ_ATTRIBUTES,
                0,
                &attributes,
                CREATE_NEW,
                FILE_ATTRIBUTE_NORMAL,
                ptr::null_mut(),
            );
            if handle == INVALID_HANDLE_VALUE {
                return Err(io::Error::last_os_error());
            }
            let file = File::from_raw_handle(handle);
            let mut flags = 0;
            if GetVolumeInformationByHandleW(
                handle,
                ptr::null_mut(),
                0,
                ptr::null_mut(),
                ptr::null_mut(),
                &mut flags,
                ptr::null_mut(),
                0,
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }
            if flags & FILE_PERSISTENT_ACLS == 0 {
                return Err(io::Error::new(
                    io::ErrorKind::Unsupported,
                    "The destination cannot enforce private file permissions",
                ));
            }
            Ok(file)
        })();
        CloseHandle(token);
        result
    }
}

#[cfg(not(any(unix, windows)))]
pub(crate) fn create_private_file(_: &Path) -> io::Result<File> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Private file permissions are unsupported",
    ))
}
