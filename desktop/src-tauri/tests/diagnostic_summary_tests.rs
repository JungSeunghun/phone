use phone_mirror_desktop::diagnostic_summary::DiagnosticSummary;
#[test]
fn validates_summary_and_never_serializes_unstructured_private_fields() {
    let report: DiagnosticSummary=serde_json::from_str(r#"{"schemaVersion":1,"platform":"android","transport":"usb","checks":[{"code":"adb","status":"failed"}]}"#).unwrap();
    let result = report.serialize("0.2.0").unwrap();
    assert!(result.contains("0.2.0"));
    assert!(result.contains("failed"));
    for value in [
        r#"{"schemaVersion":2,"platform":"android","transport":"usb","checks":[]}"#,
        r#"{"schemaVersion":1,"platform":"android","transport":"usb","checks":[],"serial":"secret"}"#,
        r#"{"schemaVersion":1,"platform":"android","transport":"usb","checks":[{"code":"secret","status":"passed"}]}"#,
    ] {
        assert!(serde_json::from_str::<DiagnosticSummary>(value)
            .map_or(true, |report| report.serialize("0.2.0").is_err()));
    }
    assert!(report.serialize("not-a-version").is_err());
}
#[test]
fn summary_persistence_validates_boundaries_and_failures() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("summary.json");
    let empty: DiagnosticSummary = serde_json::from_str(
        r#"{"schemaVersion":1,"platform":"ios","transport":"wifi","checks":[]}"#,
    )
    .unwrap();
    empty.save("0.2.0", &path).unwrap();
    empty.save("0.2.0", &path).unwrap();
    assert!(std::fs::read_to_string(&path)
        .unwrap()
        .contains("appVersion"));
    assert!(empty
        .save("0.2.0", &directory.path().join("absent/report.json"))
        .is_err());
    let codes = [
        "adb",
        "android-device",
        "video-server",
        "wireless-discovery",
        "connection-port",
        "ios-native-usb",
        "apple-usb-devices",
        "ios-usb-receiver",
        "ios-wifi-receiver",
        "local-network",
    ];
    let checks: Vec<_> = codes
        .iter()
        .map(|code| serde_json::json!({"code":code,"status":"warning"}))
        .collect();
    let mut value = serde_json::json!({"schemaVersion":1,"platform":"android","transport":"usb","checks":checks});
    let maximum: DiagnosticSummary = serde_json::from_value(value.clone()).unwrap();
    assert!(maximum.serialize("0.2.0").is_ok());
    value["checks"]
        .as_array_mut()
        .unwrap()
        .push(serde_json::json!({"code":"adb","status":"passed"}));
    let excessive: DiagnosticSummary = serde_json::from_value(value).unwrap();
    assert!(excessive.serialize("0.2.0").is_err());
    let duplicate:DiagnosticSummary=serde_json::from_str(r#"{"schemaVersion":1,"platform":"ios","transport":"usb","checks":[{"code":"adb","status":"passed"},{"code":"adb","status":"failed"}]}"#).unwrap();
    assert!(duplicate.serialize("0.2.0").is_err());
}
