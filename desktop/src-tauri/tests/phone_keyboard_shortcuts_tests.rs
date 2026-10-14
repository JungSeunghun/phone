use phone_mirror_desktop::phone_keyboard_shortcuts::PhoneKeyboardShortcutFocus;

#[test]
fn shortcuts_require_current_focus_and_ignore_reordered_or_repeated_updates() {
    let mut focus = PhoneKeyboardShortcutFocus::default();
    assert_eq!(focus.generation(), None);
    assert!(focus.update(1, true).is_ok());
    assert_eq!(focus.generation(), Some(1));
    focus.update(2, false).unwrap();
    focus.update(1, true).unwrap();
    focus.update(2, true).unwrap();
    assert_eq!(focus.generation(), None);
    focus.update(3, true).unwrap();
    assert_eq!(focus.generation(), Some(3));
}
#[test]
fn focus_generation_rejects_zero_and_values_outside_javascript_integer_boundaries() {
    let mut focus = PhoneKeyboardShortcutFocus::default();
    assert!(focus.update(0, true).is_err());
    assert!(focus.update(9_007_199_254_740_991, true).is_ok());
    assert_eq!(focus.generation(), Some(9_007_199_254_740_991));
    assert!(focus.update(9_007_199_254_740_992, false).is_err());
    assert_eq!(focus.generation(), Some(9_007_199_254_740_991));
}

#[test]
fn caps_lock_and_its_source_notification_forward_once_in_either_order() {
    use phone_mirror_desktop::phone_keyboard_shortcuts::PhoneKeyboardShortcutKind::{
        CapsLock, InputSource,
    };
    let mut focus = PhoneKeyboardShortcutFocus::default();
    focus.update(1, true).unwrap();
    assert!(focus.accept_shortcut(CapsLock, 1000));
    assert!(!focus.accept_shortcut(InputSource, 1100));
    assert!(focus.accept_shortcut(InputSource, 2000));
    assert!(!focus.accept_shortcut(CapsLock, 2100));
    assert!(focus.accept_shortcut(CapsLock, 2200));
    assert!(focus.accept_shortcut(CapsLock, 2300));
}

#[test]
fn shortcut_dedup_expires_at_boundary_and_resets_with_focus() {
    use phone_mirror_desktop::phone_keyboard_shortcuts::PhoneKeyboardShortcutKind::{
        CapsLock, InputSource,
    };
    let mut focus = PhoneKeyboardShortcutFocus::default();
    assert!(!focus.accept_shortcut(CapsLock, 1000));
    focus.update(1, true).unwrap();
    assert!(focus.accept_shortcut(CapsLock, 1000));
    assert!(focus.accept_shortcut(InputSource, 1500));
    focus.update(2, false).unwrap();
    assert!(!focus.accept_shortcut(CapsLock, 1501));
    focus.update(3, true).unwrap();
    assert!(focus.accept_shortcut(CapsLock, 1502));
    assert!(focus.accept_shortcut(InputSource, 0));
}

#[test]
fn caps_lock_press_and_release_forward_only_one_switch() {
    use phone_mirror_desktop::phone_keyboard_shortcuts::CapsLockEventFilter;
    let mut filter = CapsLockEventFilter::default();
    assert!(filter.accept(true));
    assert!(!filter.accept(false));
    assert!(filter.accept(true));
    assert!(!filter.accept(false));
}

#[test]
fn caps_lock_filter_ignores_repeated_down_and_unmatched_release() {
    use phone_mirror_desktop::phone_keyboard_shortcuts::CapsLockEventFilter;
    let mut filter = CapsLockEventFilter::default();
    assert!(!filter.accept(false));
    assert!(filter.accept(true));
    assert!(!filter.accept(true));
    assert!(!filter.accept(true));
    assert!(!filter.accept(false));
    assert!(!filter.accept(false));
    assert!(filter.accept(true));
}

#[test]
fn physical_caps_press_source_notice_and_release_produce_one_phone_action() {
    use phone_mirror_desktop::phone_keyboard_shortcuts::{
        CapsLockEventFilter,
        PhoneKeyboardShortcutKind::{CapsLock, InputSource},
    };
    let mut filter = CapsLockEventFilter::default();
    let mut focus = PhoneKeyboardShortcutFocus::default();
    focus.update(1, true).unwrap();
    let mut actions = 0;
    if filter.accept(true) && focus.accept_shortcut(CapsLock, 1000) {
        actions += 1;
    }
    if focus.accept_shortcut(InputSource, 1061) {
        actions += 1;
    }
    if filter.accept(false) && focus.accept_shortcut(CapsLock, 1066) {
        actions += 1;
    }
    assert_eq!(actions, 1);
    // Holding the key, receiving duplicate down events, and then releasing it
    // must not introduce a second switch. A later press is still accepted.
    if filter.accept(true) && focus.accept_shortcut(CapsLock, 2000) {
        actions += 1;
    }
    if filter.accept(true) && focus.accept_shortcut(CapsLock, 2100) {
        actions += 1;
    }
    if filter.accept(false) && focus.accept_shortcut(CapsLock, 3000) {
        actions += 1;
    }
    assert_eq!(actions, 2);
}
