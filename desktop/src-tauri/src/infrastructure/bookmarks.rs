use crate::domain::WirelessBookmark;
use std::{path::PathBuf, sync::Mutex};

pub trait BookmarkStore: Send + Sync {
    fn load(&self) -> Result<Vec<WirelessBookmark>, String>;
    fn save(&self, values: &[WirelessBookmark]) -> Result<(), String>;
}
#[derive(Default)]
pub struct MemoryBookmarkStore {
    values: Mutex<Vec<WirelessBookmark>>,
}
impl BookmarkStore for MemoryBookmarkStore {
    fn load(&self) -> Result<Vec<WirelessBookmark>, String> {
        Ok(self.values.lock().unwrap().clone())
    }
    fn save(&self, values: &[WirelessBookmark]) -> Result<(), String> {
        *self.values.lock().unwrap() = values.iter().filter(|v| v.is_valid()).cloned().collect();
        Ok(())
    }
}
pub struct JsonBookmarkStore {
    path: PathBuf,
}
impl JsonBookmarkStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }
}
impl BookmarkStore for JsonBookmarkStore {
    fn load(&self) -> Result<Vec<WirelessBookmark>, String> {
        let Ok(contents) = std::fs::read(&self.path) else {
            return Ok(Vec::new());
        };
        let values: Vec<WirelessBookmark> = serde_json::from_slice(&contents).unwrap_or_default();
        Ok(values
            .into_iter()
            .filter(WirelessBookmark::is_valid)
            .collect())
    }
    fn save(&self, values: &[WirelessBookmark]) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|_| "무선 기기 설정 폴더를 만들 수 없습니다.")?;
        }
        let valid: Vec<_> = values.iter().filter(|value| value.is_valid()).collect();
        let bytes = serde_json::to_vec_pretty(&valid)
            .map_err(|_| "무선 기기 설정을 변환할 수 없습니다.")?;
        // Replace through a sibling file so a partial write cannot corrupt JSON.
        self.path
            .parent()
            .ok_or("무선 기기 설정 경로가 없습니다.")?;
        let temporary = self
            .path
            .with_file_name(format!("wireless-{}.tmp", uuid::Uuid::new_v4()));
        std::fs::write(&temporary, bytes).map_err(|_| "무선 기기 설정을 저장할 수 없습니다.")?;
        let result = std::fs::rename(&temporary, &self.path)
            .map_err(|_| "무선 기기 설정을 교체할 수 없습니다.".to_string());
        if result.is_err() {
            std::fs::remove_file(temporary).ok();
        }
        result
    }
}
