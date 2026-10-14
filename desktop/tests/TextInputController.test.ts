import { describe, it, expect, vi } from "vitest";
import { TextInputController } from "../src/application/TextInputController";
import {
  validatePhoneText,
  maximumPhoneTextBytes,
} from "../src/domain/PhoneInput";
function fixture() {
  let session: string | undefined = "A";
  const send = vi.fn(async (_input: unknown, _session: string) => {});
  const readText = vi.fn(async () => "한국어 日本語 中文 العربية 👨‍👩‍👧‍👦\n café");
  const controller = new TextInputController(() => session, send, { readText });
  return {
    controller,
    send,
    readText,
    change: (value?: string) => {
      session = value;
      controller.reset();
    },
  };
}
describe("Unicode text validation", () => {
  it("preserves whitespace and Unicode, rejects empty, invalid Unicode, NUL and oversized text", () => {
    for (const text of [
      " ",
      "\n",
      "a",
      "한국어 日本語 中文 العربية 😀 e\u0301",
      "a".repeat(maximumPhoneTextBytes),
    ])
      expect(validatePhoneText(text)).toBeUndefined();
    for (const text of [
      "",
      "\u0000",
      "\ud800",
      "a".repeat(maximumPhoneTextBytes + 1),
      "😀".repeat(Math.floor(maximumPhoneTextBytes / 4) + 1),
    ])
      expect(validatePhoneText(text)).toBeTruthy();
  });
});
describe("session-bound text input", () => {
  it("reads clipboard only on demand and sends intact Unicode", async () => {
    const f = fixture();
    expect(f.readText).not.toHaveBeenCalled();
    await f.controller.pasteClipboard();
    expect(f.send).toHaveBeenCalledWith(
      { kind: "paste", text: await f.readText() },
      "A",
    );
  });
  it("orders repeated commits and rejects unsupported or inactive sessions", async () => {
    const f = fixture();
    await Promise.all([
      f.controller.commitText("日"),
      f.controller.commitText("本"),
      f.controller.commitText("語"),
    ]);
    expect(f.send.mock.calls.map(([input]) => input)).toEqual(
      ["日", "本", "語"].map((text) => ({ kind: "paste", text })),
    );
    f.change();
    await f.controller.pasteClipboard();
    expect(f.readText).not.toHaveBeenCalled();
  });
  it("does not send late clipboard results to a replacement session and deduplicates pending reads", async () => {
    const f = fixture();
    let resolve!: (text: string) => void;
    f.readText.mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const first = f.controller.pasteClipboard();
    await f.controller.pasteClipboard();
    expect(f.readText).toHaveBeenCalledTimes(1);
    f.change("B");
    resolve("secret");
    await first;
    expect(f.send).not.toHaveBeenCalled();
  });
  it("cancels queued text and ignores late send errors after reset", async () => {
    const f = fixture();
    let reject!: (reason: Error) => void;
    f.send.mockImplementationOnce(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    );
    const first = f.controller.commitText("one"),
      second = f.controller.commitText("two");
    f.change("B");
    reject(Error("old session"));
    await Promise.all([first, second]);
    expect(f.send).toHaveBeenCalledTimes(1);
    expect(f.controller.getSnapshot().message).toBe("");
  });
  it("reports clipboard errors and invalid data without sending or exposing content", async () => {
    const f = fixture();
    f.readText.mockRejectedValueOnce(Error("private clipboard data"));
    await f.controller.pasteClipboard();
    expect(f.controller.getSnapshot().message).toContain("클립보드");
    expect(f.controller.getSnapshot().message).not.toContain("private");
    await f.controller.commitText("\0");
    expect(f.send).not.toHaveBeenCalled();
  });
});

it("bounds queued commits and drops waiting text after a send failure", async () => {
  const f = fixture();
  let reject!: (error: Error) => void;
  f.send.mockImplementationOnce(
    () =>
      new Promise((_, r) => {
        reject = r;
      }),
  );
  const pending = Array.from({ length: 32 }, () =>
    f.controller.commitText("a"),
  );
  await f.controller.commitText("overflow");
  expect(f.controller.getSnapshot().message).toContain("밀려");
  reject(Error("device detail must not be exposed"));
  await Promise.all(pending);
  expect(f.send).toHaveBeenCalledTimes(1);
  expect(f.controller.getSnapshot().message).toContain("실패");
  await f.controller.commitText("new");
  expect(f.send).toHaveBeenCalledTimes(2);
});

it("replaces only the changed composing suffix and orders edits before later text", async () => {
  const f = fixture();
  await f.controller.replaceComposingText("", "ㅎ");
  await f.controller.replaceComposingText("ㅎ", "한");
  await f.controller.replaceComposingText("한", "한글");
  await f.controller.replaceComposingText("한글", "한글");
  await f.controller.replaceComposingText("한글", "한");
  await f.controller.commitText(" ");
  expect(f.send.mock.calls.map(([input]) => input)).toEqual([
    { kind: "paste", text: "ㅎ" },
    { kind: "key", key: "backspace" },
    { kind: "paste", text: "한" },
    { kind: "paste", text: "글" },
    { kind: "key", key: "backspace" },
    { kind: "paste", text: " " },
  ]);
  expect(f.readText).not.toHaveBeenCalled();
});

it("replaces a composing grapheme with one deletion and rejects invalid replacements", async () => {
  const f = fixture();
  await f.controller.replaceComposingText("👨‍👩‍👧‍👦", "한");
  await f.controller.replaceComposingText("한", "");
  await f.controller.replaceComposingText("", "\0");
  expect(f.send.mock.calls.map(([input]) => input)).toEqual([
    { kind: "key", key: "backspace" },
    { kind: "paste", text: "한" },
    { kind: "key", key: "backspace" },
  ]);
});

it("stops the rest of a composition replacement after failure or session replacement", async () => {
  for (const failure of [true, false]) {
    const f = fixture();
    let finish!: () => void;
    f.send.mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          finish = () =>
            failure ? reject(Error("device failure")) : resolve();
        }),
    );
    const operation = f.controller.replaceComposingText("하", "한");
    if (!failure) f.change("B");
    finish();
    await operation;
    expect(f.send).toHaveBeenCalledTimes(1);
  }
});

it("opens phone keyboard settings through the active session and reports device errors", async () => {
  const f = fixture();
  await f.controller.openKeyboardSettings();
  expect(f.send).toHaveBeenCalledWith({ kind: "keyboardsettings" }, "A");
  f.send.mockRejectedValueOnce(Error("private device details"));
  await f.controller.openKeyboardSettings();
  expect(f.controller.getSnapshot().message).toContain("실패");
  expect(f.controller.getSnapshot().message).not.toContain("private");
});
