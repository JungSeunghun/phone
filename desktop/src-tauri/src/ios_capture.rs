//! Native platform boundary. Blocking capture owns all callbacks until it returns.
use crate::{
    domain::*,
    infrastructure::{AudioPacketSink, VideoPacketSink},
};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

pub fn discover_ios_devices() -> Result<Vec<PhoneDevice>, String> {
    #[cfg(target_os = "macos")]
    {
        native::discover()
    }
    #[cfg(not(target_os = "macos"))]
    {
        Err("iPhone USB 화면 수신은 macOS에서 지원합니다.".into())
    }
}
pub trait IosCapturePort: Send + Sync {
    fn discover(&self) -> Result<Vec<PhoneDevice>, String>;
    fn run(
        &self,
        identifier: &str,
        settings: &MirrorSettings,
        sink: Arc<dyn VideoPacketSink>,
        cancellation: CancellationToken,
    ) -> Result<(), String>;
    fn run_with_audio(
        &self,
        identifier: &str,
        settings: &MirrorSettings,
        sink: Arc<dyn VideoPacketSink>,
        audio: Arc<dyn AudioPacketSink>,
        cancellation: CancellationToken,
    ) -> Result<(), String> {
        audio.status("이 화면 수신 어댑터는 소리를 지원하지 않습니다.");
        self.run(identifier, settings, sink, cancellation)
    }
}
pub struct NativeIosCapturePort;
impl IosCapturePort for NativeIosCapturePort {
    fn discover(&self) -> Result<Vec<PhoneDevice>, String> {
        discover_ios_devices()
    }
    fn run(
        &self,
        identifier: &str,
        settings: &MirrorSettings,
        sink: Arc<dyn VideoPacketSink>,
        cancellation: CancellationToken,
    ) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            native::run(identifier, settings, sink, None, cancellation)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (identifier, settings, sink, cancellation);
            Err("iPhone USB 화면 수신은 macOS에서 지원합니다.".into())
        }
    }
    fn run_with_audio(
        &self,
        identifier: &str,
        settings: &MirrorSettings,
        sink: Arc<dyn VideoPacketSink>,
        audio: Arc<dyn AudioPacketSink>,
        cancellation: CancellationToken,
    ) -> Result<(), String> {
        #[cfg(target_os = "macos")]
        {
            native::run(identifier, settings, sink, Some(audio), cancellation)
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = (identifier, settings, sink, audio, cancellation);
            Err("iPhone USB 화면·소리 수신은 macOS에서 지원합니다.".into())
        }
    }
}
#[cfg(target_os = "macos")]
struct DiscardAudioSink;
#[cfg(target_os = "macos")]
impl AudioPacketSink for DiscardAudioSink {
    fn send(&self, _: Vec<u8>) -> Result<(), String> {
        Ok(())
    }
    fn status(&self, _: &str) {}
}
pub struct IosCaptureService {
    port: Arc<dyn IosCapturePort>,
}
impl Default for IosCaptureService {
    fn default() -> Self {
        Self::new(Arc::new(NativeIosCapturePort))
    }
}
impl IosCaptureService {
    pub fn new(port: Arc<dyn IosCapturePort>) -> Self {
        Self { port }
    }
    pub async fn discover(&self) -> Result<Vec<PhoneDevice>, String> {
        let port = self.port.clone();
        tokio::task::spawn_blocking(move || port.discover())
            .await
            .map_err(|_| "iPhone 검색 작업에 실패했습니다.")?
    }
    pub async fn run(
        &self,
        endpoint: DeviceEndpoint,
        settings: MirrorSettings,
        sink: Arc<dyn VideoPacketSink>,
        cancellation: CancellationToken,
    ) -> Result<(), String> {
        validate_usb_capture(&endpoint, &settings)?;
        if cancellation.is_cancelled() {
            return Ok(());
        }
        let port = self.port.clone();
        tokio::task::spawn_blocking(move || {
            port.run(&endpoint.identifier, &settings, sink, cancellation)
        })
        .await
        .map_err(|_| "iPhone 화면 수신 작업에 실패했습니다.")?
    }

