//! Encoded recording is independent of Tauri and never waits on disk in the video sink.
use crate::domain::VideoPacketHeader;
use std::{
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        mpsc::{sync_channel, SyncSender},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};
pub fn recording_time_expired(elapsed: Duration) -> bool {
    elapsed >= Duration::from_secs(3600)
}
pub fn accept_recording_sample(current: usize, incoming: usize, count: usize) -> bool {
    incoming > 0
        && count < 200_000
        && current
            .checked_add(incoming)
            .is_some_and(|size| size <= crate::media::MEDIA_BYTE_LIMIT - 8 * 1024 * 1024)
}
pub const RECORDING_QUEUE_BYTES: usize = 8 * 1024 * 1024;
pub struct PacketBudget {
    used: AtomicUsize,
    limit: usize,
}
impl PacketBudget {
    pub fn new(limit: usize) -> Self {
        Self {
            used: AtomicUsize::new(0),
            limit,
        }
    }
    pub fn reserve(&self, size: usize) -> bool {
        let mut used = self.used.load(Ordering::Relaxed);
        loop {
            let Some(next) = used.checked_add(size).filter(|value| *value <= self.limit) else {
                return false;
            };
            match self
                .used
                .compare_exchange_weak(used, next, Ordering::AcqRel, Ordering::Relaxed)
            {
                Ok(_) => return true,
                Err(actual) => used = actual,
            }
        }
    }
    pub fn release(&self, size: usize) {
        let mut used = self.used.load(Ordering::Relaxed);
        loop {
            let Some(next) = used.checked_sub(size) else {
                return;
            };
            match self
                .used
                .compare_exchange_weak(used, next, Ordering::AcqRel, Ordering::Relaxed)
            {
                Ok(_) => return,
                Err(actual) => used = actual,
            }
        }
    }
}
pub(crate) struct QueuedPacket {
    pub(crate) audio: bool,
    pub(crate) bytes: Vec<u8>,
    budget: Arc<PacketBudget>,
    pub(crate) received_at: Instant,
}
pub trait RecordingClock: Send + Sync {
    fn now(&self) -> Instant;
}
struct MonotonicRecordingClock;
impl RecordingClock for MonotonicRecordingClock {
    fn now(&self) -> Instant {
        Instant::now()
    }
}
pub(crate) enum RecordingInput {
    Media(QueuedPacket),
    Pause(Instant),
    Resume(Instant),
}
impl Drop for QueuedPacket {
    fn drop(&mut self) {
        self.budget.release(self.bytes.len());
    }
}
pub fn annex_b_units(bytes: &[u8]) -> Result<Vec<&[u8]>, String> {
    let mut starts = Vec::new();
    let mut i = 0;
    while i + 3 <= bytes.len() {
        let size = if bytes[i..].starts_with(&[0, 0, 0, 1]) {
            4
        } else if bytes[i..].starts_with(&[0, 0, 1]) {
            3
        } else {
            0
        };
        if size > 0 {
            starts.push((i, i + size));
            i += size;
        } else {
            i += 1;
        }
    }
    if starts.is_empty() || bytes[..starts[0].0].iter().any(|b| *b != 0) {
        return Err("잘못된 H.264 시작 코드입니다.".into());
    }
    let mut units = Vec::new();
    for (index, (_, start)) in starts.iter().enumerate() {
        let mut end = starts.get(index + 1).map(|s| s.0).unwrap_or(bytes.len());
        while end > *start && bytes[end - 1] == 0 {
            end -= 1;
        }
        if end <= *start || bytes[*start] & 0x80 != 0 || bytes[*start] & 31 == 0 {
            return Err("잘못된 H.264 단위입니다.".into());
        }
        units.push(&bytes[*start..end]);
    }
    Ok(units)
}
#[derive(Debug)]
pub struct RecordedFile {
    path: PathBuf,
}
impl RecordedFile {
    pub fn path(&self) -> &Path {
        &self.path
    }
    pub fn publish(&self, destination: &Path) -> Result<(), String> {
        if destination.extension().and_then(|s| s.to_str()) != Some("mp4") {
            return Err("MP4 확장자가 필요합니다.".into());
        }
        let temporary =
            destination.with_file_name(format!(".phone-mirror-{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| -> std::io::Result<()> {
            std::fs::copy(&self.path, &temporary)?;
            // Windows FlushFileBuffers requires a handle with write access.
            std::fs::OpenOptions::new()
                .write(true)
                .open(&temporary)?
                .sync_all()?;
            std::fs::hard_link(&temporary, destination)?;
            Ok(())
        })();
        let _ = std::fs::remove_file(temporary);
        result.map_err(|_| "녹화를 저장할 수 없습니다. 새 이름과 쓰기 권한을 확인하세요.".into())
    }
}
impl Drop for RecordedFile {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.path);
    }
}

