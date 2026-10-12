//! Local verification of release archives; does not install or contact a server.
use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let arguments: Vec<String> = std::env::args().collect();
    if arguments.len() != 3 {
        return Err("Use verify_application_update ARCHIVE VERSION".into());
    }
    let configuration: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json"))?;
    let key_text = String::from_utf8(
        STANDARD.decode(
            configuration["plugins"]["updater"]["pubkey"]
                .as_str()
                .ok_or("Missing pinned key")?,
        )?,
    )?;
    let key = PublicKey::decode(&key_text)?;
    let signature_text = String::from_utf8(
        STANDARD.decode(std::fs::read_to_string(format!("{}.sig", arguments[1]))?.trim())?,
    )?;
    let signature = Signature::decode(&signature_text)?;
    let bytes = std::fs::read(&arguments[1])?;
    key.verify(&bytes, &signature, false)?;
    let version = signature
        .trusted_comment()
        .split('\t')
        .find_map(|part| part.strip_prefix("version:"));
    if version != Some(arguments[2].as_str()) {
        return Err("Signed version does not match release version".into());
    }
    println!(
        "Verified release signature and signed version: {} ({} bytes)",
        arguments[2],
        bytes.len()
    );
    Ok(())
}
