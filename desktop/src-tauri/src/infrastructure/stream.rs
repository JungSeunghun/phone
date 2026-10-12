use super::{adb_command, AdbCommandExecutor};
use crate::domain::{ConnectionTransport, DeviceEndpoint, MirrorSettings, VideoPacketHeader};
use std::{path::PathBuf, sync::Arc, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::TcpStream,
    process::Child,
};
use tokio_util::sync::CancellationToken;

pub trait VideoPacketSink: Send + Sync {
    fn send(&self, bytes: Vec<u8>) -> Result<(), String>;
}
pub trait AudioPacketSink: Send + Sync {
    fn send(&self, bytes: Vec<u8>) -> Result<(), String>;
    fn status(&self, message: &str);
}
pub struct StreamInteraction {
    pub audio: Arc<dyn AudioPacketSink>,
    pub control: tokio::sync::mpsc::Receiver<Vec<u8>>,
}
pub struct AndroidStreamService {
    executor: Arc<dyn AdbCommandExecutor>,
    server_path: PathBuf,
}
impl AndroidStreamService {
    pub fn new(executor: Arc<dyn AdbCommandExecutor>, server_path: PathBuf) -> Self {
        Self {
            executor,
            server_path,
        }
    }
    pub async fn run(
        &self,
        endpoint: &DeviceEndpoint,
        settings: &MirrorSettings,
        sink: Arc<dyn VideoPacketSink>,
        cancellation: CancellationToken,
    ) -> Result<(), String> {
        self.run_session(endpoint, settings, sink, None, cancellation)
            .await
    }
    pub async fn run_interactive(
        &self,
        endpoint: &DeviceEndpoint,
        settings: &MirrorSettings,
        sink: Arc<dyn VideoPacketSink>,
        interaction: StreamInteraction,
        cancellation: CancellationToken,
    ) -> Result<(), String> {
        self.run_session(endpoint, settings, sink, Some(interaction), cancellation)
            .await
    }
    async fn run_session(
        &self,
        endpoint: &DeviceEndpoint,
        settings: &MirrorSettings,
        sink: Arc<dyn VideoPacketSink>,
        interaction: Option<StreamInteraction>,
        cancellation: CancellationToken,
    ) -> Result<(), String> {
        settings.validate()?;
        let id = (uuid::Uuid::new_v4().as_u128() as u32) & 0x7fffffff;
        let scid = format!("{:08x}", id.max(1));
        let remote_path = format!("/data/local/tmp/phone-mirror-{scid}.jar");
        let mut resources = StreamResources {
            executor: self.executor.clone(),
            identifier: endpoint.identifier.clone(),
            remote_path,
            forwarded_port: None,
            child: None,
            logs: None,
        };
        let operation = async {
            if cancellation.is_cancelled() {
                return Ok(());
            }
            let pushed = self
                .executor
                .execute(
                    vec![
                        "-s".into(),
                        endpoint.identifier.clone(),
                        "push".into(),
                        self.server_path.to_string_lossy().into_owned(),
                        resources.remote_path.clone(),
                    ],
                    None,
                    cancellation.clone(),
                )
                .await?;
            if !pushed.success {
                return Err("폰에 화면 전송 모듈을 설치할 수 없습니다.".into());
            }
            if cancellation.is_cancelled() {
                return Ok(());
            }
            // Finish the bounded allocation even if stop arrives during it,
            // then record its assigned port so cleanup can remove that exact forward.
            let forward = self
                .executor
                .execute(
                    vec![
                        "-s".into(),
                        endpoint.identifier.clone(),
                        "forward".into(),
                        "tcp:0".into(),
                        format!("localabstract:scrcpy_{scid}"),
                    ],
                    None,
                    CancellationToken::new(),
                )
                .await?;
            if !forward.success {
                return Err("ADB 영상 포워딩에 실패했습니다.".into());
            }
            let port: u16 = forward
                .output
                .trim()
                .parse()
                .map_err(|_| "ADB가 잘못된 영상 포트를 반환했습니다.")?;
            if port == 0 {
                return Err("ADB가 잘못된 영상 포트를 반환했습니다.".into());
            }
            resources.forwarded_port = Some(port);
            if cancellation.is_cancelled() {
                return Ok(());
            }
            let path = self.executor.executable()?;
            let mut command = adb_command(&path);
            command
                .args(server_arguments_for_transport(
                    &endpoint.identifier,
                    &resources.remote_path,
                    &scid,
                    settings,
                    interaction.is_some(),
                    endpoint.transport,
                ))
                .stdin(std::process::Stdio::null())
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped());
            let mut child = command
                .spawn()
                .map_err(|_| "폰의 화면 전송 서버를 시작할 수 없습니다.")?;
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();
            resources.logs = Some(tokio::spawn(async move {
                if let (Some(stdout), Some(stderr)) = (stdout, stderr) {
                    tokio::join!(drain_logs(stdout), drain_logs(stderr));
                }
            }));
            resources.child = Some(child);
            let mut video = tokio::select! {
                biased;
                _ = cancellation.cancelled() => return Ok(()),
                result = tokio::time::timeout(Duration::from_secs(15), connect_video(port)) => result.map_err(|_| "폰의 영상 채널 응답 시간이 초과됐습니다.")??,
            };
            let audio = if interaction.is_some() {
                Some(connect_channel(port, &cancellation).await?)
            } else {
                None
            };
            let control = connect_channel(port, &cancellation).await?;
            let mut codec = [0; 4];
            tokio::select! {
                biased;
                _ = cancellation.cancelled() => return Ok(()),
                result = tokio::time::timeout(Duration::from_secs(15), video.read_exact(&mut codec)) => { result.map_err(|_| "영상 형식 응답 시간이 초과됐습니다.")?.map_err(|_| "영상 형식 정보를 읽을 수 없습니다.")?; },
            }
            if u32::from_be_bytes(codec) != 0x68323634 {
                return Err("지원하지 않는 영상 형식입니다.".into());
            }
            if let Some(interaction) = interaction {
                let audio = read_audio(audio.unwrap(), interaction.audio, cancellation.clone());
                let control_cancellation = cancellation.child_token();
                let control =
                    write_control(control, interaction.control, control_cancellation.clone());
                tokio::pin!(control);
                tokio::select! {
                    result = &mut control => result,
                    result = read_video(video, sink, cancellation.clone()) => {
                        control_cancellation.cancel(); let _ = control.await; result
                    },
                    result = audio => {control_cancellation.cancel(); let _ = control.await; result},
                }
            } else {
                let _control = control;
                read_video(video, sink, cancellation.clone()).await
            }
        };
        let result = operation.await;
        resources.cleanup().await;
        result
    }
}
async fn read_video(
    mut video: TcpStream,
    sink: Arc<dyn VideoPacketSink>,
    cancellation: CancellationToken,
) -> Result<(), String> {
    loop {
        let mut bytes = [0u8; 12];
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Ok(()),
            result = video.read_exact(&mut bytes) => { result.map_err(|_| "폰의 영상 연결이 종료됐습니다.")?; },
        }
        let flags = u64::from_be_bytes(bytes[..8].try_into().unwrap());
        if flags & (1 << 63) != 0 {
            let width = u32::from_be_bytes(bytes[4..8].try_into().unwrap());
            let height = u32::from_be_bytes(bytes[8..].try_into().unwrap());
            if width == 0 || height == 0 || width > 8192 || height > 8192 {
                return Err("잘못된 영상 크기입니다.".into());
            }
            continue;
        }
        let header = VideoPacketHeader::parse(&bytes)?;
        let mut packet = vec![0; 12 + header.payload_size];
        packet[..12].copy_from_slice(&bytes);
        tokio::select! {
            biased;
            _ = cancellation.cancelled() => return Ok(()),
            result = video.read_exact(&mut packet[12..]) => { result.map_err(|_| "영상 패킷이 중단됐습니다.")?; },
        }
        sink.send(packet)?;
    }
}
async fn connect_channel(port: u16, cancellation: &CancellationToken) -> Result<TcpStream, String> {
    tokio::select! { biased; _ = cancellation.cancelled() => Err("연결을 취소했습니다.".into()),
        result=tokio::time::timeout(Duration::from_secs(5), TcpStream::connect(("127.0.0.1",port))) => {
            let stream=result.map_err(|_|"채널 연결 시간이 초과됐습니다.")?.map_err(|_|"폰 채널을 연결할 수 없습니다.")?;
            stream.set_nodelay(true).ok(); Ok(stream)
        }
    }
}
pub async fn read_audio(
    mut audio: impl tokio::io::AsyncRead + Unpin,
    sink: Arc<dyn AudioPacketSink>,
    cancellation: CancellationToken,
) -> Result<(), String> {
    let operation = async {
        let mut codec = [0; 4];
        tokio::time::timeout(Duration::from_secs(15), audio.read_exact(&mut codec))
            .await
            .map_err(|_| "폰 오디오 응답 시간이 초과됐습니다.")?
            .map_err(|_| "폰 오디오 연결이 종료됐습니다.")?;
        if u32::from_be_bytes(codec) != 0x00726177 {
            return Err::<(), String>(
                "폰에서 소리 전달을 지원하지 않거나 해당 앱이 허용하지 않습니다.".to_string(),
            );
        }
        loop {
            let mut header = [0; 12];
            audio
                .read_exact(&mut header)
                .await
                .map_err(|_| "폰 소리 연결이 종료됐습니다.")?;
            let size = u32::from_be_bytes(header[8..12].try_into().unwrap()) as usize;
            if size == 0 || size > 4096 || !size.is_multiple_of(4) {
                return Err("잘못된 오디오 패킷입니다.".into());
            }
            let mut packet = vec![0; 12 + size];
            packet[..12].copy_from_slice(&header);
            audio
                .read_exact(&mut packet[12..])
                .await
                .map_err(|_| "오디오 패킷이 중단됐습니다.")?;
            crate::interaction::validate_audio_packet(&packet)?;
            sink.send(packet)?;
        }
    };
    tokio::select! { biased; _=cancellation.cancelled()=>return Ok(()), result=operation=>{if let Err(message)=result {sink.status(&message);}} }
    // An unsupported audio stream must not take down the video/control session.
    cancellation.cancelled().await;
    Ok(())
}
pub async fn write_control(
    mut writer: impl tokio::io::AsyncWrite + tokio::io::AsyncRead + Unpin,
    mut receiver: tokio::sync::mpsc::Receiver<Vec<u8>>,
    cancellation: CancellationToken,
) -> Result<(), String> {
    let mut pressed: Option<Vec<u8>> = None;
    let result = async {
        loop {
            let packet = tokio::select! {biased;_=cancellation.cancelled()=>return Ok(()),packet=receiver.recv()=>packet};
            let Some(packet) = packet else { cancellation.cancelled().await; return Ok(()); };
            // Complete each small message to preserve framing even on Stop.
            tokio::time::timeout(Duration::from_secs(2),writer.write_all(&packet)).await
                .map_err(|_|"폰 입력 응답 시간이 초과됐습니다.")?.map_err(|_|"폰 입력 연결이 종료됐습니다.")?;
            if packet.first() == Some(&9) {
                // Android handles PASTE asynchronously. Await server processing, then give
                // its key event time to consume this clipboard before replacing it again.
                let mut acknowledgement = [0; 9];
                let read = tokio::time::timeout(Duration::from_secs(2), writer.read_exact(&mut acknowledgement));
                tokio::select! { biased;
                    _ = cancellation.cancelled() => return Ok(()),
                    result = read => { result.map_err(|_| "폰 붙여넣기 확인 시간이 초과됐습니다.")?.map_err(|_| "폰 입력 연결이 종료됐습니다.")?; }
                }
                if acknowledgement[0] != 1 || packet.get(1..9) != Some(&acknowledgement[1..]) { return Err("폰 붙여넣기 확인이 올바르지 않습니다.".into()); }
                tokio::select! { biased;
                    _ = cancellation.cancelled() => return Ok(()),
                    _ = tokio::time::sleep(Duration::from_millis(100)) => {}
                }
            }
            if packet.len()==32 && packet[0]==2 { if packet[1]==0 || packet[1]==2 {pressed=Some(packet);} else {pressed=None;} }
        }
    }.await;
    if let Some(mut packet) = pressed {
        packet[1] = 3;
        packet[22] = 0;
        packet[23] = 0;
        let _ = tokio::time::timeout(Duration::from_millis(200), writer.write_all(&packet)).await;
    }
    result
}

