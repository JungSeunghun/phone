//! Bounded loopback receiver for the Swift synthetic sender, never real-device capture.
use phone_mirror_desktop::{
    infrastructure::{AudioPacketSink, VideoPacketSink},
    ios_wifi::IosWifiReceiverService,
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};
use tokio_util::sync::CancellationToken;
#[derive(Default)]
struct Counters {
    video: AtomicUsize,
    audio: AtomicUsize,
}
impl VideoPacketSink for Counters {
    fn send(&self, _: Vec<u8>) -> Result<(), String> {
        self.video.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}
impl AudioPacketSink for Counters {
    fn send(&self, _: Vec<u8>) -> Result<(), String> {
        self.audio.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn status(&self, _: &str) {}
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let path = std::env::args().nth(1).ok_or("code path required")?;
    let receiver = Arc::new(IosWifiReceiverService::default());
    let info = receiver.start_on("127.0.0.1:0").await?;
    std::fs::write(&path, &info.codes[0])?;
    let identity = tokio::time::timeout(std::time::Duration::from_secs(8), async {
        loop {
            if let Some(d) = receiver.discover().await.first() {
                break d.identity.clone();
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await
        }
    })
    .await?;
    let packets = Arc::new(Counters::default());
    let cancel = CancellationToken::new();
    let service = receiver.clone();
    let counters = packets.clone();
    let c = cancel.clone();
    let task =
        tokio::spawn(async move { service.run(&identity, counters.clone(), counters, c).await });
    let result = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while packets.video.load(Ordering::SeqCst) < 4 || packets.audio.load(Ordering::SeqCst) < 4 {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await
        }
    })
    .await;
    cancel.cancel();
    task.await??;
    receiver.cancel_all().await;
    std::fs::remove_file(path)?;
    result?;
    println!(
        "Swift→Rust encrypted TCP: video={} audio={}",
        packets.video.load(Ordering::SeqCst),
        packets.audio.load(Ordering::SeqCst)
    );
    Ok(())
}
