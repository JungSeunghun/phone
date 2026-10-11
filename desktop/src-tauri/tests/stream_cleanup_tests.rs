use async_trait::async_trait;
use phone_mirror_desktop::{
    domain::{ConnectionTransport, DeviceEndpoint, MirrorSettings},
    infrastructure::{AdbCommandExecutor, AndroidStreamService, CommandResult, VideoPacketSink},
};
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;
use tokio_util::sync::CancellationToken;

#[derive(Default)]
struct DelayedForwardExecutor {
    commands: Mutex<Vec<Vec<String>>>,
    forwarded: Notify,
    release: Notify,
}
#[async_trait]
impl AdbCommandExecutor for DelayedForwardExecutor {
    async fn execute(
        &self,
        arguments: Vec<String>,
        _: Option<String>,
        _: CancellationToken,
    ) -> Result<CommandResult, String> {
        self.commands.lock().unwrap().push(arguments.clone());
        let forward = arguments.get(2).is_some_and(|value| value == "forward")
            && arguments.get(3).is_some_and(|value| value == "tcp:0");
        if forward {
            self.forwarded.notify_one();
            self.release.notified().await;
        }
        Ok(CommandResult {
            success: true,
            output: if forward {
                "43210".into()
            } else {
                String::new()
            },
        })
    }
}
struct EmptySink;
impl VideoPacketSink for EmptySink {
    fn send(&self, _: Vec<u8>) -> Result<(), String> {
        Ok(())
    }
}
#[tokio::test]
async fn cancellation_during_forward_allocation_still_removes_the_allocated_port() {
    let executor = Arc::new(DelayedForwardExecutor::default());
    let service = AndroidStreamService::new(executor.clone(), "server.jar".into());
    let cancellation = CancellationToken::new();
    let worker_token = cancellation.clone();
    let worker = tokio::spawn(async move {
        service
            .run(
                &DeviceEndpoint {
                    transport: ConnectionTransport::Usb,
                    address: "A".into(),
                    identifier: "A".into(),
                },
                &MirrorSettings::default(),
                Arc::new(EmptySink),
                worker_token,
            )
            .await
    });
    executor.forwarded.notified().await;
    cancellation.cancel();
    executor.release.notify_one();
    worker.await.unwrap().unwrap();
    let calls = executor.commands.lock().unwrap();
    assert!(calls
        .iter()
        .any(|args| args == &["-s", "A", "forward", "--remove", "tcp:43210"]));
    assert!(calls
        .iter()
        .any(|args| args.get(3).is_some_and(|value| value == "rm")));
}
