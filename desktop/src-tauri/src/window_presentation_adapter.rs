use crate::window_presentation::*;
pub struct TauriWindowPresentationPort(pub tauri::WebviewWindow);
pub struct TauriFullscreenTransitionPort {
    pub window: tauri::WebviewWindow,
    pub started: tokio::time::Instant,
}
#[async_trait::async_trait]
impl FullscreenTransitionPort for TauriFullscreenTransitionPort {
    fn now(&self) -> std::time::Duration {
        self.started.elapsed()
    }
    fn fullscreen(&self) -> Result<bool, String> {
        self.window
            .is_fullscreen()
            .map_err(|error| error.to_string())
    }
    fn cancelled(&self) -> bool {
        crate::desktop::window_is_closing(&self.window)
    }
    async fn wait(&self, duration: std::time::Duration) {
        tokio::time::sleep(duration).await;
    }
}
impl WindowPresentationPort for TauriWindowPresentationPort {
    fn snapshot(&self) -> Result<WindowSnapshot, String> {
        let scale = self.0.scale_factor().map_err(|e| e.to_string())?;
        let position = self
            .0
            .outer_position()
            .map_err(|e| e.to_string())?
            .to_logical::<f64>(scale);
        let size = self
            .0
            .inner_size()
            .map_err(|e| e.to_string())?
            .to_logical::<f64>(scale);
        // Native macOS Spaces fullscreen must finish before resizing the window.
        if self.0.is_fullscreen().map_err(|e| e.to_string())? {
            return Err("시스템 전체 화면을 종료한 뒤 보기 방식을 변경하세요.".into());
        }
        Ok(WindowSnapshot {
            x: position.x,
            y: position.y,
            width: size.width,
            height: size.height,
            maximized: self.0.is_maximized().map_err(|e| e.to_string())?,
            always_on_top: self.0.is_always_on_top().map_err(|e| e.to_string())?,
        })
    }
    fn work_area(&self) -> Result<WindowRectangle, String> {
        let monitor = self
            .0
            .current_monitor()
            .map_err(|e| e.to_string())?
            .ok_or("현재 모니터를 확인할 수 없습니다.")?;
        let scale = monitor.scale_factor();
        let area = monitor.work_area();
        let position = area.position.to_logical::<f64>(scale);
        let size = area.size.to_logical::<f64>(scale);
        let outer = self
            .0
            .outer_size()
            .map_err(|e| e.to_string())?
            .to_logical::<f64>(scale);
        let inner = self
            .0
            .inner_size()
            .map_err(|e| e.to_string())?
            .to_logical::<f64>(scale);
        window_content_area(
            WindowRectangle {
                x: position.x,
                y: position.y,
                width: size.width,
                height: size.height,
            },
            (
                (outer.width - inner.width).max(0.0),
                (outer.height - inner.height).max(0.0),
            ),
        )
    }
    fn apply(
        &self,
        mode: WindowViewMode,
        rectangle: Option<WindowRectangle>,
        snapshot: &WindowSnapshot,
    ) -> Result<(), String> {
        let window = &self.0;
        let operation = || -> tauri::Result<()> {
            if mode == WindowViewMode::Fullscreen {
                window.set_always_on_top(snapshot.always_on_top)?;
                window.set_fullscreen(true)?;
                window.set_focus()?;
                window.as_ref().set_focus()?;
                return Ok(());
            }
            window.set_fullscreen(false)?;
            window.unmaximize()?;
            if mode == WindowViewMode::Pip {
                let r = rectangle.expect("validated PiP geometry");
                window.set_min_size(Some(tauri::LogicalSize::new(240.0, 180.0)))?;
                window.set_maximizable(false)?;
                window.set_size(tauri::LogicalSize::new(r.width, r.height))?;
                window.set_position(tauri::LogicalPosition::new(r.x, r.y))?;
                window.set_always_on_top(true)?;
            } else {
                window.set_always_on_top(snapshot.always_on_top)?;
                window.set_maximizable(true)?;
                window.set_min_size(Some(tauri::LogicalSize::new(800.0, 600.0)))?;
                window.set_size(tauri::LogicalSize::new(snapshot.width, snapshot.height))?;
                window.set_position(tauri::LogicalPosition::new(snapshot.x, snapshot.y))?;
                if snapshot.maximized {
                    window.maximize()?;
                }
            }
            window.set_focus()?;
            window.as_ref().set_focus()?;
            Ok(())
        };
        operation().map_err(|e| format!("창 보기 방식을 변경할 수 없습니다: {e}"))
    }
}
