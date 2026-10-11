use phone_mirror_desktop::{
    domain::{ConnectionTransport, DeviceAvailability, MirrorSettings, VideoPacketHeader},
    infrastructure::{
        AdbCommandExecutor, AdbDeviceDiscovery, AndroidStreamService, MemoryBookmarkStore,
        ProcessAdbCommandExecutor, VideoPacketSink,
    },
};
use std::{
    fs::File,
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

struct FileVideoPacketSink {
    output: Mutex<File>,
    frames: AtomicUsize,
    started: Instant,
    timeline: Mutex<Vec<(f64, u64, bool)>>,
}
impl VideoPacketSink for FileVideoPacketSink {
    fn send(&self, packet: Vec<u8>) -> Result<(), String> {
        let header = VideoPacketHeader::parse(&packet[..12])?;
        self.output
            .lock()
            .unwrap()
            .write_all(&packet[12..])
            .map_err(|_| "검증 파일을 쓸 수 없습니다.")?;
        if !header.configuration {
            self.frames.fetch_add(1, Ordering::SeqCst);
            self.timeline.lock().unwrap().push((
                self.started.elapsed().as_secs_f64(),
                header.timestamp,
                header.key_frame,
            ));
        }
        Ok(())
    }
}
#[tokio::main]
async fn main() -> Result<(), String> {
    let arguments: Vec<_> = std::env::args().collect();
    if arguments.len() != 3 {
        return Err("Usage: android_stream_smoke usb|wifi OUTPUT.h264".into());
    }
    let transport = match arguments[1].as_str() {
        "usb" => ConnectionTransport::Usb,
        "wifi" => ConnectionTransport::Wifi,
        _ => return Err("Transport must be usb or wifi".into()),
    };
    let executor: Arc<dyn AdbCommandExecutor> = Arc::new(ProcessAdbCommandExecutor::locate()?);
    let discovery =
        AdbDeviceDiscovery::new(executor.clone(), Arc::new(MemoryBookmarkStore::default()));
    let devices = discovery.discover(CancellationToken::new()).await?;
    let device = devices
        .into_iter()
        .find(|device| {
            device.endpoint.transport == transport
                && device.availability == DeviceAvailability::Ready
        })
        .ok_or("No ready device for the requested transport")?;
    let sink = Arc::new(FileVideoPacketSink {
        output: Mutex::new(
            File::create(&arguments[2]).map_err(|_| "Could not create verification output")?,
        ),
        frames: AtomicUsize::new(0),
        started: Instant::now(),
        timeline: Mutex::new(Vec::new()),
    });
    let service = AndroidStreamService::new(
        executor,
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../Vendor/scrcpy-server-v5.0"),
    );
    let cancellation = CancellationToken::new();
    let stop_token = cancellation.clone();
    let timer = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(8)).await;
        stop_token.cancel();
    });
    let result = service
        .run(
            &device.endpoint,
            &MirrorSettings::default(),
            sink.clone(),
            cancellation,
        )
        .await;
    timer.abort();
    result?;
    let frames = sink.frames.load(Ordering::SeqCst);
    if frames == 0 {
        return Err("No actual video frames received".into());
    }
    println!(
        "PASS: {} physical Android frames over {:?}; session stopped and its forward removed",
        frames, transport
    );
    let timeline = sink.timeline.lock().unwrap();
    if timeline.len() > 1 {
        let duration = timeline.last().unwrap().0 - timeline[0].0;
        let mut gaps: Vec<f64> = timeline
            .windows(2)
            .map(|pair| (pair[1].0 - pair[0].0) * 1000.0)
            .collect();
        gaps.sort_by(f64::total_cmp);
        let keys: Vec<_> = timeline.iter().filter(|frame| frame.2).collect();
        let max_key_gap = keys
            .windows(2)
            .map(|pair| (pair[1].1 - pair[0].1) as f64 / 1000.0)
            .fold(0.0, f64::max);
        println!("RECEIVE: {:.2} fps; interarrival p95 {:.2} ms / max {:.2} ms; key-frame max gap {:.2} ms; {} key frames. Transport timing only, not native display latency.", (timeline.len()-1) as f64 / duration, gaps[(gaps.len()-1)*95/100], gaps.last().unwrap(), max_key_gap, keys.len());
    }
    Ok(())
}
