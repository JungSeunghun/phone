//! Short synthetic USB carrier simulation. Never opens Apple drivers or a physical phone.
use phone_mirror_desktop::{
    domain::VideoPacketHeader,
    infrastructure::{AudioPacketSink, VideoPacketSink},
    ios_usb::{decode_mux_header, AppleUsbMuxPort, IosUsbReceiverService},
    recording::RecordingSession,
};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc, Mutex,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use tokio_util::sync::CancellationToken;
struct Capture {
    recording: RecordingSession,
    id: Mutex<Option<String>>,
    directory: std::path::PathBuf,
    video: AtomicUsize,
    audio: AtomicUsize,
}
impl VideoPacketSink for Capture {
    fn send(&self, packet: Vec<u8>) -> Result<(), String> {
        self.recording.push(&packet);
        let header = VideoPacketHeader::parse(&packet[..12])?;
        if header.configuration && self.id.lock().unwrap().is_none() {
            *self.id.lock().unwrap() =
                Some(
                    self.recording
                        .start_with_audio(&self.directory, 64, 32, 30, true)?,
                );
        }
        self.video.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}
impl AudioPacketSink for Capture {
    fn send(&self, packet: Vec<u8>) -> Result<(), String> {
        self.recording.push_audio(&packet);
        self.audio.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
    fn status(&self, _: &str) {}
}
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let directory = std::path::PathBuf::from(
        std::env::args()
            .nth(1)
            .ok_or("ignored output directory required")?,
    );
    std::fs::create_dir_all(&directory)?;
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let receiver = Arc::new(IosUsbReceiverService::new(Arc::new(AppleUsbMuxPort::new(
        listener.local_addr()?,
    )?)));
    let cancel_daemon = CancellationToken::new();
    let stop = cancel_daemon.clone();
    let daemon = tokio::spawn(async move {
        let mut tasks = tokio::task::JoinSet::new();
        loop {
            tokio::select! {_=stop.cancelled()=>break,accepted=listener.accept()=>{
             let Ok((mut socket,_))=accepted else{break;};tasks.spawn(async move{
              let mut header=[0;16];socket.read_exact(&mut header).await?;let size=decode_mux_header(&header,1).map_err(std::io::Error::other)?;let mut payload=vec![0;size];socket.read_exact(&mut payload).await?;
              let request=plist::Value::from_reader_xml(payload.as_slice()).map_err(std::io::Error::other)?;
              let connect=request.as_dictionary().and_then(|v|v.get("MessageType")).and_then(plist::Value::as_string)==Some("Connect");
              let mut phone=if connect{Some(TcpStream::connect("127.0.0.1:27483").await?)}else{None};
              let body=if connect{"<plist><dict><key>MessageType</key><string>Result</string><key>Number</key><integer>0</integer></dict></plist>"}else{"<plist><dict><key>DeviceList</key><array><dict><key>DeviceID</key><integer>7</integer><key>Properties</key><dict><key>ConnectionType</key><string>USB</string><key>SerialNumber</key><string>synthetic-usb-iphone</string></dict></dict></array></dict></plist>"};
              let mut reply=Vec::new();for v in [(body.len()+16) as u32,1,8,1]{reply.extend(v.to_le_bytes());}reply.extend(body.as_bytes());socket.write_all(&reply).await?;
              if let Some(phone)=phone.as_mut(){tokio::io::copy_bidirectional(&mut socket,phone).await?;}Ok::<(),std::io::Error>(())
             });
            },_=tasks.join_next(),if !tasks.is_empty()=>{}}
        }
        tasks.abort_all();
        while tasks.join_next().await.is_some() {}
    });
    let info = receiver.start().await?;
    let code = directory.join("connection-code.txt");
    std::fs::write(&code, &info.codes[0])?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&code, std::fs::Permissions::from_mode(0o600))?;
    }
    let identity = tokio::time::timeout(std::time::Duration::from_secs(8), async {
        loop {
            if let Some(d) = receiver.discover().await.first() {
                assert_eq!(
                    d.endpoint.transport,
                    phone_mirror_desktop::domain::ConnectionTransport::Usb
                );
                break d.identity.clone();
            }
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await?;
    let capture = Arc::new(Capture {
        recording: RecordingSession::default(),
        id: Mutex::new(None),
        directory: directory.clone(),
        video: 0.into(),
        audio: 0.into(),
    });
    let cancel = CancellationToken::new();
    let worker = receiver.clone();
    let packets = capture.clone();
    let stop = cancel.clone();
    let task =
        tokio::spawn(async move { worker.run(&identity, packets.clone(), packets, stop).await });
    let result = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while capture.video.load(Ordering::SeqCst) < 10 || capture.audio.load(Ordering::SeqCst) < 10
        {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await;
    cancel.cancel();
    task.await??;
    receiver.stop(&info.receiver_id).await?;
    cancel_daemon.cancel();
    daemon.await?;
    std::fs::remove_file(code)?;
    result?;
    let id = capture
        .id
        .lock()
        .unwrap()
        .clone()
        .ok_or("recording not started")?;
    capture
        .recording
        .finish(&id)?
        .publish(&directory.join("synthetic-windows-usb.mp4"))?;
    println!(
        "Synthetic Swift USB listener → simulated usbmux daemon → Rust AV MP4: video={} audio={}",
        capture.video.load(Ordering::SeqCst),
        capture.audio.load(Ordering::SeqCst)
    );
    Ok(())
}
