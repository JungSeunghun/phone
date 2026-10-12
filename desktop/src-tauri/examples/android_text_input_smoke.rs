//! Explicit real-device check in an already focused Android Settings search field.
//! Dumps remain under ignored target output; never prints clipboard or device UI content.
use phone_mirror_desktop::{
    application::ControlSession,
    domain::{parse_transports, DeviceAvailability, DeviceEndpoint, MirrorSettings},
    infrastructure::*,
    interaction::{ControlInput, EditingKey},
};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
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
struct NoAudio;
impl AudioPacketSink for NoAudio {
    fn send(&self, _: Vec<u8>) -> Result<(), String> {
        Ok(())
    }
    fn status(&self, _: &str) {}
}
async fn focused_text(
    executor: &dyn AdbCommandExecutor,
    identifier: &str,
    output: &std::path::Path,
    stage: &str,
) -> Result<String, String> {
    let prefix = vec![
        "-s".to_string(),
        identifier.to_string(),
        "shell".to_string(),
    ];
    let mut args = prefix.clone();
    args.extend(
        [
            "uiautomator",
            "dump",
            "/data/local/tmp/phone-mirror-text-input.xml",
        ]
        .map(String::from),
    );
    if !executor
        .execute(args, None, CancellationToken::new())
        .await?
        .success
    {
        return Err("UI dump failed".into());
    }
    let mut args = prefix;
    args.extend(["cat", "/data/local/tmp/phone-mirror-text-input.xml"].map(String::from));
    let dump = executor
        .execute(args, None, CancellationToken::new())
        .await?;
    std::fs::write(output.join(format!("{stage}.xml")), &dump.output)
        .map_err(|_| "Cannot save local evidence")?;
    let node = dump
        .output
        .split("<node ")
        .find(|node| {
            let attributes = node.split('>').next().unwrap_or("");
            (attributes.contains("class=\"android.widget.EditText\"")
                || attributes.contains("class=\"android.widget.AutoCompleteTextView\""))
                && attributes.contains("focused=\"true\"")
                && (attributes.contains("package=\"com.android.settings\"")
                    || attributes.contains("package=\"com.android.settings.intelligence\""))
        })
        .ok_or("Focus an Android Settings search field first")?;
    let text = node
        .split("text=\"")
        .nth(1)
        .and_then(|s| s.split('"').next())
        .ok_or("Missing field text")?;
    let mut decoded = text.to_string();
    while let Some(start) = decoded.find("&#") {
        let end = decoded[start..].find(';').ok_or("Invalid XML entity")? + start;
        let number = &decoded[start + 2..end];
        let code = if let Some(hex) = number.strip_prefix('x') {
            u32::from_str_radix(hex, 16)
        } else {
            number.parse()
        }
        .map_err(|_| "Invalid XML codepoint")?;
        let character = char::from_u32(code).ok_or("Invalid XML character")?;
        decoded.replace_range(start..=end, &character.to_string());
    }
    Ok(decoded
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&amp;", "&"))
}
#[tokio::main]
async fn main() -> Result<(), String> {
    let identifier = std::env::args().nth(1).ok_or(
        "Usage: android_text_input_smoke ADB_IDENTIFIER (focus empty Settings search first)",
    )?;
    let output = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("target/verification/text-input");
    std::fs::create_dir_all(&output).map_err(|_| "Cannot create evidence directory")?;
    let executor: Arc<dyn AdbCommandExecutor> = Arc::new(ProcessAdbCommandExecutor::locate()?);
    let listing = executor
        .execute(
            vec!["devices".into(), "-l".into()],
            None,
            CancellationToken::new(),
        )
        .await?;
    if !listing.success {
        return Err("Cannot discover the actual connection transport".into());
    }
    let transport = parse_transports(&listing.output)
        .into_iter()
        .find(|device| {
            device.identifier == identifier && device.availability == DeviceAvailability::Ready
        })
        .ok_or("Requested Android connection is not ready")?
        .transport;

    let fixture_text = "Mirror 한국어 日本語 中文 العربية 😀 e\u{301}";
    let initial = focused_text(executor.as_ref(), &identifier, &output, "before").await?;
    let previous_fixture = initial == format!("{fixture_text}{fixture_text}日عZZ")
        || initial == fixture_text
        || initial == format!("{fixture_text}{fixture_text}")
        || initial == format!("{fixture_text}{fixture_text}한日中ع");
    if !previous_fixture
        && !initial.is_empty()
        && !["검색", "설정 검색", "Search", "Search settings"].contains(&initial.as_str())
    {
        return Err("Search field must be empty".into());
    }
    let endpoint = DeviceEndpoint {
        transport,
        address: identifier.clone(),
        identifier: identifier.clone(),
    };
    let cancellation = CancellationToken::new();
    let (control, receiver) = ControlSession::new(cancellation.clone());
    let video = Arc::new(VideoCounter::default());
    let service = AndroidStreamService::new(
        executor.clone(),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../Vendor/scrcpy-server-v5.0"),
    );
    let sink = video.clone();
    let stop = cancellation.clone();
    let task = tokio::spawn(async move {
        service
            .run_interactive(
                &endpoint,
                &MirrorSettings::default(),
                sink,
                StreamInteraction {
                    audio: Arc::new(NoAudio),
                    control: receiver,
                },
                stop,
            )
            .await
    });
    let result = async {
        tokio::time::timeout(Duration::from_secs(15), async {
            while video.0.load(Ordering::SeqCst) == 0 {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .map_err(|_| "No first video frame")?;
        if previous_fixture {
            for _ in 0..initial.chars().count() + 2 {
                control.send(&ControlInput::Key {
                    key: EditingKey::Backspace,
                })?;
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        }
        let text = fixture_text;
        control.send(&ControlInput::Paste { text: text.into() })?;
        tokio::time::sleep(Duration::from_millis(500)).await;
        if focused_text(executor.as_ref(), &identifier, &output, "unicode-paste").await? != text {
            return Err("Unicode paste mismatch".into());
        }
        // The same clipboard content must paste again even when Android already holds it.
        control.send(&ControlInput::Paste { text: text.into() })?;
        tokio::time::sleep(Duration::from_millis(500)).await;
        if focused_text(executor.as_ref(), &identifier, &output, "repeated-paste").await?
            != format!("{text}{text}")
        {
            return Err("Repeated paste mismatch".into());
        }
        // Immediate commits exercise the actual serialized control writer.
        for text in ["한", "日", "中", "ع", "Z"] {
            control.send(&ControlInput::Paste { text: text.into() })?;
        }
        control.send(&ControlInput::Key {
            key: EditingKey::Backspace,
        })?;
        tokio::time::sleep(Duration::from_millis(500)).await;
        if focused_text(executor.as_ref(), &identifier, &output, "direct-commits").await?
            != format!("{text}{text}한日中ع")
        {
            return Err("Ordered direct commits or Backspace mismatch".into());
        }
        Ok::<(), String>(())
    }
    .await;
    cancellation.cancel();
    tokio::time::timeout(Duration::from_secs(5), task)
        .await
        .map_err(|_| "Cleanup timeout")?
        .map_err(|_| "Stream task failed")??;
    result?;
    println!("PASS: real Android {transport:?} Unicode paste, repeated paste, ordered direct commits and Backspace; {} video packets; local XML evidence only", video.0.load(Ordering::SeqCst));
    Ok(())
}