async fn drain_logs(reader: impl tokio::io::AsyncRead + Unpin) {
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(_)) = lines.next_line().await {}
}
async fn connect_video(port: u16) -> Result<TcpStream, String> {
    loop {
        if let Ok(mut stream) = TcpStream::connect(("127.0.0.1", port)).await {
            let mut dummy = [0u8; 1];
            if matches!(
                tokio::time::timeout(Duration::from_millis(500), stream.read_exact(&mut dummy))
                    .await,
                Ok(Ok(_))
            ) {
                stream.set_nodelay(true).ok();
                return Ok(stream);
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
}
pub fn server_arguments(
    identifier: &str,
    remote: &str,
    scid: &str,
    settings: &MirrorSettings,
) -> Vec<String> {
    server_arguments_with_audio(identifier, remote, scid, settings, false)
}
pub fn server_arguments_with_audio(
    identifier: &str,
    remote: &str,
    scid: &str,
    settings: &MirrorSettings,
    audio: bool,
) -> Vec<String> {
    [
        "-s".into(),
        identifier.into(),
        "shell".into(),
        format!("CLASSPATH={remote}"),
        "app_process".into(),
        "/".into(),
        "com.genymobile.scrcpy.Server".into(),
        "5.0".into(),
        format!("scid={scid}"),
        "tunnel_forward=true".into(),
        "send_device_meta=false".into(),
        format!("audio={audio}"),
        "audio_codec=raw".into(),
        "control=true".into(),
        "clipboard_autosync=false".into(),
        "video_codec=h264".into(),
        format!("max_size={}", settings.video_max_dimension),
        "video_bit_rate=8000000".into(),
        format!("max_fps={}", settings.video_max_frame_rate),
        // Bound recovery after the decoder discards an overloaded reference queue.
        "video_codec_options=i-frame-interval=1".into(),
        format!("stay_awake={}", settings.keep_screen_awake),
        "log_level=warn".into(),
    ]
    .into()
}
pub fn server_arguments_for_transport(
    identifier: &str,
    remote: &str,
    scid: &str,
    settings: &MirrorSettings,
    audio: bool,
    transport: ConnectionTransport,
) -> Vec<String> {
    let mut arguments = server_arguments_with_audio(identifier, remote, scid, settings, audio);
    if transport == ConnectionTransport::Wifi {
        if let Some(argument) = arguments
            .iter_mut()
            .find(|argument| argument.starts_with("video_bit_rate="))
        {
            *argument = format!(
                "video_bit_rate={}",
                adaptive_video_bit_rate(settings).unwrap_or(8_000_000)
            );
        }
    }
    arguments
}
struct StreamResources {
    executor: Arc<dyn AdbCommandExecutor>,
    identifier: String,
    remote_path: String,
    forwarded_port: Option<u16>,
    child: Option<Child>,
    logs: Option<tokio::task::JoinHandle<()>>,
}
impl StreamResources {
    async fn cleanup(&mut self) {
        if let Some(mut child) = self.child.take() {
            child.start_kill().ok();
            let _ = tokio::time::timeout(Duration::from_secs(2), child.wait()).await;
        }
        if let Some(logs) = self.logs.take() {
            logs.abort();
        }
        if let Some(port) = self.forwarded_port.take() {
            let _ = tokio::time::timeout(
                Duration::from_secs(2),
                self.executor.execute(
                    vec![
                        "-s".into(),
                        self.identifier.clone(),
                        "forward".into(),
                        "--remove".into(),
                        format!("tcp:{port}"),
                    ],
                    None,
                    CancellationToken::new(),
                ),
            )
            .await;
        }
        let _ = tokio::time::timeout(
            Duration::from_secs(2),
            self.executor.execute(
                vec![
                    "-s".into(),
                    self.identifier.clone(),
                    "shell".into(),
                    "rm".into(),
                    "-f".into(),
                    self.remote_path.clone(),
                ],
                None,
                CancellationToken::new(),
            ),
        )
        .await;
    }
}
impl Drop for StreamResources {
    fn drop(&mut self) {
        if let Some(child) = self.child.as_mut() {
            child.start_kill().ok();
        }
        if let Some(logs) = self.logs.take() {
            logs.abort();
        }
    }
}

/// Bounds are shared with normal settings validation; lower source size/rate also reduces bandwidth.
pub fn adaptive_video_bit_rate(settings: &MirrorSettings) -> Result<u32, String> {
    settings.validate()?;
    Ok(
        if settings.video_max_dimension <= 720 || settings.video_max_frame_rate <= 15 {
            1_500_000
        } else if settings.video_max_dimension <= 1280 || settings.video_max_frame_rate <= 30 {
            4_000_000
        } else {
            8_000_000
        },
    )
}