/// Owns completed recordings until a save succeeds or the user explicitly cancels.
#[derive(Default)]
pub struct CompletedRecordingStore {
    files: Mutex<std::collections::HashMap<String, CompletedRecording>>,
}
struct CompletedRecording {
    file: Arc<RecordedFile>,
    saving: bool,
}
struct RecordingSaveReservation<'a> {
    store: &'a CompletedRecordingStore,
    id: &'a str,
}
impl Drop for RecordingSaveReservation<'_> {
    fn drop(&mut self) {
        if let Some(entry) = self.store.files.lock().unwrap().get_mut(self.id) {
            entry.saving = false;
        }
    }
}
impl CompletedRecordingStore {
    pub fn insert(&self, id: String, file: RecordedFile) {
        self.files.lock().unwrap().insert(
            id,
            CompletedRecording {
                file: Arc::new(file),
                saving: false,
            },
        );
    }
    pub fn has_pending(&self) -> bool {
        !self.files.lock().unwrap().is_empty()
    }
    pub fn save(
        &self,
        id: &str,
        save: impl FnOnce(&RecordedFile) -> Result<Option<String>, String>,
    ) -> Result<Option<String>, String> {
        let file = {
            let mut files = self.files.lock().unwrap();
            let entry = files.get_mut(id).ok_or("완료된 녹화 파일이 없습니다.")?;
            if entry.saving {
                return Err("녹화를 저장하고 있습니다.".into());
            }
            entry.saving = true;
            entry.file.clone()
        };
        let _reservation = RecordingSaveReservation { store: self, id };
        let result = save(&file);
        if result.is_ok() {
            self.files.lock().unwrap().remove(id);
        }
        result
    }
}
struct RecordingJob {
    id: String,
    input: Option<SyncSender<RecordingInput>>,
    budget: Arc<PacketBudget>,
    failed: Arc<AtomicBool>,
    ready: Arc<AtomicBool>,
    paused: bool,
    audio: bool,
    clock: Arc<dyn RecordingClock>,
    worker: JoinHandle<Result<RecordedFile, String>>,
    ended_at: Arc<Mutex<Option<Instant>>>,
}
impl RecordingJob {
    fn stop_input(&mut self) {
        if self.input.is_some() {
            *self.ended_at.lock().unwrap() = Some(self.clock.now());
            self.input.take();
        }
    }
}
#[derive(Default)]
struct SessionState {
    configuration: Option<Vec<u8>>,
    job: Option<RecordingJob>,
    closed: bool,
}
/// Enqueue a fresh key frame request; implementations must not deliver media synchronously.
pub trait RecordingFrameRequester: Send + Sync {
    fn request_key_frame(&self) -> Result<(), String>;
}
pub struct RecordingSession {
    state: Mutex<SessionState>,
    clock: Arc<dyn RecordingClock>,
    audio_factory: Arc<dyn crate::recording_audio::RecordingAudioEncoderFactory>,
    frame_requester: Option<Arc<dyn RecordingFrameRequester>>,
}
impl Default for RecordingSession {
    fn default() -> Self {
        Self::with_clock(Arc::new(MonotonicRecordingClock))
    }
}
impl RecordingSession {
    pub fn with_frame_requester(requester: Arc<dyn RecordingFrameRequester>) -> Self {
        let mut session = Self::with_clock(Arc::new(MonotonicRecordingClock));
        session.frame_requester = Some(requester);
        session
    }
    pub fn with_clock(clock: Arc<dyn RecordingClock>) -> Self {
        Self::with_clock_and_audio_factory(
            clock,
            Arc::new(crate::recording_audio::SoftwareAacEncoderFactory),
        )
    }
    pub fn with_clock_and_audio_factory(
        clock: Arc<dyn RecordingClock>,
        audio_factory: Arc<dyn crate::recording_audio::RecordingAudioEncoderFactory>,
    ) -> Self {
        Self {
            state: Mutex::new(SessionState::default()),
            clock,
            audio_factory,
            frame_requester: None,
        }
    }

