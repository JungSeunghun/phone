//! Authenticated local input for an explicitly selected iPhone keyboard extension.
use crate::interaction::{validate_phone_text, ControlInput, EditingKey};
use aes_gcm::{
    aead::{Aead, KeyInit, Payload},
    Aes256Gcm, Nonce,
};
use serde::Serialize;
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Arc,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{mpsc, oneshot, Mutex},
    task::JoinSet,
    time::{timeout, Duration, Instant},
};
use tokio_util::sync::CancellationToken;

const MAXIMUM_PACKET_BYTES: usize = 2 * 1024 * 1024;
const INPUT_TIMEOUT: Duration = Duration::from_secs(3);
pub struct KeyboardPacketCipher {
    cipher: Aes256Gcm,
    counter: u64,
}
impl KeyboardPacketCipher {
    pub fn new(secret: &[u8], challenge: &[u8], direction: &str) -> Result<Self, String> {
        if secret.len() != 32
            || challenge.len() != 16
            || !["desktop", "keyboard"].contains(&direction)
        {
            return Err("잘못된 입력 키입니다.".into());
        }
        let mut key = [0; 32];
        hkdf::Hkdf::<sha2::Sha256>::new(Some(challenge), secret)
            .expand(
                format!("PhoneMirrorKeyboard/v1/{direction}").as_bytes(),
                &mut key,
            )
            .map_err(|_| "입력 키 생성 실패")?;
        Ok(Self {
            cipher: Aes256Gcm::new((&key).into()),
            counter: 0,
        })
    }
    pub fn seal(&mut self, plain: &[u8]) -> Result<Vec<u8>, String> {
        if plain.is_empty() || plain.len() > MAXIMUM_PACKET_BYTES - 24 || self.counter == u64::MAX {
            return Err("잘못된 입력 패킷입니다.".into());
        }
        let mut header = Vec::from(((plain.len() + 24) as u32).to_be_bytes());
        header.extend(self.counter.to_be_bytes());
        let mut nonce = [0; 12];
        nonce[4..].copy_from_slice(&self.counter.to_be_bytes());
        let encrypted = self
            .cipher
            .encrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: plain,
                    aad: &header,
                },
            )
            .map_err(|_| "입력 암호화 실패")?;
        header.extend(encrypted);
        self.counter += 1;
        Ok(header)
    }
    pub fn open(&mut self, frame: &[u8]) -> Result<Vec<u8>, String> {
        if frame.len() < 29
            || frame.len() > MAXIMUM_PACKET_BYTES + 4
            || self.counter == u64::MAX
            || u32::from_be_bytes(frame[..4].try_into().unwrap()) as usize != frame.len() - 4
            || u64::from_be_bytes(frame[4..12].try_into().unwrap()) != self.counter
        {
            return Err("잘못된 입력 순서입니다.".into());
        }
        let mut nonce = [0; 12];
        nonce[4..].copy_from_slice(&self.counter.to_be_bytes());
        let plain = self
            .cipher
            .decrypt(
                Nonce::from_slice(&nonce),
                Payload {
                    msg: &frame[12..],
                    aad: &frame[..12],
                },
            )
            .map_err(|_| "입력 인증 실패")?;
        self.counter += 1;
        Ok(plain)
    }
}
pub fn keyboard_input_payload(input: &ControlInput) -> Result<Vec<u8>, String> {
    let value = match input {
        ControlInput::Paste { text } => {
            validate_phone_text(text)?;
            serde_json::json!({"kind":"paste","text":text})
        }
        ControlInput::Key { key } => {
            let key = match key {
                EditingKey::Backspace => "backspace",
                EditingKey::Delete => "delete",
                EditingKey::Enter => "enter",
                EditingKey::Left => "left",
                EditingKey::Right => "right",
                _ => return Err("iPhone 키보드는 위·아래 이동을 지원하지 않습니다.".into()),
            };
            serde_json::json!({"kind":"key","key":key})
        }
        _ => return Err("iPhone은 텍스트 입력만 지원합니다.".into()),
    };
    serde_json::to_vec(&value).map_err(|_| "잘못된 입력입니다.".into())
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeyboardReceiverInfo {
    pub receiver_id: String,
    pub codes: Vec<String>,
}
struct PendingInput {
    payload: Vec<u8>,
    generation: u64,
    result: oneshot::Sender<Result<(), String>>,
}
struct KeyboardReceiver {
    info: KeyboardReceiverInfo,
    connected: Arc<AtomicBool>,
    generation: Arc<AtomicU64>,
    cancellation: CancellationToken,
    commands: mpsc::Sender<PendingInput>,
    task: tokio::task::JoinHandle<()>,
}
#[derive(Default)]
pub struct IosKeyboardInputService {
    active: Mutex<Option<KeyboardReceiver>>,
}
impl IosKeyboardInputService {
    pub async fn start(&self, target_id: String) -> Result<KeyboardReceiverInfo, String> {
        if target_id.is_empty() || target_id.len() > 256 || target_id.chars().any(char::is_control)
        {
            return Err("iPhone을 선택하세요.".into());
        }
        let mut active = self.active.lock().await;
        if active.is_some() {
            return Err("기존 iPhone 키보드 연결을 종료하세요.".into());
        }
        let listener = TcpListener::bind("0.0.0.0:0")
            .await
            .map_err(|_| "키보드 수신 포트를 열 수 없습니다.")?;
        let port = listener
            .local_addr()
            .map_err(|_| "키보드 주소가 없습니다.")?
            .port();
        let mut secret = [0; 32];
        secret[..16].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
        secret[16..].copy_from_slice(uuid::Uuid::new_v4().as_bytes());
        let mut addresses: Vec<String> = if_addrs::get_if_addrs()
            .unwrap_or_default()
            .into_iter()
            .filter_map(|interface| match interface.ip() {
                std::net::IpAddr::V4(ip) if !ip.is_loopback() && !ip.is_unspecified() => {
                    Some(ip.to_string())
                }
                _ => None,
            })
            .collect();
        addresses.sort();
        addresses.dedup();
        addresses.truncate(16);
        if addresses.is_empty() {
            addresses.push("127.0.0.1".into());
        }
        let key: String = secret.iter().map(|byte| format!("{byte:02x}")).collect();
        let info = KeyboardReceiverInfo {
            receiver_id: uuid::Uuid::new_v4().to_string(),
            codes: addresses
                .into_iter()
                .map(|ip| format!("PMK1|{ip}:{port}|{key}"))
                .collect(),
        };
        let connected = Arc::new(AtomicBool::new(false));
        let cancellation = CancellationToken::new();
        let (commands, mut requests) = mpsc::channel::<PendingInput>(32);
        let generation = Arc::new(AtomicU64::new(0));
        let connection_generation = generation.clone();
        let status = connected.clone();
        let cancel = cancellation.clone();
        let task = tokio::spawn(async move {
            // Only authenticated sockets enter the command loop. Idle peers cannot serialize admission.
            let mut handshakes = JoinSet::new();
            let mut attempts = std::collections::HashMap::<std::net::IpAddr, (Instant, u8)>::new();
            loop {
                let authenticated = tokio::select! {
                    biased;
                    _ = cancel.cancelled() => break,
                    result = handshakes.join_next(), if !handshakes.is_empty() => {
                        match result {
                            Some(Ok(Ok(connection))) => connection,
                            _ => continue,
                        }
                    }
                    result = listener.accept() => {
                        let Ok((socket, address)) = result else { break };
                        if !admit_keyboard_handshake(&mut attempts, address.ip(), handshakes.len(), Instant::now()) {
                            continue;
                        }
                        handshakes.spawn(authenticate_keyboard(socket, secret));
                        continue;
                    }
                };
                let (mut socket, mut incoming, mut outgoing) = authenticated;
                // Discard other pending handshakes once one peer owns the input session.
                handshakes.abort_all();
                while handshakes.join_next().await.is_some() {}
                let run = async {
                    let token = connection_generation.fetch_add(1, Ordering::SeqCst) + 1;
                    status.store(true, Ordering::SeqCst);
                    loop {
                        let request = tokio::select! {
                            request=requests.recv()=>request,
                            result=socket.read_u8()=>{let _=result;break;}
                        };
                        let Some(request) = request else { break };
                        if request.result.is_closed() {
                            continue;
                        }
                        if request.generation != token {
                            let _ = request
                                .result
                                .send(Err("이전 키보드 연결의 입력입니다.".into()));
                            continue;
                        }
                        let result = timeout(INPUT_TIMEOUT, async {
                            socket
                                .write_all(&outgoing.seal(&request.payload)?)
                                .await
                                .map_err(|_| "키보드 연결 종료")?;
                            let ack = read_packet(&mut socket, &mut incoming).await?;
                            if ack == b"{\"kind\":\"ack\"}" {
                                Ok(())
                            } else {
                                Err("iPhone 입력을 확인하지 못했습니다.".into())
                            }
                        })
                        .await
                        .unwrap_or_else(|_| Err("iPhone 입력 응답 시간이 초과됐습니다.".into()));
                        let failed = result.is_err();
                        let _ = request.result.send(result);
                        if failed {
                            break;
                        }
                    }
                    Ok::<(), String>(())
                };
                tokio::select! {biased;_=cancel.cancelled()=>{},_=run=>{}}
                status.store(false, Ordering::SeqCst);
                while let Ok(request) = requests.try_recv() {
                    let _ = request
                        .result
                        .send(Err("키보드 연결이 종료됐습니다.".into()));
                }
                if cancel.is_cancelled() {
                    break;
                }
            }
            handshakes.abort_all();
            while handshakes.join_next().await.is_some() {}
            status.store(false, Ordering::SeqCst);
        });
        *active = Some(KeyboardReceiver {
            info: info.clone(),
            connected,
            generation,
            cancellation,
            commands,
            task,
        });
        Ok(info)
    }
    pub async fn status(&self, id: &str) -> Result<bool, String> {
        let active = self.active.lock().await;
        let receiver = active
            .as_ref()
            .filter(|v| v.info.receiver_id == id)
            .ok_or("키보드 연결이 종료됐습니다.")?;
        Ok(receiver.connected.load(Ordering::SeqCst))
    }
    pub async fn send(&self, id: &str, input: ControlInput) -> Result<(), String> {
        let generation = self.generation(id).await?;
        self.send_for_generation(id, input, generation).await
    }
    pub async fn generation(&self, id: &str) -> Result<u64, String> {
        let active = self.active.lock().await;
        let receiver = active
            .as_ref()
            .filter(|v| v.info.receiver_id == id)
            .ok_or("키보드 연결이 종료됐습니다.")?;
        Ok(receiver.generation.load(Ordering::SeqCst))
    }
    pub async fn send_for_generation(
        &self,
        id: &str,
        input: ControlInput,
        generation: u64,
    ) -> Result<(), String> {
        let payload = keyboard_input_payload(&input)?;
        let active = self.active.lock().await;
        let receiver = active
            .as_ref()
            .filter(|v| v.info.receiver_id == id && v.connected.load(Ordering::SeqCst))
            .ok_or("iPhone에서 Phone Mirror 키보드를 선택하세요.")?;
        if receiver.generation.load(Ordering::SeqCst) != generation {
            return Err("이전 키보드 연결의 입력입니다.".into());
        }
        let commands = receiver.commands.clone();
        let cancellation = receiver.cancellation.clone();
        drop(active);
        let (result, reply) = oneshot::channel();
        commands
            .try_send(PendingInput {
                payload,
                generation,
                result,
            })
            .map_err(|_| "키보드 입력 대기열이 가득 찼습니다.")?;
        tokio::select! {biased;_=cancellation.cancelled()=>Err("키보드 연결이 종료됐습니다.".into()),result=reply=>result.unwrap_or_else(|_|Err("키보드 연결이 종료됐습니다.".into()))}
    }
    pub async fn stop(&self, id: &str) -> Result<(), String> {
        let mut active = self.active.lock().await;
        if active.as_ref().is_some_and(|v| v.info.receiver_id != id) {
            return Err("잘못된 키보드 연결입니다.".into());
        }
        let receiver = active.take();
        drop(active);
        if let Some(receiver) = receiver {
            receiver.cancellation.cancel();
            let _ = receiver.task.await;
        }
        Ok(())
    }
    pub async fn cancel_all(&self) {
        let id = self
            .active
            .lock()
            .await
            .as_ref()
            .map(|v| v.info.receiver_id.clone());
        if let Some(id) = id {
            let _ = self.stop(&id).await;
        }
    }
}
impl Drop for IosKeyboardInputService {
    fn drop(&mut self) {
        if let Some(receiver) = self.active.get_mut().take() {
            receiver.cancellation.cancel();
            receiver.task.abort();
        }
    }
}
async fn read_packet(
    socket: &mut TcpStream,
    cipher: &mut KeyboardPacketCipher,
) -> Result<Vec<u8>, String> {
    let size = socket.read_u32().await.map_err(|_| "키보드 연결 종료")? as usize;
    if !(25..=MAXIMUM_PACKET_BYTES).contains(&size) {
        return Err("잘못된 키보드 패킷 길이입니다.".into());
    }
    let mut frame = vec![0; size + 4];
    frame[..4].copy_from_slice(&(size as u32).to_be_bytes());
    socket
        .read_exact(&mut frame[4..])
        .await
        .map_err(|_| "키보드 연결 종료")?;
    cipher.open(&frame)
}

async fn authenticate_keyboard(
    mut socket: TcpStream,
    secret: [u8; 32],
) -> Result<(TcpStream, KeyboardPacketCipher, KeyboardPacketCipher), String> {
    // Bound the complete handshake, including writes and fragmented reads.
    timeout(Duration::from_secs(8), async move {
        let challenge = *uuid::Uuid::new_v4().as_bytes();
        socket
            .write_all(&[b"PMK1".as_slice(), &challenge].concat())
            .await
            .map_err(|_| "연결 종료")?;
        let mut incoming = KeyboardPacketCipher::new(&secret, &challenge, "keyboard")?;
        let mut outgoing = KeyboardPacketCipher::new(&secret, &challenge, "desktop")?;
        let hello = read_packet(&mut socket, &mut incoming).await?;
        if hello != b"{\"kind\":\"hello\"}" {
            return Err("키보드 인증 실패".into());
        }
        socket
            .write_all(&outgoing.seal(b"{\"kind\":\"ready\"}")?)
            .await
            .map_err(|_| "연결 종료")?;
        Ok((socket, incoming, outgoing))
    })
    .await
    .map_err(|_| "키보드 인증 시간 초과")?
}

fn admit_keyboard_handshake(
    attempts: &mut std::collections::HashMap<std::net::IpAddr, (Instant, u8)>,
    address: std::net::IpAddr,
    pending: usize,
    now: Instant,
) -> bool {
    attempts.retain(|_, (started, _)| now.duration_since(*started) < Duration::from_secs(8));
    if pending >= 4 || (!attempts.contains_key(&address) && attempts.len() >= 64) {
        return false;
    }
    let entry = attempts.entry(address).or_insert((now, 0));
    if entry.1 >= 8 {
        return false;
    }
    entry.1 += 1;
    true
}

#[cfg(test)]
mod admission_tests {
    use super::*;
    #[test]
    fn attempts_recover_exactly_at_window_boundary_without_sliding_on_rejection() {
        let mut attempts = std::collections::HashMap::new();
        let address = "127.0.0.1".parse().unwrap();
        let start = Instant::now();
        for _ in 0..8 {
            assert!(admit_keyboard_handshake(&mut attempts, address, 0, start));
        }
        assert!(!admit_keyboard_handshake(&mut attempts, address, 0, start));
        assert!(!admit_keyboard_handshake(
            &mut attempts,
            address,
            0,
            start + Duration::from_millis(7999)
        ));
        assert!(admit_keyboard_handshake(
            &mut attempts,
            address,
            0,
            start + Duration::from_secs(8)
        ));
        assert_eq!(attempts[&address].1, 1);
    }
    #[test]
    fn pending_connections_and_tracked_addresses_are_bounded() {
        let mut attempts = std::collections::HashMap::new();
        let start = Instant::now();
        let address = "127.0.0.1".parse().unwrap();
        assert!(!admit_keyboard_handshake(&mut attempts, address, 4, start));
        assert!(!admit_keyboard_handshake(
            &mut attempts,
            address,
            usize::MAX,
            start
        ));
        assert!(attempts.is_empty());
        for last in 1..=64 {
            let address = std::net::IpAddr::V4(std::net::Ipv4Addr::new(10, 0, 0, last));
            assert!(admit_keyboard_handshake(&mut attempts, address, 3, start));
        }
        assert!(!admit_keyboard_handshake(&mut attempts, address, 0, start));
        assert_eq!(attempts.len(), 64);
        assert!(admit_keyboard_handshake(
            &mut attempts,
            address,
            0,
            start + Duration::from_secs(8)
        ));
        assert_eq!(attempts.len(), 1);
    }
}
