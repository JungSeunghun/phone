use phone_mirror_desktop::{
    interaction::ControlInput,
    ios_keyboard::{IosKeyboardInputService, KeyboardPacketCipher},
};
use std::{sync::Arc, time::Duration};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::TcpStream,
};

#[test]
fn directional_cipher_rejects_replay_tampering_and_wrong_direction() {
    let secret = [1; 32];
    let challenge = [2; 16];
    let mut sender = KeyboardPacketCipher::new(&secret, &challenge, "desktop").unwrap();
    let mut receiver = KeyboardPacketCipher::new(&secret, &challenge, "desktop").unwrap();
    let frame = sender.seal("한日中ع😀".as_bytes()).unwrap();
    assert_eq!(receiver.open(&frame).unwrap(), "한日中ع😀".as_bytes());
    assert!(receiver.open(&frame).is_err());
    let mut wrong = KeyboardPacketCipher::new(&secret, &challenge, "keyboard").unwrap();
    assert!(wrong.open(&frame).is_err());
    let mut corrupt = frame.clone();
    *corrupt.last_mut().unwrap() ^= 1;
    let mut receiver = KeyboardPacketCipher::new(&secret, &challenge, "desktop").unwrap();
    assert!(receiver.open(&corrupt).is_err());
}
#[tokio::test]
async fn receiver_rejects_input_without_an_authenticated_keyboard_and_cancels() {
    let service = IosKeyboardInputService::default();
    let info = service.start("iphone-1".into()).await.unwrap();
    assert!(!service.status(&info.receiver_id).await.unwrap());
    assert!(service
        .send(
            &info.receiver_id,
            ControlInput::Paste {
                text: "中文".into()
            }
        )
        .await
        .is_err());
    assert!(service.start("iphone-2".into()).await.is_err());
    service.stop(&info.receiver_id).await.unwrap();
    service.stop(&info.receiver_id).await.unwrap();
    assert!(service.status(&info.receiver_id).await.is_err());
}
async fn packet(socket: &mut TcpStream, cipher: &mut KeyboardPacketCipher) -> Vec<u8> {
    let size = socket.read_u32().await.unwrap() as usize;
    let mut frame = vec![0; size + 4];
    frame[..4].copy_from_slice(&(size as u32).to_be_bytes());
    socket.read_exact(&mut frame[4..]).await.unwrap();
    cipher.open(&frame).unwrap()
}
async fn connect(code: &str) -> (TcpStream, KeyboardPacketCipher, KeyboardPacketCipher) {
    let parts: Vec<_> = code.split('|').collect();
    let port = parts[1].rsplit(':').next().unwrap();
    let secret: Vec<u8> = parts[2]
        .as_bytes()
        .chunks(2)
        .map(|v| u8::from_str_radix(std::str::from_utf8(v).unwrap(), 16).unwrap())
        .collect();
    let mut socket = TcpStream::connect(format!("127.0.0.1:{port}"))
        .await
        .unwrap();
    let mut challenge = [0; 20];
    socket.read_exact(&mut challenge).await.unwrap();
    assert_eq!(&challenge[..4], b"PMK1");
    let mut outgoing = KeyboardPacketCipher::new(&secret, &challenge[4..], "keyboard").unwrap();
    let mut incoming = KeyboardPacketCipher::new(&secret, &challenge[4..], "desktop").unwrap();
    socket
        .write_all(&outgoing.seal(b"{\"kind\":\"hello\"}").unwrap())
        .await
        .unwrap();
    assert_eq!(
        packet(&mut socket, &mut incoming).await,
        b"{\"kind\":\"ready\"}"
    );
    (socket, outgoing, incoming)
}
#[tokio::test]
async fn authenticated_unicode_waits_for_ack_and_rejects_stale_generation_on_reconnect() {
    let service = Arc::new(IosKeyboardInputService::default());
    let info = service.start("iphone".into()).await.unwrap();
    let (mut socket, mut outgoing, mut incoming) = connect(&info.codes[0]).await;
    let generation = service.generation(&info.receiver_id).await.unwrap();
    let task = {
        let service = service.clone();
        let id = info.receiver_id.clone();
        tokio::spawn(async move {
            service
                .send_for_generation(
                    &id,
                    ControlInput::Paste {
                        text: "한日中ع😀\n".into(),
                    },
                    generation,
                )
                .await
        })
    };
    let input: serde_json::Value =
        serde_json::from_slice(&packet(&mut socket, &mut incoming).await).unwrap();
    assert_eq!(input["text"], "한日中ع😀\n");
    assert!(!task.is_finished());
    socket
        .write_all(&outgoing.seal(b"{\"kind\":\"ack\"}").unwrap())
        .await
        .unwrap();
    task.await.unwrap().unwrap();
    drop(socket);
    while service.status(&info.receiver_id).await.unwrap() {
        tokio::task::yield_now().await;
    }
    let (_socket, _, _) = connect(&info.codes[0]).await;
    assert_ne!(
        service.generation(&info.receiver_id).await.unwrap(),
        generation
    );
    assert!(service
        .send_for_generation(
            &info.receiver_id,
            ControlInput::Paste {
                text: "late".into()
            },
            generation
        )
        .await
        .is_err());
    service.stop(&info.receiver_id).await.unwrap();
}
#[tokio::test]
async fn ack_timeout_boundary_and_shutdown_cancel_pending_input() {
    let service = Arc::new(IosKeyboardInputService::default());
    let info = service.start("iphone".into()).await.unwrap();
    let (mut socket, _, mut incoming) = connect(&info.codes[0]).await;
    let task = {
        let service = service.clone();
        let id = info.receiver_id.clone();
        tokio::spawn(async move {
            service
                .send(&id, ControlInput::Paste { text: "x".into() })
                .await
        })
    };
    packet(&mut socket, &mut incoming).await;
    tokio::time::pause();
    tokio::time::advance(Duration::from_millis(2999)).await;
    assert!(!task.is_finished());
    tokio::time::advance(Duration::from_millis(1)).await;
    assert!(task.await.unwrap().is_err());
    tokio::time::resume();
    let (mut socket, _, mut incoming) = connect(&info.codes[0]).await;
    let task = {
        let service = service.clone();
        let id = info.receiver_id.clone();
        tokio::spawn(async move {
            service
                .send(
                    &id,
                    ControlInput::Paste {
                        text: "cancel".into(),
                    },
                )
                .await
        })
    };
    packet(&mut socket, &mut incoming).await;
    service.stop(&info.receiver_id).await.unwrap();
    assert!(task.await.unwrap().is_err());
}
#[test]
fn validates_unicode_size_and_supported_editing_without_touch_control() {
    use phone_mirror_desktop::interaction::EditingKey;
    use phone_mirror_desktop::ios_keyboard::keyboard_input_payload;
    for text in [String::new(), "\0".into(), "x".repeat(262131)] {
        assert!(keyboard_input_payload(&ControlInput::Paste { text }).is_err());
    }
    for text in [" ".into(), "x".repeat(262130)] {
        assert!(keyboard_input_payload(&ControlInput::Paste { text }).is_ok());
    }
    assert!(keyboard_input_payload(&ControlInput::Back).is_err());
    assert!(keyboard_input_payload(&ControlInput::Key {
        key: EditingKey::Up
    })
    .is_err());
    assert!(keyboard_input_payload(&ControlInput::Key {
        key: EditingKey::Delete
    })
    .is_ok());
}
