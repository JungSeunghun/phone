//! Worker-owned MP4 writer. Audio encoding and disk I/O never block live media sinks.
use crate::{
    domain::VideoPacketHeader,
    recording::{
        accept_recording_sample, annex_b_units, RecordedFile, RecordingClock, RecordingInput,
    },
    recording_audio::*,
};
use std::{
    collections::VecDeque,
    fs::{File, OpenOptions},
    io::{BufWriter, Read, Seek, SeekFrom},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::Receiver,
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
pub(crate) struct RecordingWriterConfig {
    pub file: RecordedFile,
    pub width: u16,
    pub height: u16,
    pub fps: u32,
    pub sps: Vec<u8>,
    pub pps: Vec<u8>,
    pub audio: bool,
    pub ready: Arc<AtomicBool>,
}
type Writer = mp4::Mp4Writer<BufWriter<File>>;
struct AudioTrack {
    encoder: Box<dyn RecordingAudioEncoder>,
    aligned: AlignedAudio,
    pending: Vec<i16>,
    packets: u64,
    last_timestamp: Option<u64>,
}
impl AudioTrack {
    fn bytes(
        &mut self,
        bytes: &[u8],
        writer: &mut Writer,
        size: &mut usize,
        count: &mut usize,
    ) -> Result<(), String> {
        for p in bytes.as_chunks::<2>().0 {
            self.pending.push(i16::from_le_bytes([p[0], p[1]]));
            if self.pending.len() == 2048 {
                let pcm = std::mem::take(&mut self.pending);
                let data = self.encoder.encode(&pcm)?;
                self.write(data, writer, size, count)?;
            }
        }
        Ok(())
    }
    fn write(
        &mut self,
        data: Vec<u8>,
        writer: &mut Writer,
        size: &mut usize,
        count: &mut usize,
    ) -> Result<(), String> {
        if !accept_recording_sample(*size, data.len(), *count) {
            return Err("녹화 용량 또는 샘플 한도 초과".into());
        }
        writer
            .write_sample(
                2,
                &mp4::Mp4Sample {
                    start_time: self.packets * 1024,
                    duration: 1024,
                    rendering_offset: 0,
                    is_sync: true,
                    bytes: data.clone().into(),
                },
            )
            .map_err(|_| "오디오 파일 쓰기 실패")?;
        self.packets += 1;
        *size += data.len();
        *count += 1;
        Ok(())
    }
    fn pad(
        &mut self,
        target: u64,
        writer: &mut Writer,
        size: &mut usize,
        count: &mut usize,
    ) -> Result<(), String> {
        while self.aligned.cursor() < target {
            let bytes = self.aligned.silence(target - self.aligned.cursor());
            self.bytes(&bytes, writer, size, count)?
        }
        Ok(())
    }
    fn packet(
        &mut self,
        packet: &[u8],
        timeline: &RecordingTimeline,
        maximum_output: u64,
        writer: &mut Writer,
        size: &mut usize,
        count: &mut usize,
    ) -> Result<(), String> {
        let h = VideoPacketHeader::parse(&packet[..12])?;
        if self.last_timestamp.is_some_and(|t| h.timestamp <= t) {
            return Err("녹화 오디오 시간이 역행했습니다.".into());
        }
        self.last_timestamp = Some(h.timestamp);
        let Some(base) = timeline.source_base() else {
            return Ok(());
        };
        let mut trim = 0;
        let mut pts = h.timestamp;
        if pts < base {
            let delta = base - pts;
            if delta >= (((packet.len() - 12) / 4) as u64 * 1_000_000).div_ceil(48000) {
                return Ok(());
            }
            trim = ((delta * 48000).div_ceil(1_000_000) as usize).min((packet.len() - 12) / 4);
            pts = base;
        }
        let data = &packet[12 + trim * 4..];
        if data.is_empty() {
            return Ok(());
        }
        let Some(output) = timeline.audio(pts) else {
            return Ok(());
        };
        if output > maximum_output {
            return Err("영상과 오디오 시간 차이가 너무 큽니다.".into());
        }
        let target = audio_sample_position(output)?;
        // Silence is encoded incrementally, never allocated proportional to a long gap.
        if target > self.aligned.cursor() + 96_000 {
            self.pad(target, writer, size, count)?
        }
        let bytes = self.aligned.append(output, data)?;
        self.bytes(&bytes, writer, size, count)
    }
}
pub(crate) fn write_recording(
    config: RecordingWriterConfig,
    receiver: Receiver<RecordingInput>,
    failed: Arc<AtomicBool>,
    ended_at: Arc<Mutex<Option<Instant>>>,
    clock: Arc<dyn RecordingClock>,
    encoder: Option<Box<dyn RecordingAudioEncoder>>,
) -> Result<RecordedFile, String> {
    let owned = config.file;
    let mut options = OpenOptions::new();
    options.write(true).read(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(owned.path())
        .map_err(|_| "녹화 임시 파일 생성 실패")?;
    let mut writer = mp4::Mp4Writer::write_start(
        BufWriter::new(file),
        &mp4::Mp4Config {
            major_brand: "isom".parse().unwrap(),
            minor_version: 512,
            compatible_brands: vec!["isom".parse().unwrap(), "avc1".parse().unwrap()],
            timescale: 1_000_000,
        },
    )
    .map_err(|_| "MP4 시작 실패")?;
    let mut video = mp4::TrackConfig::from(mp4::AvcConfig {
        width: config.width,
        height: config.height,
        seq_param_set: config.sps,
        pic_param_set: config.pps,
    });
    video.timescale = 1_000_000;
    writer
        .add_track(&video)
        .map_err(|_| "영상 트랙 생성 실패")?;
    let mut audio = if config.audio {
        let mut track = mp4::TrackConfig::from(mp4::AacConfig {
            bitrate: 128000,
            profile: mp4::AudioObjectType::AacLowComplexity,
            freq_index: mp4::SampleFreqIndex::Freq48000,
            chan_conf: mp4::ChannelConfig::Stereo,
        });
        track.timescale = 48000;
        writer
            .add_track(&track)
            .map_err(|_| "오디오 트랙 생성 실패")?;
        Some(AudioTrack {
            encoder: encoder.ok_or("오디오 인코더 없음")?,
            aligned: AlignedAudio::default(),
            pending: Vec::new(),
            packets: 0,
            last_timestamp: None,
        })
    } else {
        None
    };
    let mut timeline = RecordingTimeline::default();
    let mut pending: Option<mp4::Mp4Sample> = None;
    let mut buffered_audio = VecDeque::new();
    let mut size = 0;
    let mut count = 0;
    let mut last_duration = 1_000_000 / config.fps;
    let mut last_received = clock.now();
    let started = clock.now();
    let mut video_end = 0;
    let mut paused_at = None;
    let mut paused_time = Duration::ZERO;
    loop {
        let now = clock.now();
        let current_pause = paused_at
            .map(|at| now.saturating_duration_since(at))
            .unwrap_or_default();
        if now
            .saturating_duration_since(started)
            .saturating_sub(paused_time)
            .saturating_sub(current_pause)
            >= Duration::from_secs(3600)
        {
            break;
        }
        let input = match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(p) => p,
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => continue,
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
        };
        if failed.load(Ordering::Acquire) {
            return Err("녹화 대기열 초과 또는 손상된 패킷".into());
        }
        match input {
            RecordingInput::Pause(at) => {
                paused_at = Some(at);
                buffered_audio.clear();
                if let Some(mut sample) = pending.take() {
                    let tail = at
                        .saturating_duration_since(last_received)
                        .as_micros()
                        .min(u32::MAX as u128) as u32;
                    sample.duration = last_duration.max(tail);
                    video_end = sample.start_time + u64::from(sample.duration);
                    if let Some(a) = audio.as_ref() {
                        video_end = video_end.max(a.aligned.cursor() * 1_000_000 / 48000);
                        sample.duration = (video_end - sample.start_time)
                            .try_into()
                            .map_err(|_| "녹화 정지 시간 초과")?;
                    }
                    writer
                        .write_sample(1, &sample)
                        .map_err(|_| "영상 쓰기 실패")?;
                }
                timeline.pause(video_end)?;
                if let Some(a) = audio.as_mut() {
                    a.pad(
                        audio_sample_position(video_end)?,
                        &mut writer,
                        &mut size,
                        &mut count,
                    )?;
                    a.last_timestamp = None;
                }
            }
            RecordingInput::Resume(at) => {
                if let Some(paused) = paused_at.take() {
                    paused_time += at.saturating_duration_since(paused);
                }
                timeline.resume();
            }
            RecordingInput::Media(packet) => {
                let header = VideoPacketHeader::parse(&packet.bytes[..12])?;
                if packet.audio {
                    if timeline.source_base().is_none() {
                        buffered_audio.push_back(packet.bytes.clone());
                        while buffered_audio.len() > 64 {
                            buffered_audio.pop_front();
                        }
                    } else if let Some(a) = audio.as_mut() {
                        a.packet(
                            &packet.bytes,
                            &timeline,
                            pending.as_ref().map(|p| p.start_time).unwrap_or(video_end)
                                + clock
                                    .now()
                                    .saturating_duration_since(last_received)
                                    .as_micros()
                                    .min(3_600_000_000) as u64
                                + 250_000,
                            &mut writer,
                            &mut size,
                            &mut count,
                        )?
                    }
                    continue;
                }
                let units = annex_b_units(&packet.bytes[12..])?;
                if header.key_frame && !units.iter().any(|nal| nal[0] & 31 == 5) {
                    return Err("녹화 기준 프레임에 IDR 영상이 없습니다.".into());
                }
                let Some(relative) = timeline.video(header.timestamp, header.key_frame)? else {
                    continue;
                };
                let mut bytes = Vec::new();
                for nal in units {
                    if [7, 8].contains(&(nal[0] & 31)) {
                        continue;
                    }
                    bytes.extend((nal.len() as u32).to_be_bytes());
                    bytes.extend(nal);
                }
                if bytes.is_empty() {
                    continue;
                }
                if !accept_recording_sample(size, bytes.len(), count) {
                    break;
                }
                if let Some(mut previous) = pending.take() {
                    let duration = relative
                        .checked_sub(previous.start_time)
                        .filter(|v| *v > 0 && *v <= u32::MAX as u64)
                        .ok_or("녹화 시간 간격 오류")?;
                    last_duration = duration as u32;
                    previous.duration = last_duration;
                    writer
                        .write_sample(1, &previous)
                        .map_err(|_| "영상 쓰기 실패")?;
                }
                last_received = packet.received_at;
                size += bytes.len();
                count += 1;
                pending = Some(mp4::Mp4Sample {
                    start_time: relative,
                    duration: last_duration,
                    rendering_offset: 0,
                    is_sync: header.key_frame,
                    bytes: bytes.into(),
                });
                config.ready.store(true, Ordering::Release);
                if let Some(a) = audio.as_mut() {
                    while let Some(bytes) = buffered_audio.pop_front() {
                        a.packet(
                            &bytes,
                            &timeline,
                            relative + 250_000,
                            &mut writer,
                            &mut size,
                            &mut count,
                        )?
                    }
                }
            }
        }
    }
    if failed.load(Ordering::Acquire) {
        return Err("녹화 대기열 초과 또는 손상된 패킷".into());
    }
    if let Some(mut sample) = pending {
        let ended = ended_at.lock().unwrap().unwrap_or_else(|| clock.now());
        let tail = ended
            .saturating_duration_since(last_received)
            .as_micros()
            .min(u32::MAX as u128) as u32;
        sample.duration = last_duration.max(tail);
        video_end = sample.start_time + u64::from(sample.duration);
        if let Some(a) = audio.as_ref() {
            video_end = video_end.max(a.aligned.cursor() * 1_000_000 / 48000);
            sample.duration = (video_end - sample.start_time)
                .try_into()
                .map_err(|_| "녹화 시간 초과")?;
        }
        writer
            .write_sample(1, &sample)
            .map_err(|_| "마지막 영상 쓰기 실패")?;
    }
    if video_end == 0 {
        return Err("녹화할 기준 프레임을 받지 못했습니다.".into());
    }
    if let Some(a) = audio.as_mut() {
        a.pad(
            audio_sample_position(video_end)?,
            &mut writer,
            &mut size,
            &mut count,
        )?;
        if !a.pending.is_empty() {
            a.pending.resize(2048, 0);
            let pcm = std::mem::take(&mut a.pending);
            let data = a.encoder.encode(&pcm)?;
            a.write(data, &mut writer, &mut size, &mut count)?;
        }
        let data = a.encoder.flush()?;
        a.write(data, &mut writer, &mut size, &mut count)?;
    }
    writer.write_end().map_err(|_| "MP4 마무리 실패")?;
    let mut file = writer
        .into_writer()
        .into_inner()
        .map_err(|_| "파일 버퍼 저장 실패")?;
    if config.audio {
        apply_audio_edit(&mut file, video_end)?;
    }
    file.sync_all().map_err(|_| "파일 저장 실패")?;
    if file.metadata().map_err(|_| "파일 크기 없음")?.len() > crate::media::MEDIA_BYTE_LIMIT as u64
    {
        return Err("녹화 파일 용량 초과".into());
    }
    Ok(owned)
}
/// Skip AAC's 1024-sample analysis delay, and trim padding to the exact video duration.
fn apply_audio_edit(file: &mut File, duration: u64) -> Result<(), String> {
    use mp4::WriteBox;
    let size = file.metadata().map_err(|_| "MP4 크기 오류")?.len();
    file.seek(SeekFrom::Start(0)).map_err(|_| "MP4 위치 오류")?;
    let mut reader =
        mp4::Mp4Reader::read_header(&mut *file, size).map_err(|_| "MP4 편집 읽기 오류")?;
    reader.moov.mvhd.duration = duration;
    for track in &mut reader.moov.traks {
        track.tkhd.duration = duration;
        if track.tkhd.track_id == 2 {
            let mut edits = track.edts.take().unwrap_or_default();
            let mut list = edits.elst.take().unwrap_or_default();
            list.version = 1;
            list.entries.resize(1, Default::default());
            list.entries[0].segment_duration = duration;
            list.entries[0].media_time = 1024;
            list.entries[0].media_rate = 1;
            list.entries[0].media_rate_fraction = 0;
            edits.elst = Some(list);
            track.edts = Some(edits);
        }
    }

    let moov = reader.moov;
    file.seek(SeekFrom::Start(0)).map_err(|_| "MP4 위치 오류")?;
    let mut offset = 0;
    loop {
        let mut h = [0; 8];
        file.read_exact(&mut h).map_err(|_| "MP4 박스 오류")?;
        let mut length = u32::from_be_bytes(h[..4].try_into().unwrap()) as u64;
        if length == 1 {
            let mut extended = [0; 8];
            file.read_exact(&mut extended)
                .map_err(|_| "MP4 확장 박스 오류")?;
            length = u64::from_be_bytes(extended);
        }
        if &h[4..] == b"moov" {
            file.seek(SeekFrom::Start(offset))
                .map_err(|_| "MP4 위치 오류")?;
            moov.write_box(&mut *file)
                .map_err(|_| "MP4 오디오 편집 오류")?;
            let end = file.stream_position().map_err(|_| "MP4 위치 오류")?;
            file.set_len(end).map_err(|_| "MP4 마무리 크기 오류")?;
            return Ok(());
        }
        if length < 8 || offset + length >= size {
            return Err("MP4 구조 오류".into());
        }
        offset += length;
        file.seek(SeekFrom::Start(offset))
            .map_err(|_| "MP4 위치 오류")?;
    }
}
