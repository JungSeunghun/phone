/// Update policy has no dependency on Tauri, UI, devices or storage.
pub fn validate_endpoint(value: &str) -> Result<url::Url, String> {
    let url = url::Url::parse(value).map_err(|_| "유효하지 않은 업데이트 주소입니다.")?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
    {
        return Err("업데이트 주소는 인증 정보와 #이 없는 HTTPS 주소여야 합니다.".into());
    }
    Ok(url)
}
pub fn validate_candidate(current: &str, candidate: &str) -> Result<(), String> {
    let current = semver::Version::parse(current).map_err(|_| "현재 버전이 잘못되었습니다.")?;
    let candidate =
        semver::Version::parse(candidate).map_err(|_| "업데이트 버전이 잘못되었습니다.")?;
    if candidate <= current || (current.pre.is_empty() && !candidate.pre.is_empty()) {
        return Err("현재 버전보다 새로운 정식 버전만 설치할 수 있습니다.".into());
    }
    Ok(())
}
#[derive(Default)]
pub struct UpdateActivity {
    pub active_session: bool,
    pub media_operations: usize,
    pub pending_recordings: bool,
    pub background_tasks: bool,
    pub closing: bool,
}
impl UpdateActivity {
    pub fn validate_installation(&self) -> Result<(), String> {
        if self.closing {
            return Err("앱을 종료하거나 업데이트하고 있습니다.".into());
        }
        if self.active_session
            || self.media_operations > 0
            || self.pending_recordings
            || self.background_tasks
        {
            return Err(
                "미러링을 중지하고 녹화·파일 저장과 기기 작업을 완료한 뒤 설치하세요.".into(),
            );
        }
        Ok(())
    }
}

pub fn configured_endpoint(configuration: &serde_json::Value) -> Option<String> {
    configuration
        .get("endpoints")?
        .as_array()?
        .first()?
        .as_str()
        .and_then(|value| validate_endpoint(value).ok())
        .map(|url| url.to_string())
}