    pub async fn run_with_audio(
        &self,
        endpoint: DeviceEndpoint,
        settings: MirrorSettings,
        sink: Arc<dyn VideoPacketSink>,
        audio: Arc<dyn AudioPacketSink>,
        cancellation: CancellationToken,
    ) -> Result<(), String> {
        validate_usb_capture(&endpoint, &settings)?;
        if cancellation.is_cancelled() {
            return Ok(());
        }
        let port = self.port.clone();
        tokio::task::spawn_blocking(move || {
            port.run_with_audio(&endpoint.identifier, &settings, sink, audio, cancellation)
        })
        .await
        .map_err(|_| "iPhone 화면 수신 작업에 실패했습니다.")?
    }
}
fn validate_usb_capture(
    endpoint: &DeviceEndpoint,
    settings: &MirrorSettings,
) -> Result<(), String> {
    settings.validate()?;
    if endpoint.transport != ConnectionTransport::Usb
        || !valid_identity(&endpoint.identifier)
        || endpoint.identifier.chars().count() > 252
    {
        return Err("유효하지 않은 iPhone USB 연결입니다.".into());
    }
    Ok(())
}
#[cfg(target_os = "macos")]
mod native {
    use super::*;
    use crate::ios::{
        forward_ios_audio_packet, forward_ios_packet, ios_audio_packet, ios_video_packet,
        parse_ios_devices,
    };
    use std::{
        ffi::{c_char, c_void, CStr, CString},
        sync::Mutex,
    };
    type PacketCallback =
        unsafe extern "C" fn(*mut c_void, *const u8, usize, u64, bool, bool) -> bool;
    type AudioCallback = unsafe extern "C" fn(*mut c_void, *const u8, usize, u64) -> bool;
    type AudioStatusCallback = unsafe extern "C" fn(*mut c_void, *const c_char);
    type StopCallback = unsafe extern "C" fn(*mut c_void) -> bool;
    extern "C" {
        fn phone_ios_discover() -> *mut c_char;
        fn phone_ios_free(value: *mut c_char);
        fn phone_ios_run(
            identifier: *const c_char,
            dimension: u32,
            fps: u32,
            packet: PacketCallback,
            audio: Option<AudioCallback>,
            audio_status: Option<AudioStatusCallback>,
            stop: StopCallback,
            context: *mut c_void,
        ) -> *mut c_char;
        fn phone_ios_verify(
            packet: PacketCallback,
            stop: StopCallback,
            context: *mut c_void,
        ) -> *mut c_char;
        fn phone_ios_verify_media(
            packet: PacketCallback,
            audio: AudioCallback,
            stop: StopCallback,
            context: *mut c_void,
        ) -> *mut c_char;

    }
    struct CaptureContext {
        sink: Arc<dyn VideoPacketSink>,
        cancellation: CancellationToken,
        audio: Arc<dyn AudioPacketSink>,
        error: Mutex<Option<String>>,
    }
    unsafe extern "C" fn stopped(context: *mut c_void) -> bool {
        let c = &*(context as *const CaptureContext);
        c.cancellation.is_cancelled() || c.error.lock().unwrap().is_some()
    }
    unsafe extern "C" fn packet(
        context: *mut c_void,
        bytes: *const u8,
        length: usize,
        timestamp: u64,
        configuration: bool,
        key: bool,
    ) -> bool {
        let c = &*(context as *const CaptureContext);
        if stopped(context) {
            return false;
        }
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if bytes.is_null() || length == 0 || length > MAX_VIDEO_PACKET_SIZE {
                return Err("잘못된 네이티브 영상 데이터입니다.".into());
            }
            let p = ios_video_packet(
                std::slice::from_raw_parts(bytes, length),
                timestamp,
                configuration,
                key,
            )?;
            forward_ios_packet(&p, c.sink.as_ref(), &c.cancellation)
        }))
        .unwrap_or_else(|_| Err("iPhone 영상 전달에 실패했습니다.".into()));
        match result {
            Ok(()) => true,
            Err(e) => {
                *c.error.lock().unwrap() = Some(e);
                false
            }
        }
    }

    unsafe extern "C" fn audio_packet(
        context: *mut c_void,
        bytes: *const u8,
        length: usize,
        timestamp: u64,
    ) -> bool {
        let c = &*(context as *const CaptureContext);
        if stopped(context) {
            return false;
        }
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if bytes.is_null() || length == 0 || length > 4096 {
                return Err("잘못된 네이티브 오디오 데이터입니다.".into());
            }
            let packet = ios_audio_packet(std::slice::from_raw_parts(bytes, length), timestamp)?;
            forward_ios_audio_packet(&packet, c.audio.as_ref(), &c.cancellation)
        }))
        .unwrap_or_else(|_| Err("iPhone 소리 전달에 실패했습니다.".into()));
        match result {
            Ok(()) => true,
            Err(error) => {
                *c.error.lock().unwrap() = Some(error);
                false
            }
        }
    }
    unsafe extern "C" fn audio_status(context: *mut c_void, message: *const c_char) {
        let c = &*(context as *const CaptureContext);
        if !stopped(context) && !message.is_null() {
            let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                c.audio.status(&CStr::from_ptr(message).to_string_lossy())
            }));
        }
    }
    unsafe fn take_string(value: *mut c_char) -> Option<String> {
        if value.is_null() {
            return None;
        }
        let text = CStr::from_ptr(value).to_string_lossy().into_owned();
        phone_ios_free(value);
        Some(text)
    }
    pub fn discover() -> Result<Vec<PhoneDevice>, String> {
        let json =
            unsafe { take_string(phone_ios_discover()) }.ok_or("iPhone 검색에 실패했습니다.")?;
        parse_ios_devices(&json)
    }
    pub fn run(
        identifier: &str,
        settings: &MirrorSettings,
        sink: Arc<dyn VideoPacketSink>,
        audio: Option<Arc<dyn AudioPacketSink>>,
        cancellation: CancellationToken,
    ) -> Result<(), String> {
        let identifier =
            CString::new(identifier).map_err(|_| "유효하지 않은 iPhone 식별자입니다.")?;
        let receives_audio = audio.is_some();
        let mut context = CaptureContext {
            sink,
            audio: audio.unwrap_or_else(|| Arc::new(DiscardAudioSink)),
            cancellation,
            error: Mutex::new(None),
        };
        let error = unsafe {
            take_string(phone_ios_run(
                identifier.as_ptr(),
                settings.video_max_dimension,
                settings.video_max_frame_rate,
                packet,
                receives_audio.then_some(audio_packet),
                receives_audio.then_some(audio_status),
                stopped,
                &mut context as *mut _ as *mut c_void,
            ))
        };
        finish(context, error)
    }
    fn finish(context: CaptureContext, error: Option<String>) -> Result<(), String> {
        if context.cancellation.is_cancelled() {
            return Ok(());
        }
        match context.error.into_inner().unwrap().or(error) {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }
    /// Short synthetic pixel-buffer check of the same native H.264 encoder; no iPhone.
    pub fn verify(
        sink: Arc<dyn VideoPacketSink>,
        cancellation: CancellationToken,
    ) -> Result<(), String> {
        let mut context = CaptureContext {
            sink,
            audio: Arc::new(DiscardAudioSink),
            cancellation,
            error: Mutex::new(None),
        };
        let error = unsafe {
            take_string(phone_ios_verify(
                packet,
                stopped,
                &mut context as *mut _ as *mut c_void,
            ))
        };
        finish(context, error)
    }
    pub fn verify_media(
        sink: Arc<dyn VideoPacketSink>,
        audio: Arc<dyn AudioPacketSink>,
        cancellation: CancellationToken,
    ) -> Result<(), String> {
        let mut context = CaptureContext {
            sink,
            audio,
            cancellation,
            error: Mutex::new(None),
        };
        let error = unsafe {
            take_string(phone_ios_verify_media(
                packet,
                audio_packet,
                stopped,
                &mut context as *mut _ as *mut c_void,
            ))
        };
        finish(context, error)
    }
}
#[cfg(target_os = "macos")]
pub fn verify_native_encoder(
    sink: Arc<dyn VideoPacketSink>,
    cancellation: CancellationToken,
) -> Result<(), String> {
    native::verify(sink, cancellation)
}

#[cfg(target_os = "macos")]
pub fn verify_native_media(
    sink: Arc<dyn VideoPacketSink>,
    audio: Arc<dyn AudioPacketSink>,
    cancellation: CancellationToken,
) -> Result<(), String> {
    native::verify_media(sink, audio, cancellation)
}
