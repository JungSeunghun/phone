export interface PhonePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}
export type ControlInput =
  | ({
      kind: "touch";
      action: "down" | "move" | "up" | "cancel";
    } & PhonePosition)
  | ({ kind: "scroll"; horizontal: number; vertical: number } & PhonePosition)
  | { kind: "back" }
  | { kind: "paste"; text: string }
  | { kind: "keyboard"; usage: number; modifiers: number }
  | { kind: "keyboardsettings" }
  | {
      kind: "key";
      key: "backspace" | "delete" | "enter" | "left" | "right" | "up" | "down";
    };

// USB HID keyboard usages, independent of the computer's selected text input method.
export function isPhoneLanguageShortcut(event: {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}) {
  return (
    !event.shiftKey &&
    !event.altKey &&
    !event.metaKey &&
    ((event.code === "CapsLock" && !event.ctrlKey) ||
      (event.code === "Space" && event.ctrlKey))
  );
}
export function physicalKeyboardInput(event: {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): Extract<ControlInput, { kind: "keyboard" }> | undefined {
  if (isPhoneLanguageShortcut(event))
    return { kind: "keyboard", usage: 44, modifiers: 2 };
  const keys: Record<string, number> = {
    Enter: 0x28,
    Backspace: 0x2a,
    Tab: 0x2b,
    Space: 0x2c,
    Minus: 0x2d,
    Equal: 0x2e,
    BracketLeft: 0x2f,
    BracketRight: 0x30,
    Backslash: 0x31,
    Semicolon: 0x33,
    Quote: 0x34,
    Backquote: 0x35,
    Comma: 0x36,
    Period: 0x37,
    Slash: 0x38,
    Insert: 0x49,
    Home: 0x4a,
    PageUp: 0x4b,
    Delete: 0x4c,
    End: 0x4d,
    PageDown: 0x4e,
    ArrowRight: 0x4f,
    ArrowLeft: 0x50,
    ArrowDown: 0x51,
    ArrowUp: 0x52,
    NumpadDivide: 0x54,
    NumpadMultiply: 0x55,
    NumpadSubtract: 0x56,
    NumpadAdd: 0x57,
    NumpadEnter: 0x58,
    Numpad0: 0x62,
    NumpadDecimal: 0x63,
  };
  let usage = keys[event.code];
  if (/^Key[A-Z]$/.test(event.code)) usage = event.code.charCodeAt(3) - 65 + 4;
  if (/^Digit[0-9]$/.test(event.code))
    usage = event.code === "Digit0" ? 0x27 : Number(event.code.at(-1)) + 0x1d;
  if (/^Numpad[1-9]$/.test(event.code))
    usage = Number(event.code.at(-1)) + 0x58;
  if (!usage) return;
  // Keep application/OS Command shortcuts; expose familiar editing shortcuts on Android.
  if (
    event.metaKey &&
    !["KeyA", "KeyC", "KeyX", "KeyZ", "KeyY"].includes(event.code)
  )
    return;
  const modifiers =
    Number(event.ctrlKey || event.metaKey) |
    (Number(event.shiftKey) << 1) |
    (Number(event.altKey) << 2);
  return { kind: "keyboard", usage, modifiers };
}

// scrcpy 5.0: 256 KiB control message minus its 14-byte clipboard header.
export const maximumPhoneTextBytes = (1 << 18) - 14;
export function validatePhoneText(text: string): string | undefined {
  if (!text.length) return "붙여넣을 텍스트가 없습니다.";
  if (
    text.includes("\0") ||
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      text,
    )
  )
    return "지원하지 않는 문자가 포함되어 있습니다.";
  if (new TextEncoder().encode(text).length > maximumPhoneTextBytes)
    return "텍스트가 너무 깁니다. UTF-8 기준 262130바이트까지 입력할 수 있습니다.";
}
