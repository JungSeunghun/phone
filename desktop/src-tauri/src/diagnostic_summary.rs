//! An allowlisted report format: no arbitrary messages, paths, identifiers or addresses.
use crate::domain::{ConnectionTransport, PhonePlatform};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SummaryCode {
    Adb,
    AndroidDevice,
    VideoServer,
    WirelessDiscovery,
    ConnectionPort,
    IosNativeUsb,
    AppleUsbDevices,
    IosUsbReceiver,
    IosWifiReceiver,
    LocalNetwork,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SummaryCheck {
    code: SummaryCode,
    status: crate::connection_diagnostics::DiagnosticStatus,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticSummary {
    schema_version: u8,
    platform: PhonePlatform,
    transport: ConnectionTransport,
    checks: Vec<SummaryCheck>,
}
impl DiagnosticSummary {
    pub fn serialize(&self, app_version: &str) -> Result<String, String> {
        if self.schema_version != 1
            || self.checks.len() > 10
            || semver::Version::parse(app_version).is_err()
        {
            return Err("진단 요약 형식이 잘못되었습니다.".into());
        }
        for (index, check) in self.checks.iter().enumerate() {
            if self.checks[..index]
                .iter()
                .any(|previous| previous.code == check.code)
            {
                return Err("진단 결과가 중복되었습니다.".into());
            }
        }
        let mut value = serde_json::to_value(self).map_err(|_| "진단 요약을 만들 수 없습니다.")?;
        value["appVersion"] = serde_json::Value::String(app_version.into());
        serde_json::to_string_pretty(&value)
            .map(|value| value + "\n")
            .map_err(|_| "진단 요약을 만들 수 없습니다.".into())
    }
    pub fn save(&self, app_version: &str, path: &std::path::Path) -> Result<(), String> {
        let text = self.serialize(app_version)?;
        std::fs::write(path, text).map_err(|_| "진단 요약을 저장하지 못했습니다.".into())
    }
}
