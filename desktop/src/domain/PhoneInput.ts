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
  | { kind: "back" };
