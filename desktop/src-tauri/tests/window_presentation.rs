use phone_mirror_desktop::window_presentation::*;
use std::cell::RefCell;
#[derive(Default)]
struct FakeWindow {
    calls: RefCell<Vec<String>>,
    fail: RefCell<bool>,
}
impl WindowPresentationPort for FakeWindow {
    fn snapshot(&self) -> Result<WindowSnapshot, String> {
        Ok(WindowSnapshot {
            x: -900.0,
            y: 50.0,
            width: 1120.0,
            height: 780.0,
            maximized: true,
            always_on_top: false,
        })
    }
    fn work_area(&self) -> Result<WindowRectangle, String> {
        Ok(WindowRectangle {
            x: -1440.0,
            y: 24.0,
            width: 1440.0,
            height: 876.0,
        })
    }
    fn apply(
        &self,
        mode: WindowViewMode,
        rectangle: Option<WindowRectangle>,
        snapshot: &WindowSnapshot,
    ) -> Result<(), String> {
        self.calls.borrow_mut().push(format!("{mode:?}"));
        if *self.fail.borrow() {
            *self.fail.borrow_mut() = false;
            return Err("native failure".into());
        }
        if mode == WindowViewMode::Pip {
            let r = rectangle.unwrap();
            assert!(r.x >= -1440.0 && r.x + r.width <= 0.0);
        }
        if mode == WindowViewMode::Normal {
            assert_eq!(snapshot.x, -900.0);
            assert!(snapshot.maximized);
        }
        Ok(())
    }
}
#[test]
fn transitions_restore_original_snapshot_and_ignore_repeated_actions() {
    let window = FakeWindow::default();
    let mut presentation = WindowPresentation::default();
    assert_eq!(
        presentation
            .set_mode(&window, WindowViewMode::Pip, Some((886, 1920)))
            .unwrap(),
        WindowViewMode::Pip
    );
    presentation
        .set_mode(&window, WindowViewMode::Pip, None)
        .unwrap();
    assert_eq!(window.calls.borrow().len(), 1);
    presentation
        .set_mode(&window, WindowViewMode::Fullscreen, None)
        .unwrap();
    presentation
        .set_mode(&window, WindowViewMode::Normal, None)
        .unwrap();
    assert_eq!(
        *window.calls.borrow(),
        vec!["Pip", "Normal", "Fullscreen", "Normal"]
    );
    assert_eq!(presentation.mode(), WindowViewMode::Normal);
}
#[test]
fn failure_rolls_back_and_keeps_mode_and_snapshot() {
    let window = FakeWindow::default();
    let mut p = WindowPresentation::default();
    *window.fail.borrow_mut() = true;
    assert!(p
        .set_mode(&window, WindowViewMode::Pip, Some((1, 8192)))
        .is_err());
    assert_eq!(p.mode(), WindowViewMode::Normal);
    assert_eq!(*window.calls.borrow(), vec!["Pip", "Normal"]);
    p.set_mode(&window, WindowViewMode::Pip, Some((8192, 1)))
        .unwrap();
    *window.fail.borrow_mut() = true;
    assert!(p.set_mode(&window, WindowViewMode::Normal, None).is_err());
    assert_eq!(p.mode(), WindowViewMode::Pip);
    p.set_mode(&window, WindowViewMode::Normal, None).unwrap();
}
#[test]
fn pip_geometry_validates_boundaries_and_fits_negative_monitor_coordinates() {
    let area = WindowRectangle {
        x: -1000.0,
        y: -500.0,
        width: 1000.0,
        height: 700.0,
    };
    for dimensions in [(1, 1), (8192, 1), (1, 8192), (886, 1920), (1920, 886)] {
        let r = pip_rectangle(area, dimensions).unwrap();
        assert!(r.width >= 240.0 && r.height >= 180.0);
        assert!(
            r.x >= area.x
                && r.y >= area.y
                && r.x + r.width <= area.x + area.width
                && r.y + r.height <= area.y + area.height
        );
    }
    for dimensions in [(0, 1), (1, 0), (8193, 1), (1, 8193)] {
        assert!(pip_rectangle(area, dimensions).is_err());
    }
    for width in [0.0, -1.0, f64::NAN, f64::INFINITY, 239.0] {
        assert!(pip_rectangle(WindowRectangle { width, ..area }, (1, 1)).is_err());
    }
    assert!(pip_rectangle(
        WindowRectangle {
            x: f64::NAN,
            ..area
        },
        (1, 1)
    )
    .is_err());
    assert!(pip_rectangle(
        WindowRectangle {
            width: 240.0,
            height: 180.0,
            ..area
        },
        (1, 1)
    )
    .is_ok());
}
#[test]
fn unknown_modes_are_rejected_at_command_boundary() {
    assert!(serde_json::from_str::<WindowViewMode>("\"floating\"").is_err());
    assert_eq!(
        serde_json::from_str::<WindowViewMode>("\"pip\"").unwrap(),
        WindowViewMode::Pip
    );
}
#[test]
fn window_frame_is_reserved_so_the_entire_pip_fits_the_monitor() {
    let area = WindowRectangle {
        x: -1200.0,
        y: 24.0,
        width: 1200.0,
        height: 650.0,
    };
    let usable = window_content_area(area, (16.0, 32.0)).unwrap();
    let pip = pip_rectangle(usable, (886, 1920)).unwrap();
    assert!(pip.x + pip.width + 16.0 <= area.x + area.width);
    assert!(pip.y + pip.height + 32.0 <= area.y + area.height);
    for frame in [
        (-1.0, 0.0),
        (0.0, -1.0),
        (f64::NAN, 0.0),
        (0.0, f64::INFINITY),
        (1000.0, 600.0),
    ] {
        assert!(window_content_area(area, frame).is_err());
    }
    assert!(window_content_area(
        WindowRectangle {
            width: 256.0,
            height: 212.0,
            ..area
        },
        (16.0, 32.0)
    )
    .is_ok());
}

