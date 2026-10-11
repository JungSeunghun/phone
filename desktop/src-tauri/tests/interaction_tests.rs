use phone_mirror_desktop::interaction::{validate_audio_packet, ControlInput, TouchAction};
#[test]
fn control_encoding_and_coordinate_boundaries() {
    let input = ControlInput::Touch {
        action: TouchAction::Down,
        x: 0,
        y: 1919,
        width: 886,
        height: 1920,
    };
    let bytes = input.encode().unwrap();
    assert_eq!(bytes.len(), 32);
    assert_eq!(&bytes[..2], &[2, 0]);
    assert_eq!(&bytes[2..10], &(-2_i64).to_be_bytes());
    assert_eq!(&bytes[18..22], &[3, 118, 7, 128]);
    assert!(ControlInput::Touch {
        action: TouchAction::Up,
        x: 885,
        y: 1919,
        width: 886,
        height: 1920
    }
    .encode()
    .is_ok());
    for (x, y, w, h) in [
        (886, 0, 886, 1920),
        (0, 1920, 886, 1920),
        (0, 0, 0, 1),
        (0, 0, 8193, 1),
    ] {
        assert!(ControlInput::Touch {
            action: TouchAction::Move,
            x,
            y,
            width: w,
            height: h
        }
        .encode()
        .is_err());
    }
    assert_eq!(ControlInput::Back.encode().unwrap(), vec![4, 0, 4, 1]);
    assert!(ControlInput::Scroll {
        x: 1,
        y: 1,
        width: 2,
        height: 2,
        horizontal: f64::NAN,
        vertical: 0.
    }
    .encode()
    .is_err());
    assert!(ControlInput::Scroll {
        x: 1,
        y: 1,
        width: 2,
        height: 2,
        horizontal: 16.,
        vertical: -16.
    }
    .encode()
    .is_ok());
    assert!(ControlInput::Scroll {
        x: 1,
        y: 1,
        width: 2,
        height: 2,
        horizontal: 16.01,
        vertical: 0.
    }
    .encode()
    .is_err());
}
#[test]
fn audio_packets_reject_truncation_flags_misalignment_and_oversize() {
    let mut bytes = vec![0; 16];
    bytes[11] = 4;
    assert!(validate_audio_packet(&bytes).is_ok());
    assert!(validate_audio_packet(&bytes[..15]).is_err());
    bytes[0] = 0x40;
    assert!(validate_audio_packet(&bytes).is_err());
    bytes[0] = 0;
    bytes[11] = 3;
    assert!(validate_audio_packet(&bytes).is_err());
    let mut large = vec![0; 4109];
    large[8..12].copy_from_slice(&4097_u32.to_be_bytes());
    assert!(validate_audio_packet(&large).is_err());
}
#[tokio::test]
async fn input_writer_preserves_order_and_releases_a_pressed_pointer_on_stop() {
    use phone_mirror_desktop::infrastructure::write_control;
    use tokio::io::AsyncReadExt;
    let (writer, mut reader) = tokio::io::duplex(256);
    let (sender, receiver) = tokio::sync::mpsc::channel(4);
    let cancellation = tokio_util::sync::CancellationToken::new();
    let worker_token = cancellation.clone();
    let task = tokio::spawn(async move { write_control(writer, receiver, worker_token).await });
    sender
        .send(
            ControlInput::Touch {
                action: TouchAction::Down,
                x: 1,
                y: 1,
                width: 2,
                height: 2,
            }
            .encode()
            .unwrap(),
        )
        .await
        .unwrap();
    let mut down = [0; 32];
    reader.read_exact(&mut down).await.unwrap();
    assert_eq!(down[1], 0);
    cancellation.cancel();
    let mut cancel = [0; 32];
    reader.read_exact(&mut cancel).await.unwrap();
    assert_eq!(cancel[1], 3);
    assert_eq!(&cancel[22..24], &[0, 0]);
    task.await.unwrap().unwrap();
}
#[tokio::test]
async fn session_input_queue_rejects_closed_cancelled_and_overflowed_sessions() {
    use phone_mirror_desktop::application::ControlSession;
    let cancellation = tokio_util::sync::CancellationToken::new();
    let (session, mut receiver) = ControlSession::new(cancellation.clone());
    for _ in 0..64 {
        session.send(&ControlInput::Back).unwrap();
    }
    assert!(session.send(&ControlInput::Back).is_err());
    assert_eq!(receiver.recv().await.unwrap(), vec![4, 0, 4, 1]);
    session.send(&ControlInput::Back).unwrap();
    cancellation.cancel();
    assert!(session.send(&ControlInput::Back).is_err());
    let (session, receiver) = ControlSession::new(tokio_util::sync::CancellationToken::new());
    drop(receiver);
    assert!(session.send(&ControlInput::Back).is_err());
}
#[derive(Default)]
struct AudioProbe {
    packets: std::sync::atomic::AtomicUsize,
    status: tokio::sync::Notify,
}
impl phone_mirror_desktop::infrastructure::AudioPacketSink for AudioProbe {
    fn send(&self, _: Vec<u8>) -> Result<(), String> {
        self.packets
            .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        Ok(())
    }
    fn status(&self, _: &str) {
        self.status.notify_one();
    }
}
#[tokio::test]
async fn unsupported_audio_does_not_finish_the_video_session_and_stop_cancels_it() {
    use tokio::io::AsyncWriteExt;
    let (mut writer, reader) = tokio::io::duplex(64);
    let probe = std::sync::Arc::new(AudioProbe::default());
    let token = tokio_util::sync::CancellationToken::new();
    let sink = probe.clone();
    let cancellation = token.clone();
    let task = tokio::spawn(async move {
        phone_mirror_desktop::infrastructure::read_audio(reader, sink, cancellation).await
    });
    writer.write_all(&0_u32.to_be_bytes()).await.unwrap();
    probe.status.notified().await;
    assert!(!task.is_finished());
    token.cancel();
    task.await.unwrap().unwrap();
    assert_eq!(probe.packets.load(std::sync::atomic::Ordering::SeqCst), 0);
}
#[tokio::test]
async fn audio_rejects_large_payload_before_reading_it_and_cancels_partial_packets() {
    use tokio::io::AsyncWriteExt;
    for size in [4097_u32, 4096] {
        let (mut writer, reader) = tokio::io::duplex(64);
        let probe = std::sync::Arc::new(AudioProbe::default());
        let token = tokio_util::sync::CancellationToken::new();
        let sink = probe.clone();
        let cancellation = token.clone();
        let task = tokio::spawn(async move {
            phone_mirror_desktop::infrastructure::read_audio(reader, sink, cancellation).await
        });
        writer
            .write_all(&0x00726177_u32.to_be_bytes())
            .await
            .unwrap();
        let mut header = [0; 12];
        header[8..].copy_from_slice(&size.to_be_bytes());
        writer.write_all(&header).await.unwrap();
        if size == 4097 {
            probe.status.notified().await;
        } else {
            writer.write_all(&[0; 4]).await.unwrap();
        }
        token.cancel();
        task.await.unwrap().unwrap();
        assert_eq!(probe.packets.load(std::sync::atomic::Ordering::SeqCst), 0);
    }
}
