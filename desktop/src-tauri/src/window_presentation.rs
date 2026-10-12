//! Window policy is independent of Tauri, the stream and operating system APIs.
use serde::{Deserialize, Serialize};
use std::time::Duration;

#[async_trait::async_trait]
pub trait FullscreenTransitionPort: Sync {
    fn now(&self) -> Duration;
    fn fullscreen(&self) -> Result<bool, String>;
    fn cancelled(&self) -> bool;
    async fn wait(&self, duration: Duration);
}

/// Wait for an OS acknowledgement, with injected time and no real timer in tests.
pub async fn await_fullscreen_transition(
    port: &impl FullscreenTransitionPort,
    expected: bool,
    timeout: Duration,
) -> Result<(), String> {
    if timeout.is_zero() {
        return Err("전체 화면 대기 시간이 올바르지 않습니다.".into());
    }
    let started = port.now();
    loop {
        if port.cancelled() {
            return Err("전체 화면 전환이 취소되었습니다.".into());
        }
        let elapsed = port
            .now()
            .checked_sub(started)
            .ok_or("전체 화면 전환 시각을 확인할 수 없습니다.")?;
        if elapsed <= timeout && port.fullscreen()? == expected {
            return Ok(());
        }
        if elapsed >= timeout {
            return Err("전체 화면 전환이 지연되고 있습니다. 잠시 후 다시 시도하세요.".into());
        }
        port.wait(Duration::from_millis(20).min(timeout - elapsed))
            .await;
    }
}
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum WindowViewMode {
    #[default]
    Normal,
    Fullscreen,
    Pip,
}
#[derive(Clone, Copy, Debug)]
pub struct WindowRectangle {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct WindowSnapshot {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub maximized: bool,
    pub always_on_top: bool,
}
pub trait WindowPresentationPort {
    fn snapshot(&self) -> Result<WindowSnapshot, String>;
    fn work_area(&self) -> Result<WindowRectangle, String>;
    fn apply(
        &self,
        mode: WindowViewMode,
        rectangle: Option<WindowRectangle>,
        snapshot: &WindowSnapshot,
    ) -> Result<(), String>;
}
/// Reserve native title bar/borders before calculating content size. Coordinates
/// remain outer-window coordinates; size is the usable content capacity.
pub fn window_content_area(
    area: WindowRectangle,
    frame: (f64, f64),
) -> Result<WindowRectangle, String> {
    if ![area.x, area.y, area.width, area.height, frame.0, frame.1]
        .iter()
        .all(|v| v.is_finite())
        || frame.0 < 0.0
        || frame.1 < 0.0
    {
        return Err("창 테두리와 모니터 영역을 확인할 수 없습니다.".into());
    }
    let content = WindowRectangle {
        width: area.width - frame.0,
        height: area.height - frame.1,
        ..area
    };
    if content.width < 240.0 || content.height < 180.0 {
        return Err("PiP 창을 표시할 모니터 공간이 부족합니다.".into());
    }
    Ok(content)
}
pub fn pip_rectangle(
    area: WindowRectangle,
    dimensions: (u32, u32),
) -> Result<WindowRectangle, String> {
    let (width, height) = dimensions;
    if !(1..=8192).contains(&width)
        || !(1..=8192).contains(&height)
        || ![area.x, area.y, area.width, area.height]
            .iter()
            .all(|v| v.is_finite())
        || area.width < 240.0
        || area.height < 180.0
    {
        return Err("PiP 화면 크기와 모니터 영역을 확인할 수 없습니다.".into());
    }
    let margin = 24.0_f64
        .min((area.width - 240.0) / 2.0)
        .min((area.height - 180.0) / 2.0);
    let available_width = area.width - margin * 2.0;
    let available_height = area.height - margin * 2.0;
    let ratio = f64::from(width) / f64::from(height);
    let mut w = if ratio > 1.0 { 520.0_f64 } else { 320.0_f64 };
    let mut h = ((w / ratio) + 60.0)
        .clamp(180.0, 620.0)
        .min(available_height);
    w = ((h - 60.0) * ratio)
        .clamp(240.0, 520.0)
        .min(available_width);
    h = h.max(180.0);
    Ok(WindowRectangle {
        x: area.x + area.width - w - margin,
        y: area.y + margin,
        width: w,
        height: h,
    })
}
#[derive(Default)]
pub struct WindowPresentation {
    mode: WindowViewMode,
    original: Option<WindowSnapshot>,
    normal_snapshot: Option<WindowSnapshot>,
    native_fullscreen: bool,
}
impl WindowPresentation {
    /// Observe OS transitions without issuing another transition or capturing
    /// fullscreen geometry as the normal window's restore rectangle.
    pub fn observe_native_fullscreen(
        &mut self,
        fullscreen: bool,
        normal_snapshot: Option<WindowSnapshot>,
    ) -> Result<bool, String> {
        if let Some(snapshot) = normal_snapshot {
            if ![snapshot.x, snapshot.y, snapshot.width, snapshot.height]
                .iter()
                .all(|value| value.is_finite())
                || snapshot.width <= 0.0
                || snapshot.height <= 0.0
            {
                return Err("기본 창 크기를 확인할 수 없습니다.".into());
            }
            if !fullscreen && self.mode == WindowViewMode::Normal {
                self.normal_snapshot = Some(snapshot);
            }
        }
        let previous = self.mode;
        if fullscreen {
            if self.mode == WindowViewMode::Normal {
                self.original = Some(
                    self.normal_snapshot
                        .ok_or("기본 창 위치가 준비되지 않았습니다.")?,
                );
                self.mode = WindowViewMode::Fullscreen;
            }
            self.native_fullscreen = self.mode == WindowViewMode::Fullscreen;
        } else if self.native_fullscreen {
            self.native_fullscreen = false;
            if self.mode == WindowViewMode::Fullscreen {
                self.mode = WindowViewMode::Normal;
                self.original = None;
            }
        }
        Ok(previous != self.mode)
    }
    pub fn mode(&self) -> WindowViewMode {
        self.mode
    }
    pub fn set_mode(
        &mut self,
        port: &impl WindowPresentationPort,
        mode: WindowViewMode,
        dimensions: Option<(u32, u32)>,
    ) -> Result<WindowViewMode, String> {
        if self.mode == mode {
            return Ok(mode);
        }
        let original = match self.original {
            Some(snapshot) => snapshot,
            None => port.snapshot()?,
        };
        let rectangle = if mode == WindowViewMode::Pip {
            Some(pip_rectangle(
                port.work_area()?,
                dimensions.ok_or("PiP를 시작하려면 폰 영상이 필요합니다.")?,
            )?)
        } else {
            None
        };
        // Retain the original geometry across PiP -> fullscreen -> normal.
        if self.mode != WindowViewMode::Normal && mode != WindowViewMode::Normal {
            port.apply(WindowViewMode::Normal, None, &original)?;
            self.mode = WindowViewMode::Normal;
        }
        if let Err(error) = port.apply(mode, rectangle, &original) {
            if mode != WindowViewMode::Normal {
                match port.apply(WindowViewMode::Normal, None, &original) {
                    Ok(()) => {
                        self.mode = WindowViewMode::Normal;
                        self.original = None;
                    }
                    Err(rollback) => {
                        self.original = Some(original);
                        self.mode = mode;
                        return Err(format!("{error} (창 복원 실패: {rollback})"));
                    }
                }
            }
            return Err(error);
        }
        self.mode = mode;
        if mode != WindowViewMode::Fullscreen {
            self.native_fullscreen = false;
        }
        self.original = if mode == WindowViewMode::Normal {
            None
        } else {
            Some(original)
        };
        Ok(mode)
    }
}
