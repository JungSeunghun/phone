use crate::{
    application::{ControlSession, SessionRegistry},
    domain::*,
    infrastructure::*,
};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    ipc::{Channel, InvokeResponseBody},
    Emitter, Manager, State,
};
use tokio_util::sync::CancellationToken;

struct DesktopServices {
    discovery: AdbDeviceDiscovery,
    wireless: AdbWirelessConnectionService,
    android_qr: crate::android_qr::AndroidQrPairingService,
    stream: AndroidStreamService,
    ios_capture: crate::ios_capture::IosCaptureService,
    ios_wifi: Arc<crate::ios_wifi::IosWifiReceiverService>,
    ios_usb: Arc<crate::ios_usb::IosUsbReceiverService>,
    ios_keyboard: crate::ios_keyboard::IosKeyboardInputService,
    diagnostics: crate::connection_diagnostics::ConnectionDiagnosticsService,
    sessions: Mutex<SessionRegistry>,
    controls: Mutex<std::collections::HashMap<String, ControlSession>>,
    recordings: Mutex<std::collections::HashMap<String, Arc<crate::recording::RecordingSession>>>,
    completed_recordings: crate::recording::CompletedRecordingStore,
    tasks: Mutex<Vec<tauri::async_runtime::JoinHandle<()>>>,
}
pub(crate) struct DesktopState {
    services: Result<Arc<DesktopServices>, String>,
    closing: AtomicBool,
    media_operations: AtomicUsize,
    updating: AtomicBool,
    shutdown: crate::shutdown::ShutdownCoordinator,
    window_presentation: Mutex<crate::window_presentation::WindowPresentation>,
}
impl DesktopState {
    pub(crate) fn begin_update(&self) -> Result<(), String> {
        let services = self.services()?;
        let sessions = services.sessions.lock().unwrap();
        crate::application_update::UpdateActivity {
            active_session: sessions.is_active(),
            media_operations: self.media_operations.load(Ordering::SeqCst),
            pending_recordings: services.completed_recordings.has_pending()
                || services
                    .recordings
                    .lock()
                    .unwrap()
                    .values()
                    .any(|recording| recording.has_job()),
            background_tasks: services
                .tasks
                .lock()
                .unwrap()
                .iter()
                .any(|task| !task.inner().is_finished()),
            closing: self.closing.load(Ordering::SeqCst),
        }
        .validate_installation()?;
        self.closing
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "앱을 종료하거나 업데이트하고 있습니다.".to_string())?;
        self.updating.store(true, Ordering::SeqCst);
        Ok(())
    }
    fn begin_media_operation(&self) -> Result<MediaOperation<'_>, String> {
        let services = self.services()?;
        let _sessions = services.sessions.lock().unwrap();
        if self.updating.load(Ordering::SeqCst) || self.shutdown.is_committing() {
            return Err("앱을 종료하거나 업데이트하고 있습니다.".into());
        }
        self.media_operations.fetch_add(1, Ordering::SeqCst);
        Ok(MediaOperation(&self.media_operations))
    }
    pub(crate) fn end_update(&self) {
        self.updating.store(false, Ordering::SeqCst);
        self.closing.store(false, Ordering::SeqCst);
    }

    fn should_prevent_exit_request(&self) -> bool {
        // A quit request begins cleanup; only the final reservation permits exit.
        !self.updating.load(Ordering::SeqCst) && !self.shutdown.is_committing()
    }

    fn services(&self) -> Result<Arc<DesktopServices>, String> {
        self.services.clone()
    }
}
struct MediaOperation<'a>(&'a AtomicUsize);
impl Drop for MediaOperation<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionStatus {
    phase: &'static str,
    message: String,
}
struct ChannelVideoPacketSink {
    packets: Channel<InvokeResponseBody>,
    recording: Arc<crate::recording::RecordingSession>,
}
impl VideoPacketSink for ChannelVideoPacketSink {
    fn send(&self, bytes: Vec<u8>) -> Result<(), String> {
        self.recording.push(&bytes);
        self.packets
            .send(InvokeResponseBody::Raw(bytes))
            .map_err(|_| "영상 표시 창이 닫혔습니다.".into())
    }
}

