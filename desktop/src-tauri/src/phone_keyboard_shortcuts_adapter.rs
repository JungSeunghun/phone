use crate::phone_keyboard_shortcuts::PhoneKeyboardShortcutFocus;
#[cfg(target_os = "macos")]
use crate::phone_keyboard_shortcuts::{CapsLockEventFilter, PhoneKeyboardShortcutKind};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State, WebviewWindow};
#[cfg(target_os = "macos")]
use tauri::{Emitter, Manager};

pub struct PhoneKeyboardShortcutState {
    focus: Arc<Mutex<PhoneKeyboardShortcutFocus>>,
    available: bool,
}

pub fn install(app: &AppHandle) -> PhoneKeyboardShortcutState {
    let focus = Arc::new(Mutex::new(PhoneKeyboardShortcutFocus::default()));
    #[cfg(target_os = "macos")]
    let available = {
        let context = Box::new(NativeContext {
            app: app.clone(),
            focus: focus.clone(),
            caps_lock: Mutex::new(CapsLockEventFilter::default()),
        });
        let pointer = Box::into_raw(context);
        let installed = unsafe { phone_keyboard_shortcuts_install(source_changed, pointer.cast()) };
        if !installed {
            unsafe {
                drop(Box::from_raw(pointer));
            }
        }
        // An installed observer owns its context for the application's lifetime.
        installed
    };
    #[cfg(not(target_os = "macos"))]
    let available = {
        let _ = app;
        false
    };
    PhoneKeyboardShortcutState { focus, available }
}

#[cfg(target_os = "macos")]
struct NativeContext {
    app: AppHandle,
    caps_lock: Mutex<CapsLockEventFilter>,
    focus: Arc<Mutex<PhoneKeyboardShortcutFocus>>,
}
#[cfg(target_os = "macos")]
extern "C" {
    fn phone_keyboard_shortcuts_install(
        callback: extern "C" fn(*mut std::ffi::c_void, bool, bool, u64),
        context: *mut std::ffi::c_void,
    ) -> bool;
}
#[cfg(target_os = "macos")]
extern "C" fn source_changed(
    pointer: *mut std::ffi::c_void,
    caps_lock: bool,
    pressed: bool,
    time_ms: u64,
) {
    let context = unsafe { &*pointer.cast::<NativeContext>() };
    // Normalize release/repeat events before pairing with input-source notices.
    // Update the physical state even when the phone field is not focused.
    if caps_lock
        && !context
            .caps_lock
            .lock()
            .map(|mut filter| filter.accept(pressed))
            .unwrap_or(false)
    {
        return;
    }
    let generation = context.focus.lock().ok().and_then(|mut focus| {
        let kind = if caps_lock {
            PhoneKeyboardShortcutKind::CapsLock
        } else {
            PhoneKeyboardShortcutKind::InputSource
        };
        focus
            .accept_shortcut(kind, time_ms)
            .then(|| focus.generation())
            .flatten()
    });
    if let (Some(generation), Some(window)) = (generation, context.app.get_webview_window("main")) {
        window
            .emit(
                "phone-keyboard-language-switch",
                serde_json::json!({"generation":generation}),
            )
            .ok();
    }
}

#[tauri::command]
pub fn phone_keyboard_shortcuts_available(state: State<'_, PhoneKeyboardShortcutState>) -> bool {
    state.available
}
#[tauri::command]
pub fn set_phone_keyboard_shortcut_focus(
    window: WebviewWindow,
    state: State<'_, PhoneKeyboardShortcutState>,
    generation: u64,
    active: bool,
) -> Result<(), String> {
    if window.label() != "main" {
        return Err("잘못된 키보드 창입니다.".into());
    }
    state
        .focus
        .lock()
        .map_err(|_| "키보드 포커스를 확인할 수 없습니다.")?
        .update(generation, active)
}
