//! Focus ordering policy independent of desktop event sources and phone hardware.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PhoneKeyboardShortcutKind {
    CapsLock,
    InputSource,
}

#[derive(Default)]
pub struct PhoneKeyboardShortcutFocus {
    generation: u64,
    active: bool,
    pending_shortcut: Option<(PhoneKeyboardShortcutKind, u64)>,
}
impl PhoneKeyboardShortcutFocus {
    pub fn update(&mut self, generation: u64, active: bool) -> Result<(), String> {
        if generation == 0 || generation > 9_007_199_254_740_991 {
            return Err("잘못된 키보드 포커스입니다.".into());
        }
        if generation > self.generation {
            self.generation = generation;
            self.active = active;
            self.pending_shortcut = None;
        }
        Ok(())
    }
    pub fn accept_shortcut(&mut self, kind: PhoneKeyboardShortcutKind, time_ms: u64) -> bool {
        if !self.active {
            return false;
        }
        if let Some((previous, previous_time)) = self.pending_shortcut {
            // A physical Caps Lock and its source notification describe one switch.
            // Repeated keys of the same kind still describe distinct user actions.
            if previous != kind
                && time_ms
                    .checked_sub(previous_time)
                    .is_some_and(|elapsed| elapsed < 500)
            {
                self.pending_shortcut = None;
                return false;
            }
        }
        self.pending_shortcut = Some((kind, time_ms));
        true
    }
    pub fn generation(&self) -> Option<u64> {
        self.active.then_some(self.generation)
    }
}

/// Normalize momentary Caps Lock flags into one action per physical press.
#[derive(Default)]
pub struct CapsLockEventFilter {
    pressed: bool,
}
impl CapsLockEventFilter {
    pub fn accept(&mut self, pressed: bool) -> bool {
        let should_forward = pressed && !self.pressed;
        self.pressed = pressed;
        should_forward
    }
}
