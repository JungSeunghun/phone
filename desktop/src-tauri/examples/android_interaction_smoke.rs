//! Samsung test fixture: push a generated WAV to /sdcard/Download/phone-mirror-test-tone.wav first.
use phone_mirror_desktop::{
    application::ControlSession,
    domain::{ConnectionTransport, DeviceAvailability, MirrorSettings},
    infrastructure::*,
    interaction::ControlInput,
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
#[derive(Default)]
struct VideoCounter(AtomicUsize);
impl VideoPacketSink for VideoCounter {
    fn send(&self, _: Vec<u8>) -> Result<(), String> {
        self.0.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}
struct AudioCapture {
    file: Mutex<File>,
    packets: AtomicUsize,
    nonzero: AtomicUsize,
}
impl AudioPacketSink for AudioCapture {
    fn send(&self, packet: Vec<u8>) -> Result<(), String> {
        self.packets.fetch_add(1, Ordering::SeqCst);
        self.nonzero.fetch_add(
            packet[12..]
                .chunks_exact(2)
                .filter(|sample| sample != &[0, 0])
                .count(),
            Ordering::SeqCst,
        );
        self.file
            .lock()
            .unwrap()
            .write_all(&packet[12..])
            .map_err(|error| error.to_string())
    }
    fn status(&self, message: &str) {
        eprintln!("Audio status: {message}");
    }
}
#[tokio::main]
async fn main() -> Result<(), String> {
    let arguments: Vec<_> = std::env::args().collect();
    if arguments.len() != 3 {
        return Err("Usage: android_interaction_smoke usb|wifi OUTPUT.pcm".into());
    }
    let transport = match arguments[1].as_str() {
        "usb" => ConnectionTransport::Usb,
        "wifi" => ConnectionTransport::Wifi,
        _ => return Err("Invalid transport".into()),
    };
    let executor: Arc<dyn AdbCommandExecutor> = Arc::new(ProcessAdbCommandExecutor::locate()?);
    let devices =
        AdbDeviceDiscovery::new(executor.clone(), Arc::new(MemoryBookmarkStore::default()))
            .discover(CancellationToken::new())
            .await?;
    let device = devices
        .into_iter()
        .find(|device| {
            device.endpoint.transport == transport
                && device.availability == DeviceAvailability::Ready
        })
        .ok_or("No ready device")?;
    let cancellation = CancellationToken::new();
    let (control, receiver) = ControlSession::new(cancellation.clone());
    let audio = Arc::new(AudioCapture {
        file: Mutex::new(File::create(&arguments[2]).map_err(|error| error.to_string())?),
        packets: AtomicUsize::new(0),
        nonzero: AtomicUsize::new(0),
    });
    let video = Arc::new(VideoCounter::default());
    let stop = cancellation.clone();
    let fixture_executor = executor.clone();
    let identifier = device.endpoint.identifier.clone();
    let fixture = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_secs(2)).await;
        fixture_executor.execute(vec!["-s".into(),identifier,"shell".into(),"am".into(),"start".into(),"-a".into(),"android.intent.action.VIEW".into(),"-t".into(),"audio/wav".into(),"-d".into(),"file:///sdcard/Download/phone-mirror-test-tone.wav".into(),"-n".into(),"com.samsung.android.app.soundpicker/com.samsung.android.app.musiclibrary.ui.player.soundplayer.SoundPlayerActivity".into()],None,stop.clone()).await?;
        tokio::time::sleep(Duration::from_secs(4)).await;
        control.send(&ControlInput::Back)?;
        tokio::time::sleep(Duration::from_secs(2)).await;
        stop.cancel();
        Ok::<(), String>(())
    });
    let service = AndroidStreamService::new(
        executor,
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../Vendor/scrcpy-server-v5.0"),
    );
    let result = service
        .run_interactive(
            &device.endpoint,
            &MirrorSettings::default(),
            video.clone(),
            StreamInteraction {
                audio: audio.clone(),
                control: receiver,
            },
            cancellation,
        )
        .await;
    if !fixture.is_finished() {
        fixture.abort();
    } else {
        fixture.await.map_err(|error| error.to_string())??;
    }
    result?;
    let frames = video.0.load(Ordering::SeqCst);
    let packets = audio.packets.load(Ordering::SeqCst);
    let nonzero = audio.nonzero.load(Ordering::SeqCst);
    if frames == 0 || packets == 0 || nonzero == 0 {
        return Err(format!(
            "No actual signal: video={frames},audio={packets},nonzero={nonzero}"
        ));
    }
    println!("PASS {:?}: video packets={frames}, PCM packets={packets}, nonzero samples={nonzero}; control Back sent, session cleaned",transport);
    Ok(())
}
