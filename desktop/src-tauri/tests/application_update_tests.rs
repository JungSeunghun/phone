use phone_mirror_desktop::application_update::{validate_candidate, validate_endpoint};
#[test]
fn endpoint_policy() {
    assert!(validate_endpoint("https://example.org/latest.json").is_ok());
    for value in [
        "",
        "http://example.org/latest.json",
        "https://user:secret@example.org",
        "https://example.org/#fragment",
        "garbage",
    ] {
        assert!(validate_endpoint(value).is_err());
    }
}
#[test]
fn version_policy() {
    assert!(validate_candidate("0.1.0", "0.2.0").is_ok());
    for value in ["0.1.0", "0.0.9", "invalid", "0.2.0-beta.1"] {
        assert!(validate_candidate("0.1.0", value).is_err());
    }
}
#[test]
fn release_key_verifies_payload_and_rejects_modified_payload_or_version() {
    use base64::{engine::general_purpose::STANDARD, Engine};
    use minisign_verify::{PublicKey, Signature};
    let configuration: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
    assert_eq!(
        configuration["plugins"]["updater"]["requireSignedVersion"],
        true
    );
    let key_text = String::from_utf8(
        STANDARD
            .decode(
                configuration["plugins"]["updater"]["pubkey"]
                    .as_str()
                    .unwrap(),
            )
            .unwrap(),
    )
    .unwrap();
    let key = PublicKey::decode(&key_text).unwrap();
    let signature_text = String::from_utf8(
        STANDARD
            .decode(include_str!("fixtures-updater-payload.txt.sig").trim())
            .unwrap(),
    )
    .unwrap();
    let signature = Signature::decode(&signature_text).unwrap();
    let payload = include_bytes!("fixtures-updater-payload.txt");
    key.verify(payload, &signature, false).unwrap();
    assert!(signature.trusted_comment().contains("version:0.3.0"));
    assert!(key.verify(b"tampered", &signature, false).is_err());
    let modified =
        Signature::decode(&signature_text.replace("version:0.3.0", "version:0.4.0")).unwrap();
    assert!(key.verify(payload, &modified, false).is_err());
}
#[test]
fn installation_requires_idle_and_handles_activity_boundaries() {
    use phone_mirror_desktop::application_update::UpdateActivity;
    assert!(UpdateActivity::default().validate_installation().is_ok());
    for activity in [
        UpdateActivity {
            active_session: true,
            ..Default::default()
        },
        UpdateActivity {
            media_operations: 1,
            ..Default::default()
        },
        UpdateActivity {
            media_operations: usize::MAX,
            ..Default::default()
        },
        UpdateActivity {
            pending_recordings: true,
            ..Default::default()
        },
        UpdateActivity {
            background_tasks: true,
            ..Default::default()
        },
        UpdateActivity {
            closing: true,
            ..Default::default()
        },
    ] {
        assert!(activity.validate_installation().is_err());
    }
}
