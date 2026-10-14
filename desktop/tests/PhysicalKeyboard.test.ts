import { expect, it } from "vitest";
import { physicalKeyboardInput } from "../src/domain/PhoneInput";
const event = (code: string) => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
});
it("maps physical letters, digits, punctuation, editing and keypad keys independently of the input language", () => {
  for (const [code, usage] of [
    ["KeyA", 4],
    ["KeyZ", 29],
    ["Digit1", 30],
    ["Digit0", 39],
    ["Space", 44],
    ["Slash", 56],
    ["ArrowUp", 82],
    ["Numpad1", 89],
    ["Numpad9", 97],
    ["Numpad0", 98],
    ["NumpadEnter", 88],
  ] as const) {
    expect(physicalKeyboardInput(event(code))).toEqual({
      kind: "keyboard",
      usage,
      modifiers: 0,
    });
  }
  expect(
    physicalKeyboardInput({
      ...event("KeyA"),
      shiftKey: true,
      ctrlKey: true,
      altKey: true,
    }),
  ).toEqual({ kind: "keyboard", usage: 4, modifiers: 7 });
  expect(physicalKeyboardInput({ ...event("Space"), shiftKey: true })).toEqual({
    kind: "keyboard",
    usage: 44,
    modifiers: 2,
  });
});
it("preserves OS/application shortcuts and maps Command editing to phone Control", () => {
  for (const code of [
    "",
    "Unknown",
    "ShiftLeft",
    "Escape",
    "Keya",
    "KeyAA",
    "Digit10",
    "Numpad11",
  ])
    expect(physicalKeyboardInput(event(code))).toBeUndefined();
  expect(
    physicalKeyboardInput({ ...event("KeyQ"), metaKey: true }),
  ).toBeUndefined();
  expect(physicalKeyboardInput({ ...event("KeyA"), metaKey: true })).toEqual({
    kind: "keyboard",
    usage: 4,
    modifiers: 1,
  });
});

it("maps Caps Lock and Control Space to one phone language switch without text input", () => {
  expect(physicalKeyboardInput(event("CapsLock"))).toEqual({
    kind: "keyboard",
    usage: 44,
    modifiers: 2,
  });
  expect(physicalKeyboardInput({ ...event("Space"), ctrlKey: true })).toEqual({
    kind: "keyboard",
    usage: 44,
    modifiers: 2,
  });
  expect(
    physicalKeyboardInput({ ...event("Space"), ctrlKey: true, altKey: true }),
  ).toEqual({ kind: "keyboard", usage: 44, modifiers: 5 });
});
