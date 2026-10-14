#import <AppKit/AppKit.h>
#import <Carbon/Carbon.h>
#import <os/log.h>

typedef void (*PMKeyboardShortcutCallback)(void *context, bool capsLock, bool pressed, uint64_t timeMs);
static PMKeyboardShortcutCallback shortcutCallback;
static void *shortcutContext;
static NSString *previousInputSource;
static id capsLockMonitor;
static id activationObserver;
static os_log_t shortcutLog;

static void forwardShortcut(bool capsLock, bool pressed) {
    if (NSApp.isActive && shortcutCallback) {
        uint64_t timeMs = (uint64_t)(NSProcessInfo.processInfo.systemUptime * 1000);
        shortcutCallback(shortcutContext, capsLock, pressed, timeMs);
    }
}

static NSString *currentInputSource(void) {
    TISInputSourceRef source = TISCopyCurrentKeyboardInputSource();
    if (!source) return @"";
    NSString *identifier = [(__bridge NSString *)TISGetInputSourceProperty(source, kTISPropertyInputSourceID) copy];
    CFRelease(source);
    return identifier ?: @"";
}

static void inputSourceChanged(CFNotificationCenterRef center, void *observer,
                              CFStringRef name, const void *object, CFDictionaryRef userInfo) {
    (void)center; (void)observer; (void)name; (void)object; (void)userInfo;
    dispatch_async(dispatch_get_main_queue(), ^{
        NSString *identifier = currentInputSource();
        if ([identifier isEqualToString:previousInputSource]) return;
        previousInputSource = identifier;
        os_log_info(shortcutLog, "Input source changed; active=%{public}d", NSApp.isActive);
        // Only the foreground app can forward a source change.
        forwardShortcut(false, false);
    });
}

bool phone_keyboard_shortcuts_install(PMKeyboardShortcutCallback callback, void *context) {
    CFNotificationCenterRef center = CFNotificationCenterGetDistributedCenter();
    if (!center || shortcutCallback) return false;
    shortcutLog = os_log_create("com.phone-mirror.desktop", "KeyboardShortcuts");
    previousInputSource = currentInputSource();
    shortcutCallback = callback;
    shortcutContext = context;
    CFNotificationCenterAddObserver(center, context, inputSourceChanged,
        kTISNotifySelectedKeyboardInputSourceChanged, NULL, CFNotificationSuspensionBehaviorDeliverImmediately);
    // Local flags events require no global keyboard monitoring permission. Only
    // Caps Lock is inspected; ordinary keys and typed content are not observed.
    capsLockMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskFlagsChanged
        handler:^NSEvent *(NSEvent *event) {
            if (event.keyCode == 57) {
                os_log_info(shortcutLog, "Caps Lock flags=%{public}lu; active=%{public}d", (unsigned long)event.modifierFlags, NSApp.isActive);
                forwardShortcut(true, (event.modifierFlags & NSEventModifierFlagCapsLock) != 0);
            }
            return event;
        }];
    // A release may occur while another app is active; start the next activation
    // with no held Caps Lock rather than suppressing the user's next press.
    activationObserver = [NSNotificationCenter.defaultCenter
        addObserverForName:NSApplicationDidBecomeActiveNotification object:nil
        queue:NSOperationQueue.mainQueue usingBlock:^(NSNotification *notification) {
            (void)notification;
            forwardShortcut(true, false);
        }];
    return true;
}
