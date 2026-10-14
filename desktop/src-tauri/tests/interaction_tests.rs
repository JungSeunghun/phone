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

#[test]
fn unicode_clipboard_packet_preserves_utf8_and_protocol_boundaries() {
    let text = "한국어 日本語 中文 العربية 👨‍👩‍👧‍👦\n e\u{301}";
    let bytes = ControlInput::Paste { text: text.into() }.encode().unwrap();
    assert_eq!(bytes[0], 9);
    assert_eq!(&bytes[1..9], &1_u64.to_be_bytes()); // acknowledgement required
    assert_eq!(bytes[9], 1);
    assert_eq!(&bytes[10..14], &(text.len() as u32).to_be_bytes());
    assert_eq!(&bytes[14..], text.as_bytes());
    for text in ["a".to_string(), " ".to_string(), "a".repeat((1 << 18) - 14)] {
        assert!(ControlInput::Paste { text }.encode().is_ok());
    }
    for text in [
        String::new(),
        "\0".into(),
        "a".repeat((1 << 18) - 13),
        "😀".repeat(65533),
    ] {
        assert!(ControlInput::Paste { text }.encode().is_err());
    }
}

#[test]
fn editing_keycodes_are_bounded_and_have_paired_down_up_events() {
    for (key, code) in [
        ("backspace", 67_u32),
        ("delete", 112),
        ("enter", 66),
        ("left", 21),
        ("right", 22),
        ("up", 19),
        ("down", 20),
    ] {
        let input: ControlInput =
            serde_json::from_value(serde_json::json!({"kind":"key", "key":key})).unwrap();
        let bytes = input.encode().unwrap();
        assert_eq!(bytes.len(), 28);
        assert_eq!(&bytes[..2], &[0, 0]);
        assert_eq!(&bytes[2..6], &code.to_be_bytes());
        assert_eq!(&bytes[14..16], &[0, 1]);
        assert_eq!(&bytes[16..20], &code.to_be_bytes());
    }
    assert!(serde_json::from_value::<ControlInput>(
        serde_json::json!({"kind":"key", "key":"power"})
    )
    .is_err());
}

#[tokio::test(start_paused = true)]
async fn clipboard_writer_waits_for_acknowledgement_and_android_paste_dispatch() {
    use phone_mirror_desktop::infrastructure::write_control;
    use std::time::Duration;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let (writer, mut device) = tokio::io::duplex(1024);
    let (sender, receiver) = tokio::sync::mpsc::channel(4);
    let cancellation = tokio_util::sync::CancellationToken::new();
    let token = cancellation.clone();
    let worker = tokio::spawn(async move { write_control(writer, receiver, token).await });
    let first = ControlInput::Paste { text: "日".into() }.encode().unwrap();
    let second = ControlInput::Paste { text: "本".into() }.encode().unwrap();
    sender.send(first.clone()).await.unwrap();
    sender.send(second.clone()).await.unwrap();
    let mut packet = vec![0; first.len()];
    device.read_exact(&mut packet).await.unwrap();
    assert_eq!(packet, first);
    device
        .write_all(&[1, 0, 0, 0, 0, 0, 0, 0, 1])
        .await
        .unwrap();
    tokio::task::yield_now().await;
    let read_next = tokio::spawn(async move {
        let mut packet = vec![0; second.len()];
        device.read_exact(&mut packet).await.unwrap();
        assert_eq!(packet, second);
        device
    });
    tokio::time::advance(Duration::from_millis(99)).await;
    tokio::task::yield_now().await;
    assert!(!read_next.is_finished());
    tokio::time::advance(Duration::from_millis(1)).await;
    tokio::task::yield_now().await;
    let _device = read_next.await.unwrap();
    cancellation.cancel();
    worker.await.unwrap().unwrap();
}
#[tokio::test(start_paused = true)]
async fn clipboard_acknowledgement_is_bounded_and_cancellation_discards_queued_text() {
    use phone_mirror_desktop::infrastructure::write_control;
    use std::time::Duration;
    use tokio::io::AsyncReadExt;
    for cancel in [false, true] {
        let (writer, mut device) = tokio::io::duplex(1024);
        let (sender, receiver) = tokio::sync::mpsc::channel(4);
        let token = tokio_util::sync::CancellationToken::new();
        let cancellation = token.clone();
        let worker = tokio::spawn(async move { write_control(writer, receiver, token).await });
        let packet = ControlInput::Paste {
            text: "中文".into(),
        }
        .encode()
        .unwrap();
        sender.send(packet.clone()).await.unwrap();
        sender.send(packet.clone()).await.unwrap();
        device.read_exact(&mut vec![0; packet.len()]).await.unwrap();
        if cancel {
            cancellation.cancel();
            assert!(worker.await.unwrap().is_ok());
        } else {
            tokio::time::advance(Duration::from_secs(2)).await;
            assert!(worker.await.unwrap().is_err());
        }
        let mut remaining = Vec::new();
        device.read_to_end(&mut remaining).await.unwrap();
        assert!(remaining.is_empty());
    }
}

