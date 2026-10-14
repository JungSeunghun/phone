use crate::application_update::{validate_candidate, validate_endpoint};
use serde::Serialize;
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
    time::Duration,
};
use tauri::{ipc::Channel, AppHandle, Manager, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub(crate) struct ApplicationUpdateState {
    operation: tokio::sync::Mutex<Option<Update>>,
    cancellation: Mutex<crate::application::SessionRegistry>,
    installing: AtomicBool,
}
impl ApplicationUpdateState {
    fn token(&self, id: &str) -> Result<CancellationToken, String> {
        self.cancellation.lock().unwrap().start(id)
    }
}
#[derive(Serialize)]
pub(crate) struct Configuration {
    version: String,
    configured: bool,
    endpoint: Option<String>,
}
#[derive(Serialize)]
pub(crate) struct Candidate {
    version: String,
    notes: String,
}
fn default_endpoint(app: &AppHandle) -> Option<String> {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(crate::application_update::configured_endpoint)
}
#[tauri::command]
pub(crate) fn application_update_configuration(app: AppHandle) -> Configuration {
    let endpoint = default_endpoint(&app);
    Configuration {
        version: app.package_info().version.to_string(),
        configured: endpoint.is_some(),
        endpoint,
    }
}
#[tauri::command]
pub(crate) async fn check_application_update(
    app: AppHandle,
    state: State<'_, ApplicationUpdateState>,
    endpoint: Option<String>,
    operation_id: String,
) -> Result<Option<Candidate>, String> {
    let mut pending = state
        .operation
        .try_lock()
        .map_err(|_| "업데이트 작업이 진행 중입니다.")?;
    *pending = None;
    let endpoint = endpoint
        .or_else(|| default_endpoint(&app))
        .unwrap_or_default();
    let endpoint = validate_endpoint(&endpoint)?;
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .timeout(Duration::from_secs(30))
        .configure_client(|client| client.https_only(true))
        .build()
        .map_err(|error| error.to_string())?;
    let token = state.token(&operation_id)?;
    let result = tokio::select! {
        _ = token.cancelled() => return Err("업데이트 확인을 취소했습니다.".into()),
        result = updater.check() => result.map_err(|error| error.to_string())?,
    };
    if token.is_cancelled() {
        return Err("업데이트 확인을 취소했습니다.".into());
    }
    if let Some(mut update) = result {
        validate_candidate(&update.current_version, &update.version)?;
        validate_endpoint(update.download_url.as_str())?;
        update.timeout = Some(Duration::from_secs(300));
        let candidate = Candidate {
            version: update.version.clone(),
            notes: update.body.clone().unwrap_or_default(),
        };
        *pending = Some(update);
        Ok(Some(candidate))
    } else {
        Ok(None)
    }
}
#[tauri::command]
pub(crate) fn cancel_application_update(
    state: State<'_, ApplicationUpdateState>,
    operation_id: String,
) -> Result<bool, String> {
    uuid::Uuid::parse_str(&operation_id).map_err(|_| "유효하지 않은 업데이트 작업입니다.")?;
    let mut cancellation = state.cancellation.lock().unwrap();
    if state.installing.load(Ordering::SeqCst) {
        return Ok(false);
    }
    cancellation.stop(&operation_id);
    Ok(true)
}
#[tauri::command]
pub(crate) async fn install_application_update(
    app: AppHandle,
    state: State<'_, ApplicationUpdateState>,
    on_progress: Channel<f64>,
    operation_id: String,
) -> Result<(), String> {
    let mut pending = state
        .operation
        .try_lock()
        .map_err(|_| "업데이트 작업이 진행 중입니다.")?;
    let update = pending.take().ok_or("업데이트를 먼저 확인하세요.")?;
    validate_candidate(&update.current_version, &update.version)?;
    let token = state.token(&operation_id)?;
    let progress_token = token.clone();
    let mut received: u64 = 0;
    // Bound memory even when a server omits or lies about Content-Length.
    const MAX_DOWNLOAD: u64 = 512 * 1024 * 1024;
    let bytes = tokio::select! {
        _ = token.cancelled() => return Err("다운로드를 취소했거나 파일이 너무 큽니다.".into()),
        result = update.download(|chunk, total| {
            received = received.saturating_add(chunk as u64);
            if received > MAX_DOWNLOAD || total.is_some_and(|value| value > MAX_DOWNLOAD) { progress_token.cancel(); }
            if let Some(total) = total.filter(|value| *value > 0) { on_progress.send((received as f64 / total as f64 * 100.0).min(100.0)).ok(); }
        }, || {}) => result.map_err(|error| error.to_string())?,
    };
    if token.is_cancelled() {
        return Err("다운로드가 취소되었습니다.".into());
    }
    // download() returns only after the plugin's mandatory signature verification.
    let desktop = app.state::<crate::desktop::DesktopState>();
    {
        let _cancellation = state.cancellation.lock().unwrap();
        if token.is_cancelled() {
            return Err("다운로드가 취소되었습니다.".into());
        }
        desktop.begin_update()?;
        state.installing.store(true, Ordering::SeqCst);
        on_progress.send(-1.0).ok();
    }
    let installer = update.clone();
    let result = tauri::async_runtime::spawn_blocking(move || installer.install(bytes)).await;
    match result {
        Ok(Ok(())) => {
            app.restart();
        }
        Ok(Err(error)) => {
            desktop.end_update();
            state.installing.store(false, Ordering::SeqCst);
            Err(error.to_string())
        }
        Err(error) => {
            desktop.end_update();
            state.installing.store(false, Ordering::SeqCst);
            Err(error.to_string())
        }
    }
}
