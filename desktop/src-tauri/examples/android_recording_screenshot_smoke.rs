//! Real Android recording + concurrent local PNG persistence. No media is printed or uploaded.
use phone_mirror_desktop::{
    domain::{parse_transports, DeviceAvailability, DeviceEndpoint, MirrorSettings},
    infrastructure::{
        AdbCommandExecutor, AndroidStreamService, AudioPacketSink, ProcessAdbCommandExecutor,
        StreamInteraction, VideoPacketSink,
    },
    media::{save_media, MediaFormat},
    recording::RecordingSession,
};
use std::{
    fs::File,
    io::Write,
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tokio_util::sync::CancellationToken;
struct Sink {
    raw: Mutex<File>,
    recording: Arc<RecordingSession>,
    packets: AtomicUsize,
}
impl VideoPacketSink for Sink {
    fn send(&self, packet: Vec<u8>) -> Result<(), String> {
        self.raw
            .lock()
            .unwrap()
            .write_all(&packet[12..])
            .map_err(|_| "Cannot write local stream")?;
        self.recording.push(&packet);
        self.packets.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}
struct Audio(Arc<RecordingSession>);
impl AudioPacketSink for Audio {
    fn send(&self, packet: Vec<u8>) -> Result<(), String> {
        self.0.push_audio(&packet);
        Ok(())
    }
    fn status(&self, _: &str) {}
}
async fn command(arguments: &[&str]) -> Result<Vec<u8>, String> {
    let output = tokio::time::timeout(
        Duration::from_secs(15),
        tokio::process::Command::new(arguments[0])
            .args(&arguments[1..])
            .kill_on_drop(true)
            .output(),
    )
    .await
    .map_err(|_| "Media tool timeout")?
    .map_err(|_| "Media tool unavailable")?;
    if !output.status.success() {
        return Err("Local media validation failed".into());
    }
    Ok(output.stdout)
}
#[tokio::main]
async fn main() -> Result<(), String> {
    let identifier = std::env::args()
        .nth(1)
        .ok_or("Usage: android_recording_screenshot_smoke ADB_IDENTIFIER")?;
    let directory = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("target/verification/recording-screenshot")
        .join(uuid::Uuid::new_v4().to_string());
    std::fs::create_dir_all(&directory)
        .map_err(|_| "Cannot create local verification directory")?;
    let raw = directory.join("stream.h264");
    let recording = Arc::new(RecordingSession::default());
    let sink = Arc::new(Sink {
        raw: Mutex::new(File::create(&raw).map_err(|_| "Cannot create local stream")?),
        recording: recording.clone(),
        packets: AtomicUsize::new(0),
    });
    let executor: Arc<dyn AdbCommandExecutor> = Arc::new(ProcessAdbCommandExecutor::locate()?);
    let listing = executor
        .execute(
            vec!["devices".into(), "-l".into()],
            None,
            CancellationToken::new(),
        )
        .await?;
    if !listing.success {
        return Err("Cannot discover the actual connection transport".into());
    }
    let transport = parse_transports(&listing.output)
        .into_iter()
        .find(|device| {
            device.identifier == identifier && device.availability == DeviceAvailability::Ready
        })
        .ok_or("Requested Android connection is not ready")?
        .transport;

    let service = AndroidStreamService::new(
        executor,
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../Vendor/scrcpy-server-v5.0"),
    );
    let endpoint = DeviceEndpoint {
        transport,
        address: identifier.clone(),
        identifier,
    };
    let stop = CancellationToken::new();
    let cancellation = stop.clone();
    let video = sink.clone();
    let audio = recording.clone();
    let (_sender, receiver) = tokio::sync::mpsc::channel(64);
    let worker = tokio::spawn(async move {
        service
            .run_interactive(
                &endpoint,
                &MirrorSettings::default(),
                video,
                StreamInteraction {
                    audio: Arc::new(Audio(audio)),
                    control: receiver,
                },
                cancellation,
            )
            .await
    });
    let result=async {
        tokio::time::timeout(Duration::from_secs(15),async{while sink.packets.load(Ordering::SeqCst)<2{tokio::time::sleep(Duration::from_millis(50)).await;}}).await.map_err(|_|"No physical Android video")?;
        let clicked=directory.join("clicked-frame.h264");std::fs::copy(&raw,&clicked).map_err(|_|"Cannot snapshot input")?;
        let dimensions:serde_json::Value=serde_json::from_slice(&command(&["ffprobe","-v","error","-select_streams","v:0","-show_entries","stream=width,height","-of","json",clicked.to_str().unwrap()]).await?).map_err(|_|"Invalid dimensions")?;
        let width=dimensions["streams"][0]["width"].as_u64().ok_or("Missing width")? as u16;
        let height=dimensions["streams"][0]["height"].as_u64().ok_or("Missing height")? as u16;
        let id=recording.start(&directory,width,height,60)?;
        tokio::time::sleep(Duration::from_secs(2)).await;
        let encoded=directory.join("encoded.png");
        for (name,paused) in [("during-recording.png",false),("during-pause.png",true)]{
            if paused{recording.set_paused(&id,true)?;}
            std::fs::copy(&raw,&clicked).map_err(|_|"Cannot snapshot input")?;
            command(&["ffmpeg","-v","error","-y","-i",clicked.to_str().unwrap(),"-fps_mode","passthrough","-update","1",encoded.to_str().unwrap()]).await?;
            let png=std::fs::read(&encoded).map_err(|_|"Cannot read screenshot")?;
            save_media(&directory.join(name),MediaFormat::Png,&png)?;
            assert!(recording.is_running(&id),"PNG save must preserve the recording job");
            assert!(save_media(&directory.join(name),MediaFormat::Png,&png).is_err());
            assert!(recording.is_running(&id),"PNG persistence failure must preserve recording");
            if paused{recording.set_paused(&id,false)?;}
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
        let output=directory.join("recording.mp4");recording.finish(&id)?.publish(&output)?;
        command(&["ffmpeg","-v","error","-i",output.to_str().unwrap(),"-f","null","-"]).await?;
        println!("PASS: real Android {transport:?} video {width}x{height}; PNG persistence during recording and pause (including duplicate-path failure); MP4 decoded fully; media retained only under ignored target output");
        Ok::<(),String>(())
    }.await;
    stop.cancel();
    tokio::time::timeout(Duration::from_secs(5), worker)
        .await
        .map_err(|_| "Cleanup timeout")?
        .map_err(|_| "Stream task failed")??;
    result
}
