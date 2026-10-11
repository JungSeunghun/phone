use crate::domain::{parse_services, PairingRequest, WirelessEndpoint, WirelessService};
use async_trait::async_trait;
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::{io::AsyncWriteExt, process::Command};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug)]
pub struct CommandResult {
    pub success: bool,
    pub output: String,
}
#[async_trait]
pub trait AdbCommandExecutor: Send + Sync {
    async fn execute(
        &self,
        arguments: Vec<String>,
        input: Option<String>,
        cancellation: CancellationToken,
    ) -> Result<CommandResult, String>;
    fn executable(&self) -> Result<PathBuf, String> {
        Err("ADB 실행 경로가 없습니다.".into())
    }
}
pub struct ProcessAdbCommandExecutor {
    path: PathBuf,
    timeout: Duration,
}
impl ProcessAdbCommandExecutor {
    pub fn new(path: PathBuf, timeout: Duration) -> Result<Self, String> {
        if timeout.is_zero() || timeout > Duration::from_secs(60) {
            return Err("잘못된 실행 제한 시간입니다.".into());
        }
        Ok(Self { path, timeout })
    }
    pub fn locate() -> Result<Self, String> {
        let name = if cfg!(windows) { "adb.exe" } else { "adb" };
        let mut candidates = Vec::new();
        if let Some(path) = std::env::var_os("PHONE_MIRROR_ADB_PATH") {
            candidates.push(PathBuf::from(path));
        }
        if let Some(path) = std::env::var_os("PATH") {
            candidates.extend(std::env::split_paths(&path).map(|directory| directory.join(name)));
        }
        for key in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
            if let Some(path) = std::env::var_os(key) {
                candidates.push(PathBuf::from(path).join("platform-tools").join(name));
            }
        }
        if let Ok(path) = std::env::current_exe() {
            if let Some(parent) = path.parent() {
                candidates.push(parent.join(name));
            }
        }
        #[cfg(target_os = "macos")]
        candidates.extend([
            PathBuf::from("/opt/homebrew/bin/adb"),
            PathBuf::from("/usr/local/bin/adb"),
        ]);
        let path = candidates.into_iter().find(|path| path.is_file()).ok_or(
            "ADB를 찾을 수 없습니다. Android Platform Tools를 설치하고 PATH에 추가하세요.",
        )?;
        Self::new(path, Duration::from_secs(12))
    }
}
pub fn adb_command(path: &std::path::Path) -> Command {
    let mut command = Command::new(path);
    command.kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000); // CREATE_NO_WINDOW: no console flash per poll.
    command
}
#[async_trait]
impl AdbCommandExecutor for ProcessAdbCommandExecutor {
    fn executable(&self) -> Result<PathBuf, String> {
        Ok(self.path.clone())
    }
    async fn execute(
        &self,
        arguments: Vec<String>,
        input: Option<String>,
        cancellation: CancellationToken,
    ) -> Result<CommandResult, String> {
        if cancellation.is_cancelled() {
            return Err("연결 작업을 취소했습니다.".into());
        }
        let operation = async {
            let mut command = adb_command(&self.path);
            command
                .args(arguments)
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .stdin(if input.is_some() {
                    std::process::Stdio::piped()
                } else {
                    std::process::Stdio::null()
                });
            let mut child = command
                .spawn()
                .map_err(|_| "ADB를 실행할 수 없습니다.".to_string())?;
            if let Some(input) = input {
                if let Some(mut stdin) = child.stdin.take() {
                    stdin
                        .write_all(input.as_bytes())
                        .await
                        .map_err(|_| "ADB 입력 전달에 실패했습니다.".to_string())?;
                    stdin.shutdown().await.ok();
                }
            }
            let output = child
                .wait_with_output()
                .await
                .map_err(|_| "ADB 실행 결과를 읽을 수 없습니다.".to_string())?;
            let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
            text.push_str(&String::from_utf8_lossy(&output.stderr));
            Ok(CommandResult {
                success: output.status.success(),
                output: text,
            })
        };
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => Err("연결 작업을 취소했습니다.".into()),
            result = tokio::time::timeout(self.timeout, operation) => result.map_err(|_| "ADB 응답 시간이 초과됐습니다.".to_string())?,
        }
    }
}

pub struct AdbWirelessConnectionService {
    executor: Arc<dyn AdbCommandExecutor>,
}
impl AdbWirelessConnectionService {
    pub fn new(executor: Arc<dyn AdbCommandExecutor>) -> Self {
        Self { executor }
    }
    pub async fn discover(
        &self,
        cancellation: CancellationToken,
    ) -> Result<Vec<WirelessService>, String> {
        let result = self
            .executor
            .execute(vec!["mdns".into(), "services".into()], None, cancellation)
            .await?;
        if !result.success {
            return Err("무선 기기 검색에 실패했습니다. 주소를 직접 입력할 수 있습니다.".into());
        }
        Ok(parse_services(&result.output))
    }
    pub async fn pair(
        &self,
        address: &str,
        code: &str,
        cancellation: CancellationToken,
    ) -> Result<(), String> {
        let request = PairingRequest::parse(address, code)?;
        let result = self
            .executor
            .execute(
                vec!["pair".into(), request.endpoint.address],
                Some(format!("{}\n", request.code)),
                cancellation,
            )
            .await;
        match result {
            Ok(result) if result.success && result.output.contains("Successfully paired") => Ok(()),
            _ => Err("페어링에 실패했습니다. 폰의 새 코드와 페어링 포트를 확인하세요.".into()),
        }
    }
    pub async fn connect(
        &self,
        address: &str,
        cancellation: CancellationToken,
    ) -> Result<(), String> {
        let endpoint = WirelessEndpoint::parse(address)?;
        let result = self
            .executor
            .execute(vec!["connect".into(), endpoint.address], None, cancellation)
            .await?;
        let output = result.output.trim();
        if result.success
            && (output.starts_with("connected to ") || output.starts_with("already connected to "))
        {
            Ok(())
        } else {
            Err("무선 연결에 실패했습니다. 페어링 포트와 연결 포트는 다릅니다.".into())
        }
    }
}

/// Keeps iPhone services usable on computers without Android Platform Tools.
pub struct UnavailableAdbCommandExecutor(pub String);
#[async_trait]
impl AdbCommandExecutor for UnavailableAdbCommandExecutor {
    async fn execute(
        &self,
        _arguments: Vec<String>,
        _input: Option<String>,
        _cancellation: CancellationToken,
    ) -> Result<CommandResult, String> {
        Err(self.0.clone())
    }
    fn executable(&self) -> Result<PathBuf, String> {
        Err(self.0.clone())
    }
}