struct ChannelAudioPacketSink {
    recording: Arc<crate::recording::RecordingSession>,
    packets: Channel<InvokeResponseBody>,
    status: Channel<String>,
}
impl AudioPacketSink for ChannelAudioPacketSink {
    fn send(&self, bytes: Vec<u8>) -> Result<(), String> {
        self.recording.push_audio(&bytes);
        self.packets
            .send(InvokeResponseBody::Raw(bytes))
            .map_err(|_| "소리 재생 창이 닫혔습니다.".into())
    }
    fn status(&self, message: &str) {
        self.status.send(message.into()).ok();
    }
}
#[tauri::command]
async fn set_window_view_mode(
    window: tauri::WebviewWindow,
    mode: crate::window_presentation::WindowViewMode,
    dimensions: Option<(u32, u32)>,
) -> Result<crate::window_presentation::WindowViewMode, String> {
    // macOS Spaces transitions finish asynchronously. Leave native fullscreen
    // before applying normal/PiP geometry, without blocking the UI thread.
    if mode != crate::window_presentation::WindowViewMode::Fullscreen
        && window.is_fullscreen().map_err(|error| error.to_string())?
    {
        window
            .set_fullscreen(false)
            .map_err(|error| error.to_string())?;
        wait_for_native_fullscreen(&window, false).await?;
    }
    let transition_window = window.clone();
    let result = tauri::async_runtime::spawn_blocking(move || {
        let app = window.app_handle().clone();
        let state = app.state::<DesktopState>();
        if state.closing.load(Ordering::SeqCst) {
            return Err("앱을 종료하고 있습니다.".into());
        }
        let mut presentation = state.window_presentation.lock().unwrap();
        let result = presentation.set_mode(
            &crate::window_presentation_adapter::TauriWindowPresentationPort(window.clone()),
            mode,
            dimensions,
        );
        window.emit("window-view-mode", presentation.mode()).ok();
        result
    })
    .await
    .map_err(|_| "창 표시 작업에 실패했습니다.".to_string())??;
    if mode == crate::window_presentation::WindowViewMode::Fullscreen {
        wait_for_native_fullscreen(&transition_window, true).await?;
    }
    Ok(result)
}
async fn wait_for_native_fullscreen(
    window: &tauri::WebviewWindow,
    expected: bool,
) -> Result<(), String> {
    crate::window_presentation::await_fullscreen_transition(
        &crate::window_presentation_adapter::TauriFullscreenTransitionPort {
            window: window.clone(),
            started: tokio::time::Instant::now(),
        },
        expected,
        Duration::from_secs(2),
    )
    .await
}
pub(crate) fn window_is_closing(window: &tauri::WebviewWindow) -> bool {
    window
        .app_handle()
        .state::<DesktopState>()
        .closing
        .load(Ordering::SeqCst)
}

fn observe_native_window(window: &tauri::WebviewWindow) {
    use crate::window_presentation::WindowPresentationPort;
    let Some(state) = window.app_handle().try_state::<DesktopState>() else {
        return;
    };
    if state.closing.load(Ordering::SeqCst) {
        return;
    }
    let Ok(mut presentation) = state.window_presentation.try_lock() else {
        return;
    };
    let Ok(fullscreen) = window.is_fullscreen() else {
        return;
    };
    let snapshot = if !fullscreen
        && presentation.mode() == crate::window_presentation::WindowViewMode::Normal
    {
        crate::window_presentation_adapter::TauriWindowPresentationPort(window.clone())
            .snapshot()
            .ok()
    } else {
        None
    };
    if let Ok(true) = presentation.observe_native_fullscreen(fullscreen, snapshot) {
        window.emit("window-view-mode", presentation.mode()).ok();
    }
}
#[tauri::command]
async fn read_clipboard_text() -> Result<String, String> {
    tokio::task::spawn_blocking(|| {
        let mut clipboard = arboard::Clipboard::new().map_err(|_| "클립보드를 열 수 없습니다.")?;
        let text = clipboard
            .get_text()
            .map_err(|_| "클립보드에 읽을 수 있는 텍스트가 없습니다.")?;
        crate::interaction::validate_phone_text(&text)?;
        Ok(text)
    })
    .await
    .map_err(|_| "클립보드를 읽을 수 없습니다.".to_string())?
}
#[tauri::command]
fn send_control(
    state: State<'_, DesktopState>,
    session_id: String,
    input: crate::interaction::ControlInput,
) -> Result<(), String> {
    let services = state.services()?;
    let controls = services.controls.lock().unwrap();
    controls
        .get(&session_id)
        .ok_or("폰 입력 세션이 종료됐습니다.")?
        .send(&input)
}