#[test]
fn native_fullscreen_uses_cached_normal_geometry_and_restores_once() {
    let window = FakeWindow::default();
    let mut presentation = WindowPresentation::default();
    presentation
        .observe_native_fullscreen(false, Some(window.snapshot().unwrap()))
        .unwrap();
    assert!(presentation.observe_native_fullscreen(true, None).unwrap());
    assert_eq!(presentation.mode(), WindowViewMode::Fullscreen);
    assert!(!presentation.observe_native_fullscreen(true, None).unwrap());
    presentation
        .set_mode(&window, WindowViewMode::Normal, None)
        .unwrap();
    assert_eq!(*window.calls.borrow(), vec!["Normal"]);
    assert!(!presentation.observe_native_fullscreen(false, None).unwrap());
}

#[test]
fn native_exit_and_invalid_snapshots_do_not_corrupt_pip_or_restore_geometry() {
    let window = FakeWindow::default();
    let mut presentation = WindowPresentation::default();
    assert!(presentation.observe_native_fullscreen(true, None).is_err());
    for width in [0.0, -1.0, f64::NAN, f64::INFINITY] {
        let mut snapshot = window.snapshot().unwrap();
        snapshot.width = width;
        assert!(presentation
            .observe_native_fullscreen(false, Some(snapshot))
            .is_err());
    }
    presentation
        .observe_native_fullscreen(false, Some(window.snapshot().unwrap()))
        .unwrap();
    presentation.observe_native_fullscreen(true, None).unwrap();
    assert!(presentation.observe_native_fullscreen(false, None).unwrap());
    assert_eq!(presentation.mode(), WindowViewMode::Normal);
    presentation
        .set_mode(&window, WindowViewMode::Pip, Some((886, 1920)))
        .unwrap();
    assert!(!presentation.observe_native_fullscreen(false, None).unwrap());
    assert_eq!(presentation.mode(), WindowViewMode::Pip);
}

#[derive(Default)]
struct FakeFullscreenTransition {
    milliseconds: std::sync::atomic::AtomicU64,
    completes_at: u64,
    cancelled: bool,
    fail_query: bool,
    waits: std::sync::Mutex<Vec<std::time::Duration>>,
}
#[async_trait::async_trait]
impl FullscreenTransitionPort for FakeFullscreenTransition {
    fn now(&self) -> std::time::Duration {
        std::time::Duration::from_millis(
            self.milliseconds.load(std::sync::atomic::Ordering::SeqCst),
        )
    }
    fn fullscreen(&self) -> Result<bool, String> {
        if self.fail_query {
            Err("native query failed".into())
        } else {
            Ok(self.milliseconds.load(std::sync::atomic::Ordering::SeqCst) >= self.completes_at)
        }
    }
    fn cancelled(&self) -> bool {
        self.cancelled
    }
    async fn wait(&self, duration: std::time::Duration) {
        self.waits.lock().unwrap().push(duration);
        self.milliseconds.fetch_add(
            duration.as_millis() as u64,
            std::sync::atomic::Ordering::SeqCst,
        );
    }
}
#[tokio::test]
async fn native_transition_observes_deadline_cancellation_and_errors_without_real_sleep() {
    use std::time::Duration;
    let timeout = Duration::from_millis(40);
    for completes_at in [0, 20, 40] {
        let port = FakeFullscreenTransition {
            completes_at,
            ..Default::default()
        };
        await_fullscreen_transition(&port, true, timeout)
            .await
            .unwrap();
        assert!(port.milliseconds.load(std::sync::atomic::Ordering::SeqCst) <= 40);
    }
    let late = FakeFullscreenTransition {
        completes_at: 41,
        ..Default::default()
    };
    assert!(await_fullscreen_transition(&late, true, timeout)
        .await
        .is_err());
    assert_eq!(
        late.milliseconds.load(std::sync::atomic::Ordering::SeqCst),
        40
    );
    let cancelled = FakeFullscreenTransition {
        cancelled: true,
        ..Default::default()
    };
    assert!(await_fullscreen_transition(&cancelled, true, timeout)
        .await
        .is_err());
    assert!(cancelled.waits.lock().unwrap().is_empty());
    let failed = FakeFullscreenTransition {
        fail_query: true,
        ..Default::default()
    };
    assert!(await_fullscreen_transition(&failed, true, timeout)
        .await
        .is_err());
    assert!(failed.waits.lock().unwrap().is_empty());
    assert!(await_fullscreen_transition(&late, true, Duration::ZERO)
        .await
        .is_err());
    let normal = FakeFullscreenTransition {
        completes_at: 1,
        ..Default::default()
    };
    await_fullscreen_transition(&normal, false, timeout)
        .await
        .unwrap();
    assert!(normal.waits.lock().unwrap().is_empty());
}
