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
  | {
      kind: "key";
      key: "backspace" | "delete" | "enter" | "left" | "right" | "up" | "down";
    };

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