#[tauri::command]
async fn start_ios_keyboard_input(
    state: State<'_, DesktopState>,
    target_id: String,
) -> Result<crate::ios_keyboard::KeyboardReceiverInfo, String> {
    if state.closing.load(Ordering::SeqCst) {
        return Err("앱이 종료 중입니다.".into());
    }
    state.services()?.ios_keyboard.start(target_id).await
}
#[tauri::command]
async fn ios_keyboard_input_status(
    state: State<'_, DesktopState>,
    receiver_id: String,
) -> Result<serde_json::Value, String> {
    let services = state.services()?;
    Ok(
        serde_json::json!({"connected": services.ios_keyboard.status(&receiver_id).await?, "generation": services.ios_keyboard.generation(&receiver_id).await?.to_string()}),
    )
}
#[tauri::command]
async fn send_ios_keyboard_input(
    state: State<'_, DesktopState>,
    receiver_id: String,
    input: crate::interaction::ControlInput,
    generation: String,
) -> Result<(), String> {
    state
        .services()?
        .ios_keyboard
        .send_for_generation(
            &receiver_id,
            input,
            generation
                .parse()
                .map_err(|_| "잘못된 키보드 연결입니다.")?,
        )
        .await
}
#[tauri::command]
async fn stop_ios_keyboard_input(
    state: State<'_, DesktopState>,
    receiver_id: String,
) -> Result<(), String> {
    state.services()?.ios_keyboard.stop(&receiver_id).await
}

