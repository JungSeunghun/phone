use phone_mirror_desktop::{
    interaction::{ControlInput, EditingKey},
    ios_keyboard::IosKeyboardInputService,
};
use std::{path::PathBuf, time::Duration};
#[tokio::main]
async fn main() -> Result<(), String> {
    let path = PathBuf::from(std::env::args().nth(1).ok_or("Specify private code file")?);
    let service = IosKeyboardInputService::default();
    let info = service.start("synthetic-iphone".into()).await?;
    let parts: Vec<_> = info.codes[0].split('|').collect();
    let port = parts[1].rsplit(':').next().unwrap();
    let code = format!("PMK1|127.0.0.1:{port}|{}", parts[2]);
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&path)
        .map_err(|_| "Cannot create private code file")?;
    use std::io::Write;
    file.write_all(code.as_bytes())
        .map_err(|_| "Cannot write private code")?;
    drop(file);
    let result = tokio::time::timeout(Duration::from_secs(10), async {
        while !service.status(&info.receiver_id).await? {
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        for text in ["한日中ع😀e\u{301}", "한日中ع😀e\u{301}", "ZX"] {
            service
                .send(&info.receiver_id, ControlInput::Paste { text: text.into() })
                .await?;
        }
        for key in [
            EditingKey::Backspace,
            EditingKey::Left,
            EditingKey::Right,
            EditingKey::Enter,
        ] {
            service
                .send(&info.receiver_id, ControlInput::Key { key })
                .await?;
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|_| "Keyboard test timeout".to_string())
    .and_then(|v| v);
    service.stop(&info.receiver_id).await?;
    let _ = std::fs::remove_file(path);
    result?;
    println!("PASS: Rust desktop encrypted Unicode and editing inputs acknowledged by production Swift keyboard network (synthetic document)");
    Ok(())
}
