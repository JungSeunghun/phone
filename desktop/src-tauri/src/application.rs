use std::collections::{HashMap, VecDeque};
use tokio_util::sync::CancellationToken;

/// A stop is remembered even when it arrives before an IPC start command.
#[derive(Default)]
pub struct SessionRegistry {
    active: HashMap<String, CancellationToken>,
    stopped: VecDeque<String>,
}
impl SessionRegistry {
    pub fn start(&mut self, id: &str) -> Result<CancellationToken, String> {
        uuid::Uuid::parse_str(id).map_err(|_| "유효하지 않은 세션입니다.")?;
        if self.stopped.iter().any(|value| value == id) {
            return Err("이미 취소한 세션입니다.".into());
        }
        if self.active.contains_key(id) {
            return Err("이미 시작한 세션입니다.".into());
        }
        let replaced: Vec<_> = self.active.keys().cloned().collect();
        for id in replaced {
            self.stop(&id);
        }
        let token = CancellationToken::new();
        self.active.insert(id.into(), token.clone());
        Ok(token)
    }
    pub fn stop(&mut self, id: &str) {
        if let Some(token) = self.active.remove(id) {
            token.cancel();
        }
        if !self.stopped.iter().any(|value| value == id) {
            self.stopped.push_back(id.into());
        }
        while self.stopped.len() > 512 {
            self.stopped.pop_front();
        }
    }
    pub fn stop_all(&mut self) {
        let active: Vec<_> = self.active.keys().cloned().collect();
        for id in active {
            self.stop(&id);
        }
    }
}

/// The local input mailbox is independent of Tauri and tied to one session.
pub struct ControlSession {
    sender: tokio::sync::mpsc::Sender<Vec<u8>>,
    cancellation: CancellationToken,
}
impl ControlSession {
    pub fn new(cancellation: CancellationToken) -> (Self, tokio::sync::mpsc::Receiver<Vec<u8>>) {
        let (sender, receiver) = tokio::sync::mpsc::channel(64);
        (
            Self {
                sender,
                cancellation,
            },
            receiver,
        )
    }
    pub fn send(&self, input: &crate::interaction::ControlInput) -> Result<(), String> {
        let packet = input.encode()?;
        if self.cancellation.is_cancelled() {
            return Err("폰 입력 세션이 종료됐습니다.".into());
        }
        self.sender
            .try_send(packet)
            .map_err(|_| "폰 입력 채널이 혼잡하거나 닫혔습니다.".into())
    }
}