async fn discover_all_devices(
    services: &DesktopServices,
    cancellation: CancellationToken,
) -> Result<Vec<PhoneDevice>, String> {
    let android = services.discovery.discover(cancellation.clone());
    let ios = services.ios_capture.discover();
    let (android, ios) = tokio::join!(android, ios);
    if cancellation.is_cancelled() {
        return Err("기기 검색을 취소했습니다.".into());
    }
    let mut wifi = services.ios_wifi.discover().await;
    wifi.extend(services.ios_usb.discover().await);
    crate::ios::merge_device_results(crate::ios::merge_device_results(android, ios), Ok(wifi))
}
#[tauri::command]
async fn start_ios_usb_receiver(
    state: State<'_, DesktopState>,
) -> Result<crate::ios_wifi::ReceiverInfo, String> {
    if state.closing.load(Ordering::SeqCst) {
        return Err("앱을 종료하고 있습니다.".into());
    }
    #[cfg(target_os = "windows")]
    {
        state.services()?.ios_usb.start().await
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Windows USB 송출 수신 기능입니다. Mac은 기존 iPhone USB 수신을 사용하세요.".into())
    }
}
#[tauri::command]
async fn stop_ios_usb_receiver(
    state: State<'_, DesktopState>,
    receiver_id: String,
) -> Result<(), String> {
    state.services()?.ios_usb.stop(&receiver_id).await
}
#[tauri::command]
async fn start_ios_wifi_receiver(
    state: State<'_, DesktopState>,
) -> Result<crate::ios_wifi::ReceiverInfo, String> {
    if state.closing.load(Ordering::SeqCst) {
        return Err("앱을 종료하고 있습니다.".into());
    }
    state.services()?.ios_wifi.start().await
}
#[tauri::command]
async fn stop_ios_wifi_receiver(
    state: State<'_, DesktopState>,
    receiver_id: String,
) -> Result<(), String> {
    state.services()?.ios_wifi.stop(&receiver_id).await
}
#[tauri::command]
async fn run_connection_diagnostics(
    state: State<'_, DesktopState>,
    diagnostic_id: String,
    request: crate::connection_diagnostics::DiagnosticRequest,
) -> Result<crate::connection_diagnostics::DiagnosticReport, String> {
    if state.closing.load(Ordering::SeqCst) {
        return Err("앱을 종료하고 있습니다.".into());
    }
    state
        .services()?
        .diagnostics
        .run(&diagnostic_id, request)
        .await
}
#[tauri::command]
async fn cancel_connection_diagnostics(
    state: State<'_, DesktopState>,
    diagnostic_id: String,
) -> Result<(), String> {
    state.services()?.diagnostics.cancel(&diagnostic_id).await
}
#[tauri::command]
async fn discover_devices(state: State<'_, DesktopState>) -> Result<Vec<PhoneDevice>, String> {
    let services = state.services()?;
    discover_all_devices(&services, CancellationToken::new()).await
}
#[tauri::command]
async fn start_android_qr_pairing(
    state: State<'_, DesktopState>,
) -> Result<crate::android_qr::AndroidQrPairingInfo, String> {
    if state.closing.load(Ordering::SeqCst) {
        return Err("앱을 종료하고 있습니다.".into());
    }
    state.services()?.android_qr.start().await
}
#[tauri::command]
async fn wait_android_qr_pairing(
    state: State<'_, DesktopState>,
    session_id: String,
) -> Result<crate::android_qr::AndroidQrPairingResult, String> {
    state.services()?.android_qr.wait(&session_id).await
}
#[tauri::command]
async fn cancel_android_qr_pairing(
    state: State<'_, DesktopState>,
    session_id: String,
) -> Result<(), String> {
    state.services()?.android_qr.cancel(&session_id).await
}
#[tauri::command]
async fn discover_services(state: State<'_, DesktopState>) -> Result<Vec<WirelessService>, String> {
    state
        .services()?
        .wireless
        .discover(CancellationToken::new())
        .await
}
#[tauri::command]
async fn pair_device(
    state: State<'_, DesktopState>,
    address: String,
    code: String,
) -> Result<(), String> {
    state
        .services()?
        .wireless
        .pair(&address, &code, CancellationToken::new())
        .await
}
#[tauri::command]
async fn connect_device(state: State<'_, DesktopState>, address: String) -> Result<(), String> {
    state
        .services()?
        .wireless
        .connect(&address, CancellationToken::new())
        .await
}
#[tauri::command]
fn start_session(
    state: State<'_, DesktopState>,
    request: SessionRequest,
    on_packet: Channel<InvokeResponseBody>,
    on_status: Channel<SessionStatus>,
    on_audio: Channel<InvokeResponseBody>,
    on_audio_status: Channel<String>,
) -> Result<(), String> {
    request.validate()?;
    if state.closing.load(Ordering::SeqCst) {
        return Err("앱을 종료하고 있습니다.".into());
    }
    let services = state.services()?;
    let cancellation = {
        let mut sessions = services.sessions.lock().unwrap();
        if state.closing.load(Ordering::SeqCst) {
            return Err("앱을 종료하거나 업데이트하고 있습니다.".into());
        }
        sessions.start(&request.session_id)?
    };
    let (control_session, control_receiver) = ControlSession::new(cancellation.clone());
    if !crate::ios::is_ios_target(&request.target) {
        services
            .controls
            .lock()
            .unwrap()
            .insert(request.session_id.clone(), control_session);
    }
    let recording = Arc::new(crate::recording::RecordingSession::default());
    services
        .recordings
        .lock()
        .unwrap()
        .insert(request.session_id.clone(), recording.clone());
    let worker_services = services.clone();
    let task = tauri::async_runtime::spawn(async move {
        on_status
            .send(SessionStatus {
                phase: "connecting",
                message: "선택한 연결 방식으로 같은 폰을 확인하고 있습니다.".into(),
            })
            .ok();
        let operation = async {
            let devices = discover_all_devices(&worker_services, cancellation.clone()).await?;
            let device = devices
                .into_iter()
                .find(|device| {
                    device.target() == request.target
                        && device.availability == DeviceAvailability::Ready
                })
                .ok_or("선택한 폰이 연결되어 있지 않습니다.")?;
            on_status
                .send(SessionStatus {
                    phase: "streaming",
                    message: "영상 채널을 연결하고 첫 프레임을 기다리고 있습니다.".into(),
                })
                .ok();
            let video: Arc<dyn VideoPacketSink> = Arc::new(ChannelVideoPacketSink {
                packets: on_packet,
                recording: recording.clone(),
            });
            if device.platform == PhonePlatform::Ios && device.identity.starts_with("ios-usb:") {
                worker_services
                    .ios_usb
                    .run(
                        &device.identity,
                        video,
                        Arc::new(ChannelAudioPacketSink {
                            recording: recording.clone(),
                            packets: on_audio,
                            status: on_audio_status,
                        }),
                        cancellation.clone(),
                    )
                    .await
            } else if device.platform == PhonePlatform::Ios
                && device.endpoint.transport == ConnectionTransport::Wifi
            {
                if !device.capabilities.audio {
                    on_audio_status
                        .send("iPhone 송출 앱에서 소리를 켜주세요.".into())
                        .ok();
                }
                worker_services
                    .ios_wifi
                    .run(
                        &device.identity,
                        video,
                        Arc::new(ChannelAudioPacketSink {
                            recording: recording.clone(),
                            packets: on_audio,
                            status: on_audio_status,
                        }),
                        cancellation.clone(),
                    )
                    .await
            } else if device.platform == PhonePlatform::Ios {
                worker_services
                    .ios_capture
                    .run_with_audio(
                        device.endpoint,
                        request.settings.clone(),
                        video,
                        Arc::new(ChannelAudioPacketSink {
                            recording: recording.clone(),
                            packets: on_audio,
                            status: on_audio_status,
                        }),
                        cancellation.clone(),
                    )
                    .await
            } else {
                worker_services
                    .stream
                    .run_interactive(
                        &device.endpoint,
                        &request.settings,
                        video,
                        StreamInteraction {
                            audio: Arc::new(ChannelAudioPacketSink {
                                recording: recording.clone(),
                                packets: on_audio,
                                status: on_audio_status,
                            }),
                            control: control_receiver,
                        },
                        cancellation.clone(),
                    )
                    .await
            }
        };
        // The stream owns cancellation and must finish resource cleanup before
        // this worker completes. Dropping its future could leak ADB forwards.
        let result = operation.await;
        recording.close();
        if !recording.has_job() {
            worker_services
                .recordings
                .lock()
                .unwrap()
                .remove(&request.session_id);
        }
        if !cancellation.is_cancelled() {
            let status = match result {
                Ok(()) => SessionStatus {
                    phase: "stopped",
                    message: "연결을 종료했습니다.".into(),
                },
                Err(message) => SessionStatus {
                    phase: "failed",
                    message,
                },
            };
            on_status.send(status).ok();
        }
        worker_services
            .controls
            .lock()
            .unwrap()
            .remove(&request.session_id);
        worker_services
            .sessions
            .lock()
            .unwrap()
            .stop(&request.session_id);
    });
    let mut tasks = services.tasks.lock().unwrap();
    tasks.retain(|task| !task.inner().is_finished());
    tasks.push(task);
    Ok(())
}
#[tauri::command]
fn stop_session(state: State<'_, DesktopState>, session_id: String) -> Result<(), String> {
    uuid::Uuid::parse_str(&session_id).map_err(|_| "유효하지 않은 세션입니다.")?;
    let services = state.services()?;
    services.sessions.lock().unwrap().stop(&session_id);
    services.controls.lock().unwrap().remove(&session_id);
    Ok(())
}
#[tauri::command]
async fn save_media_capture(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    request: tauri::ipc::Request<'_>,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let _operation = state.begin_media_operation()?;
    let format = crate::media::MediaFormat::parse(
        request
            .headers()
            .get("x-media-format")
            .and_then(|value| value.to_str().ok())
            .unwrap_or(""),
    )?;
    let bytes = match request.body() {
        tauri::ipc::InvokeBody::Raw(bytes) => bytes.clone(),
        _ => return Err("바이너리 파일 데이터가 필요합니다.".into()),
    };
    crate::media::validate_media(format, &bytes)?;
    tauri::async_runtime::spawn_blocking(move || {
        let name = format!(
            "Phone Mirror {}.{}",
            uuid::Uuid::new_v4(),
            format.extension()
        );
        let path = app
            .dialog()
            .file()
            .add_filter("Phone Mirror", &[format.extension()])
            .set_file_name(name)
            .blocking_save_file();
        let Some(path) = path else {
            return Ok(None);
        };
        let path = path
            .into_path()
            .map_err(|_| "저장 경로를 확인할 수 없습니다.")?;
        crate::media::save_media(&path, format, &bytes)?;
        Ok(Some(path.to_string_lossy().into_owned()))
    })
    .await
    .map_err(|_| "파일 저장 작업에 실패했습니다.".to_string())?
}
#[tauri::command]
fn start_native_recording(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    session_id: String,
    width: u16,
    height: u16,
    fps: u32,
    include_audio: Option<bool>,
) -> Result<String, String> {
    if state.closing.load(Ordering::SeqCst) {
        return Err("앱을 종료하고 있습니다.".into());
    }
    let services = state.services()?;
    let _sessions = services.sessions.lock().unwrap();
    if state.closing.load(Ordering::SeqCst) {
        return Err("앱을 업데이트하고 있습니다.".into());
    }
    let recording = services
        .recordings
        .lock()
        .unwrap()
        .get(&session_id)
        .cloned()
        .ok_or("영상 세션이 없습니다.")?;
    let directory = app
        .path()
        .app_cache_dir()
        .map_err(|_| "캐시 경로가 없습니다.")?
        .join("recordings");
    recording.start_with_audio(
        &directory,
        width,
        height,
        fps,
        include_audio.unwrap_or(false),
    )
}
#[tauri::command]
fn set_native_recording_paused(
    state: State<'_, DesktopState>,
    session_id: String,
    recording_id: String,
    paused: bool,
) -> Result<(), String> {
    let recording = state
        .services()?
        .recordings
        .lock()
        .unwrap()
        .get(&session_id)
        .cloned()
        .ok_or("녹화 세션이 없습니다.")?;
    recording.set_paused(&recording_id, paused)
}
#[tauri::command]
fn native_recording_running(
    state: State<'_, DesktopState>,
    session_id: String,
    recording_id: String,
) -> Result<bool, String> {
    Ok(state
        .services()?
        .recordings
        .lock()
        .unwrap()
        .get(&session_id)
        .is_some_and(|session| session.is_running(&recording_id)))
}
#[tauri::command]
async fn finish_native_recording(
    state: State<'_, DesktopState>,
    session_id: String,
    recording_id: String,
) -> Result<String, String> {
    let _operation = state.begin_media_operation()?;
    let services = state.services()?;
    let recording = services
        .recordings
        .lock()
        .unwrap()
        .get(&session_id)
        .cloned()
        .ok_or("녹화 세션이 없습니다.")?;
    tauri::async_runtime::spawn_blocking(move || {
        let result = recording.finish(&recording_id);
        if recording.is_closed() && !recording.has_job() {
            services.recordings.lock().unwrap().remove(&session_id);
        }
        let file = result?;
        let token = uuid::Uuid::new_v4().to_string();
        services.completed_recordings.insert(token.clone(), file);
        Ok(token)
    })
    .await
    .map_err(|_| "녹화 종료 작업에 실패했습니다.".to_string())?
}
#[tauri::command]
async fn save_native_recording(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    recording_id: String,
) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let _operation = state.begin_media_operation()?;
    let services = state.services()?;
    tauri::async_runtime::spawn_blocking(move || {
        services.completed_recordings.save(&recording_id, |file| {
            let path = app
                .dialog()
                .file()
                .add_filter("Phone Mirror", &["mp4"])
                .set_file_name(format!("Phone Mirror {}.mp4", uuid::Uuid::new_v4()))
                .blocking_save_file();
            let Some(path) = path else {
                return Ok(None);
            };
            let path = path.into_path().map_err(|_| "저장 경로가 없습니다.")?;
            file.publish(&path)?;
            Ok(Some(path.to_string_lossy().into_owned()))
        })
    })
    .await
    .map_err(|_| "녹화 저장 작업에 실패했습니다.".to_string())?
}
#[tauri::command]
async fn save_diagnostic_summary(
    app: tauri::AppHandle,
    state: State<'_, DesktopState>,
    summary: crate::diagnostic_summary::DiagnosticSummary,
) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let _operation = state.begin_media_operation()?;
    let version = app.package_info().version.to_string();
    summary.serialize(&version)?;
    tauri::async_runtime::spawn_blocking(move || {
        let Some(path) = app
            .dialog()
            .file()
            .add_filter("Diagnostic summary", &["json"])
            .set_file_name("phone-mirror-diagnostic-summary.json")
            .blocking_save_file()
        else {
            return Ok(false);
        };
        let path = path.into_path().map_err(|_| "저장 경로가 없습니다.")?;
        summary.save(&version, &path)?;
        Ok(true)
    })
    .await
    .map_err(|_| "진단 요약 저장 작업에 실패했습니다.".to_string())?
}
#[tauri::command]
fn finish_media_shutdown(
    state: State<'_, DesktopState>,
    shutdown_id: String,
    allow_exit: bool,
) -> bool {
    state.shutdown.respond(&shutdown_id, allow_exit)
}
fn shutdown(app: &tauri::AppHandle) {
    let state = app.state::<DesktopState>();
    if state.closing.swap(true, Ordering::SeqCst) {
        return;
    }
    let Some(attempt) = state.shutdown.begin() else {
        return;
    };
    if let Ok(services) = state.services() {
        services.sessions.lock().unwrap().stop_all();
    }
    let app = app.clone();
    app.emit("media-shutdown", attempt.id()).ok();
    tauri::async_runtime::spawn(async move {
        let wake = attempt.wait().await;
        let state = app.state::<DesktopState>();
        let decision = if let Ok(services) = state.services() {
            // Serialize the exit reservation with new sessions and media operations.
            let _sessions = services.sessions.lock().unwrap();
            let activity = crate::shutdown::ShutdownActivity {
                media_operations: state.media_operations.load(Ordering::SeqCst),
                pending_recordings: services.completed_recordings.has_pending(),
                recording_jobs: services
                    .recordings
                    .lock()
                    .unwrap()
                    .values()
                    .any(|recording| recording.has_job()),
            };
            state.shutdown.finish(&attempt, wake, activity)
        } else {
            state.shutdown.finish(&attempt, wake, Default::default())
        };
        if decision == crate::shutdown::ShutdownDecision::Cancel {
            state.closing.store(false, Ordering::SeqCst);
        }
        if decision != crate::shutdown::ShutdownDecision::Exit {
            return;
        }
        let wait = async {
            if let Ok(services) = state.services() {
                services.diagnostics.cancel_all().await;
                services.ios_wifi.cancel_all().await;
                services.ios_usb.cancel_all().await;
                services.ios_keyboard.cancel_all().await;
                services.android_qr.cancel_all().await;
                let tasks = std::mem::take(&mut *services.tasks.lock().unwrap());
                for task in tasks {
                    task.await.ok();
                }
            }
        };
        let _ = tokio::time::timeout(Duration::from_secs(20), wait).await;
        app.exit(0);
    });
}
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(crate::application_update_adapter::ApplicationUpdateState::default())
        .menu(|app| {
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
            // A native macOS predefined Quit terminates before async recording
            // can finish. Route a normal menu item through our shutdown policy.
            let quit = MenuItem::with_id(app, "quit", "종료", true, Some("CmdOrCtrl+Q"))?;
            let application = Submenu::with_items(app, "Phone Mirror", true, &[&quit])?;
            let edit = Submenu::with_items(
                app,
                "Edit",
                true,
                &[
                    &PredefinedMenuItem::undo(app, None)?,
                    &PredefinedMenuItem::redo(app, None)?,
                    &PredefinedMenuItem::cut(app, None)?,
                    &PredefinedMenuItem::copy(app, None)?,
                    &PredefinedMenuItem::paste(app, None)?,
                    &PredefinedMenuItem::select_all(app, None)?,
                ],
            )?;
            // A native fullscreen transition may temporarily move keyboard
            // focus away from WKWebView. Keep Escape available at menu level.
            let restore =
                MenuItem::with_id(app, "restore-view", "기본 보기", true, Some("Escape"))?;
            let view = Submenu::with_items(app, "보기", true, &[&restore])?;
            Menu::with_items(app, &[&application, &edit, &view])
        })
        .on_menu_event(|app, event| {
            if event.id().as_ref() == "quit" {
                shutdown(app);
            } else if event.id().as_ref() == "restore-view" {
                if let Some(window) = app.get_webview_window("main") {
                    tauri::async_runtime::spawn(async move {
                        if let Err(error) = set_window_view_mode(
                            window.clone(),
                            crate::window_presentation::WindowViewMode::Normal,
                            None,
                        )
                        .await
                        {
                            window.emit("window-view-error", error).ok();
                        }
                    });
                }
            }
        })
        .setup(|app| {
            let services = (|| -> Result<Arc<DesktopServices>, String> {
                let executor: Arc<dyn AdbCommandExecutor> =
                    match ProcessAdbCommandExecutor::locate() {
                        Ok(executor) => Arc::new(executor),
                        Err(message) => Arc::new(UnavailableAdbCommandExecutor(message)),
                    };
                let cache = app
                    .path()
                    .app_cache_dir()
                    .map_err(|_| "앱 캐시 경로가 없습니다.")?;
                std::fs::create_dir_all(&cache).map_err(|_| "앱 캐시 폴더를 만들 수 없습니다.")?;
                let server_path = cache.join("scrcpy-server-v5.0");
                std::fs::write(
                    &server_path,
                    include_bytes!("../../../Vendor/scrcpy-server-v5.0"),
                )
                .map_err(|_| "화면 전송 모듈을 준비할 수 없습니다.")?;
                let data = app
                    .path()
                    .app_data_dir()
                    .map_err(|_| "앱 설정 경로가 없습니다.")?;
                let ios_wifi = Arc::new(crate::ios_wifi::IosWifiReceiverService::default());
                let ios_usb = Arc::new(crate::ios_usb::IosUsbReceiverService::default());
                let host = if cfg!(target_os = "macos") {
                    crate::connection_diagnostics::DiagnosticHost::Macos
                } else if cfg!(target_os = "windows") {
                    crate::connection_diagnostics::DiagnosticHost::Windows
                } else {
                    crate::connection_diagnostics::DiagnosticHost::Other
                };
                let diagnostics = crate::connection_diagnostics::ConnectionDiagnosticsService::new(
                    Arc::new(ProcessConnectionDiagnosticPort::new(
                        executor.clone(),
                        server_path.clone(),
                        ios_wifi.clone(),
                        ios_usb.clone(),
                    )),
                    host,
                );
                Ok(Arc::new(DesktopServices {
                    discovery: AdbDeviceDiscovery::new(
                        executor.clone(),
                        Arc::new(JsonBookmarkStore::new(
                            data.join("wireless-devices.v1.json"),
                        )),
                    ),
                    wireless: AdbWirelessConnectionService::new(executor.clone()),
                    android_qr: crate::android_qr::AndroidQrPairingService::new(
                        Arc::new(crate::android_qr::AdbAndroidQrPairingPort::new(
                            executor.clone(),
                        )),
                        Arc::new(crate::android_qr::MonotonicAndroidQrPairingClock::default()),
                    ),
                    stream: AndroidStreamService::new(executor, server_path),
                    ios_capture: Default::default(),
                    ios_wifi,
                    ios_usb,
                    ios_keyboard: Default::default(),
                    diagnostics,
                    sessions: Mutex::new(SessionRegistry::default()),
                    controls: Mutex::new(std::collections::HashMap::new()),
                    recordings: Mutex::new(Default::default()),
                    completed_recordings: Default::default(),
                    tasks: Mutex::new(Vec::new()),
                }))
            })();
            app.manage(DesktopState {
                services,
                closing: AtomicBool::new(false),
                media_operations: AtomicUsize::new(0),
                updating: AtomicBool::new(false),
                shutdown: Default::default(),
                window_presentation: Mutex::new(Default::default()),
            });
            if let Some(window) = app.get_webview_window("main") {
                observe_native_window(&window);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            crate::application_update_adapter::application_update_configuration,
            crate::application_update_adapter::check_application_update,
            crate::application_update_adapter::install_application_update,
            crate::application_update_adapter::cancel_application_update,
            start_ios_usb_receiver,
            stop_ios_usb_receiver,
            start_ios_wifi_receiver,
            stop_ios_wifi_receiver,
            discover_devices,
            run_connection_diagnostics,
            save_diagnostic_summary,
            cancel_connection_diagnostics,
            discover_services,
            start_android_qr_pairing,
            wait_android_qr_pairing,
            cancel_android_qr_pairing,
            pair_device,
            connect_device,
            start_session,
            stop_session,
            save_media_capture,
            start_native_recording,
            native_recording_running,
            set_native_recording_paused,
            finish_native_recording,
            save_native_recording,
            finish_media_shutdown,
            send_control,
            start_ios_keyboard_input,
            ios_keyboard_input_status,
            send_ios_keyboard_input,
            stop_ios_keyboard_input,
            read_clipboard_text,
            set_window_view_mode
        ])
        .on_window_event(|window, event| {
            if matches!(
                event,
                tauri::WindowEvent::Resized(_)
                    | tauri::WindowEvent::Moved(_)
                    | tauri::WindowEvent::Focused(_)
            ) {
                if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                    observe_native_window(&webview);
                }
            }
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let state = window.app_handle().state::<DesktopState>();
                let pip = state
                    .window_presentation
                    .try_lock()
                    .map(|presentation| {
                        presentation.mode() == crate::window_presentation::WindowViewMode::Pip
                    })
                    .unwrap_or(true);
                if pip && !state.closing.load(Ordering::SeqCst) {
                    if let Some(webview) = window.app_handle().get_webview_window(window.label()) {
                        tauri::async_runtime::spawn(async move {
                            set_window_view_mode(
                                webview.clone(),
                                crate::window_presentation::WindowViewMode::Normal,
                                None,
                            )
                            .await
                            .unwrap_or_else(|error| {
                                webview.emit("window-view-error", error).ok();
                                crate::window_presentation::WindowViewMode::Pip
                            });
                        });
                    }
                } else {
                    shutdown(window.app_handle());
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("Phone Mirror Desktop could not start");
    app.run(|app, event| {
        if let tauri::RunEvent::ExitRequested { api, .. } = event {
            if app.state::<DesktopState>().should_prevent_exit_request() {
                api.prevent_exit();
                shutdown(app);
            }
        }
    });
}

#[cfg(test)]
mod exit_request_tests {
    use super::*;
    use crate::shutdown::{ShutdownActivity, ShutdownDecision, ShutdownWake};

    fn state() -> DesktopState {
        DesktopState {
            services: Err("No hardware in this policy fixture".into()),
            closing: AtomicBool::new(false),
            media_operations: AtomicUsize::new(0),
            updating: AtomicBool::new(false),
            shutdown: Default::default(),
            window_presentation: Mutex::new(Default::default()),
        }
    }

    #[test]
    fn repeated_native_exit_requests_wait_for_media_and_exit_reservation() {
        let state = state();
        assert!(state.should_prevent_exit_request());
        state.closing.store(true, Ordering::SeqCst);
        let attempt = state.shutdown.begin().unwrap();
        assert!(state.should_prevent_exit_request());
        assert!(state.shutdown.respond(attempt.id(), true));
        assert!(state.should_prevent_exit_request());
        assert_eq!(
            state.shutdown.finish(
                &attempt,
                ShutdownWake::Allowed,
                ShutdownActivity {
                    media_operations: 1,
                    ..Default::default()
                }
            ),
            ShutdownDecision::Cancel
        );
        assert!(state.should_prevent_exit_request());
        let retry = state.shutdown.begin().unwrap();
        assert_eq!(
            state
                .shutdown
                .finish(&retry, ShutdownWake::Allowed, ShutdownActivity::default()),
            ShutdownDecision::Exit
        );
        assert!(!state.should_prevent_exit_request());
    }

    #[test]
    fn approved_update_restart_preserves_its_exit_path() {
        let state = state();
        state.closing.store(true, Ordering::SeqCst);
        state.updating.store(true, Ordering::SeqCst);
        assert!(!state.should_prevent_exit_request());
    }
}