    pub fn start(
        &self,
        directory: &Path,
        width: u16,
        height: u16,
        fps: u32,
    ) -> Result<String, String> {
        self.start_with_audio(directory, width, height, fps, false)
    }
    pub fn start_with_audio(
        &self,
        directory: &Path,
        width: u16,
        height: u16,
        fps: u32,
        include_audio: bool,
    ) -> Result<String, String> {
        if width == 0 || height == 0 || width > 8192 || height > 8192 || fps == 0 || fps > 60 {
            return Err("잘못된 녹화 크기 또는 프레임 설정입니다.".into());
        }
        let mut state = self.state.lock().unwrap();
        if state.closed || state.job.is_some() {
            return Err("녹화 세션이 닫혔거나 이미 녹화 중입니다.".into());
        }
        let config = state
            .configuration
            .clone()
            .ok_or("영상 설정이 아직 없습니다.")?;
        let units = annex_b_units(&config)?;
        let sps = units
            .iter()
            .find(|u| u[0] & 31 == 7 && u.len() >= 4 && u.len() <= u16::MAX as usize)
            .ok_or("SPS 설정이 없습니다.")?
            .to_vec();
        let pps = units
            .iter()
            .find(|u| u[0] & 31 == 8 && u.len() <= u16::MAX as usize)
            .ok_or("PPS 설정이 없습니다.")?
            .to_vec();
        std::fs::create_dir_all(directory).map_err(|_| "녹화 캐시 폴더를 만들 수 없습니다.")?;
        let id = uuid::Uuid::new_v4().to_string();
        let path = directory.join(format!(".phone-recording-{id}.mp4"));
        let (input, receiver) = sync_channel::<RecordingInput>(64);
        let failed = Arc::new(AtomicBool::new(false));
        let worker_failed = failed.clone();
        let ready = Arc::new(AtomicBool::new(false));
        let worker_ready = ready.clone();
        let ended_at = Arc::new(Mutex::new(None));
        let worker_end = ended_at.clone();
        let encoder = if include_audio {
            Some(self.audio_factory.create()?)
        } else {
            None
        };
        if let Some(requester) = &self.frame_requester {
            requester.request_key_frame()?;
        }
        let clock = self.clock.clone();
        let worker = std::thread::spawn(move || {
            crate::recording_muxer::write_recording(
                crate::recording_muxer::RecordingWriterConfig {
                    file: RecordedFile { path },
                    width,
                    height,
                    fps,
                    sps,
                    pps,
                    audio: include_audio,
                    ready: worker_ready,
                },
                receiver,
                worker_failed,
                worker_end,
                clock,
                encoder,
            )
        });
        state.job = Some(RecordingJob {
            id: id.clone(),
            input: Some(input),
            budget: Arc::new(PacketBudget::new(RECORDING_QUEUE_BYTES)),
            failed,
            ready,
            paused: false,
            audio: include_audio,
            clock: self.clock.clone(),
            worker,
            ended_at,
        });
        Ok(id)
    }
    pub fn push(&self, packet: &[u8]) {
        let mut state = self.state.lock().unwrap();
        if state.closed {
            return;
        }
        let header = packet
            .get(..12)
            .and_then(|h| VideoPacketHeader::parse(h).ok())
            .filter(|h| packet.len() == 12 + h.payload_size);
        let Some(header) = header else {
            if let Some(job) = state.job.as_mut() {
                job.failed.store(true, Ordering::Release);
                job.stop_input();
            }
            return;
        };
        if header.configuration {
            let configuration = packet[12..].to_vec();
            if state.configuration.as_ref() != Some(&configuration) {
                if let Some(job) = state.job.as_mut() {
                    job.stop_input();
                }
            }
            state.configuration = Some(configuration);
            return;
        }
        if let Some(job) = state.job.as_mut() {
            if job.paused {
                return;
            }
            if let Some(input) = job.input.as_ref() {
                if !job.budget.reserve(packet.len()) {
                    job.failed.store(true, Ordering::Release);
                    job.stop_input();
                    return;
                }
                let queued = QueuedPacket {
                    bytes: packet.to_vec(),
                    budget: job.budget.clone(),
                    received_at: self.clock.now(),
                    audio: false,
                };
                match input.try_send(RecordingInput::Media(queued)) {
                    Ok(()) => {}
                    Err(std::sync::mpsc::TrySendError::Full(_)) => {
                        job.failed.store(true, Ordering::Release);
                        job.stop_input();
                    }
                    Err(std::sync::mpsc::TrySendError::Disconnected(_)) => job.stop_input(),
                }
            }
        }
    }
    pub fn push_audio(&self, packet: &[u8]) {
        let mut state = self.state.lock().unwrap();
        if state.closed {
            return;
        }
        if let Some(job) = state.job.as_mut() {
            if !job.audio || job.paused || job.input.is_none() {
                return;
            }
            if crate::recording_audio::validate_pcm_packet(packet).is_err()
                || !job.budget.reserve(packet.len())
            {
                job.failed.store(true, Ordering::Release);
                job.stop_input();
                return;
            }
            let queued = QueuedPacket {
                audio: true,
                bytes: packet.to_vec(),
                budget: job.budget.clone(),
                received_at: self.clock.now(),
            };
            match job
                .input
                .as_ref()
                .unwrap()
                .try_send(RecordingInput::Media(queued))
            {
                Ok(()) => {}
                Err(std::sync::mpsc::TrySendError::Full(_)) => {
                    job.failed.store(true, Ordering::Release);
                    job.stop_input();
                }
                Err(_) => job.stop_input(),
            }
        }
    }
    pub fn set_paused(&self, id: &str, paused: bool) -> Result<(), String> {
        let mut state = self.state.lock().unwrap();
        let job = state
            .job
            .as_mut()
            .filter(|job| job.id == id && job.input.is_some() && !job.worker.is_finished())
            .ok_or("활성 녹화가 없습니다.")?;
        if job.paused == paused {
            return Ok(());
        }
        if !paused {
            if let Some(requester) = &self.frame_requester {
                requester.request_key_frame()?;
            }
        }
        let marker = if paused {
            RecordingInput::Pause(self.clock.now())
        } else {
            RecordingInput::Resume(self.clock.now())
        };
        if job.input.as_ref().unwrap().try_send(marker).is_err() {
            job.failed.store(true, Ordering::Release);
            job.stop_input();
            return Err("녹화 조작 대기열 초과".into());
        }
        job.paused = paused;
        Ok(())
    }
    /// Initial startup succeeds only after the muxer accepts a fresh decodable video sample.
    pub async fn wait_until_ready(&self, id: &str) -> Result<(), String> {
        let result = tokio::time::timeout(Duration::from_secs(5), async {
            loop {
                {
                    let state = self.state.lock().unwrap();
                    let job = state
                        .job
                        .as_ref()
                        .filter(|job| job.id == id)
                        .ok_or("녹화 준비가 취소됐습니다.")?;
                    // A frame received just before disconnect still belongs to a saveable recording.
                    if job.ready.load(Ordering::Acquire) {
                        return Ok(());
                    }
                    if state.closed
                        || job.input.is_none()
                        || job.failed.load(Ordering::Acquire)
                        || job.worker.is_finished()
                    {
                        return Err("녹화 기준 프레임을 기다리는 중 연결이 종료됐습니다.".into());
                    }
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap_or_else(|_| Err("녹화 기준 프레임 준비 시간이 초과됐습니다.".into()));
        if result.is_err() {
            let _ = self.finish(id);
        }
        result
    }
    pub fn is_running(&self, id: &str) -> bool {
        self.state
            .lock()
            .unwrap()
            .job
            .as_ref()
            .is_some_and(|job| job.id == id && job.input.is_some() && !job.worker.is_finished())
    }
    pub fn has_job(&self) -> bool {
        self.state.lock().unwrap().job.is_some()
    }
    pub fn is_closed(&self) -> bool {
        self.state.lock().unwrap().closed
    }
    pub fn close(&self) {
        let mut state = self.state.lock().unwrap();
        state.closed = true;
        if let Some(job) = state.job.as_mut() {
            job.stop_input();
        }
    }
    pub fn finish(&self, id: &str) -> Result<RecordedFile, String> {
        let mut state = self.state.lock().unwrap();
        if !state.job.as_ref().is_some_and(|j| j.id == id) {
            return Err("녹화 식별자가 다릅니다.".into());
        }
        let mut job = state.job.take().unwrap();
        job.stop_input();
        drop(state);
        job.worker
            .join()
            .map_err(|_| "녹화 작업이 종료됐습니다.".to_string())?
    }
}
impl Drop for RecordingSession {
    fn drop(&mut self) {
        let state = self.state.get_mut().unwrap();
        if let Some(mut job) = state.job.take() {
            job.stop_input();
            let _ = job.worker.join();
        }
    }
}