#[test]
fn physical_keyboard_packets_never_use_the_clipboard_and_release_modifiers() {
    for (usage, modifiers) in [(4, 0), (10, 2), (0x52, 15), (0x63, 15)] {
        let input: ControlInput = serde_json::from_value(
            serde_json::json!({"kind":"keyboard", "usage":usage, "modifiers":modifiers}),
        )
        .unwrap();
        let packet = input.encode().unwrap();
        assert_eq!(packet.len(), 26);
        assert_eq!(&packet[..5], &[13, 0, 1, 0, 8]);
        assert_eq!(&packet[5..13], &[modifiers, 0, usage, 0, 0, 0, 0, 0]);
        assert_eq!(&packet[13..18], &[13, 0, 1, 0, 8]);
        assert_eq!(&packet[18..], &[0; 8]);
    }
    for (usage, modifiers) in [(0, 0), (3, 0), (100, 0), (256, 0), (4, 16)] {
        let parsed = serde_json::from_value::<ControlInput>(
            serde_json::json!({"kind":"keyboard", "usage":usage, "modifiers":modifiers}),
        );
        assert!(parsed.is_err() || parsed.unwrap().encode().is_err());
    }
}

#[tokio::test]
async fn physical_keyboard_is_created_once_and_removed_on_stop_without_clipboard_messages() {
    use phone_mirror_desktop::{
        infrastructure::write_control, interaction::keyboard_create_packet,
    };
    use tokio::io::AsyncReadExt;
    let (writer, mut device) = tokio::io::duplex(1024);
    let (sender, receiver) = tokio::sync::mpsc::channel(4);
    let token = tokio_util::sync::CancellationToken::new();
    let cancellation = token.clone();
    let worker = tokio::spawn(async move { write_control(writer, receiver, cancellation).await });
    let input: ControlInput =
        serde_json::from_value(serde_json::json!({"kind":"keyboard", "usage":4, "modifiers":2}))
            .unwrap();
    let key = input.encode().unwrap();
    sender.send(key.clone()).await.unwrap();
    sender.send(key.clone()).await.unwrap();
    let create = keyboard_create_packet();
    assert_eq!(create[0], 12);
    assert_eq!(&create[1..7], &[0, 1, 0, 0, 0, 0]);
    let name_length = create[7] as usize;
    let descriptor_length =
        u16::from_be_bytes([create[8 + name_length], create[9 + name_length]]) as usize;
    assert_eq!(descriptor_length + name_length + 10, create.len());
    let mut expected = create;
    expected.extend(&key);
    expected.extend(&key);
    let mut actual = vec![0; expected.len()];
    device.read_exact(&mut actual).await.unwrap();
    assert_eq!(actual, expected);
    token.cancel();
    worker.await.unwrap().unwrap();
    let mut destroy = Vec::new();
    device.read_to_end(&mut destroy).await.unwrap();
    assert_eq!(destroy, [14, 0, 1]);
}

#[tokio::test]
async fn explicit_paste_skips_keyboard_output_reports_without_losing_acknowledgement() {
    use phone_mirror_desktop::infrastructure::write_control;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    for size in [0_u16, 1, 4096, 4097] {
        let (writer, mut device) = tokio::io::duplex(1024);
        let (sender, receiver) = tokio::sync::mpsc::channel(4);
        let token = tokio_util::sync::CancellationToken::new();
        let cancellation = token.clone();
        let worker =
            tokio::spawn(async move { write_control(writer, receiver, cancellation).await });
        let paste = ControlInput::Paste {
            text: "한글".into(),
        }
        .encode()
        .unwrap();
        sender.send(paste.clone()).await.unwrap();
        device.read_exact(&mut vec![0; paste.len()]).await.unwrap();
        let mut report = vec![2, 0, 1];
        report.extend(size.to_be_bytes());
        device.write_all(&report).await.unwrap();
        if size > 4096 {
            assert!(worker.await.unwrap().is_err());
        } else {
            device.write_all(&vec![0; size as usize]).await.unwrap();
            device
                .write_all(&[1, 0, 0, 0, 0, 0, 0, 0, 1])
                .await
                .unwrap();
            let key = ControlInput::Key {
                key: phone_mirror_desktop::interaction::EditingKey::Enter,
            }
            .encode()
            .unwrap();
            sender.send(key.clone()).await.unwrap();
            let mut actual = vec![0; key.len()];
            device.read_exact(&mut actual).await.unwrap();
            assert_eq!(actual, key);
            token.cancel();
            worker.await.unwrap().unwrap();
        }
    }
}

#[tokio::test(start_paused = true)]
async fn cancelling_keyboard_registration_discards_the_first_and_queued_keys() {
    use phone_mirror_desktop::{
        infrastructure::write_control, interaction::keyboard_create_packet,
    };
    use tokio::io::AsyncReadExt;
    let (writer, mut device) = tokio::io::duplex(1024);
    let (sender, receiver) = tokio::sync::mpsc::channel(4);
    let token = tokio_util::sync::CancellationToken::new();
    let cancellation = token.clone();
    let worker = tokio::spawn(async move { write_control(writer, receiver, cancellation).await });
    let key = ControlInput::Keyboard {
        usage: 4,
        modifiers: 0,
    }
    .encode()
    .unwrap();
    sender.send(key.clone()).await.unwrap();
    sender.send(key).await.unwrap();
    device
        .read_exact(&mut vec![0; keyboard_create_packet().len()])
        .await
        .unwrap();
    token.cancel();
    worker.await.unwrap().unwrap();
    let mut remaining = Vec::new();
    device.read_to_end(&mut remaining).await.unwrap();
    assert_eq!(remaining, [14, 0, 1]);
}
