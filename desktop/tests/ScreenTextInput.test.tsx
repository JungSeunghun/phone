import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { ScreenTextInput } from "../src/presentation/ScreenTextInput";
import { TextInputController } from "../src/application/TextInputController";
function fixture(enabled = true) {
  const send = vi.fn(async (_input: unknown, _session: string) => {}),
    readText = vi.fn(async () => "日本語\nالعربية 😀");
  const controller = new TextInputController(
    () => (enabled ? "A" : undefined),
    send,
    { readText },
  );
  render(
    <ScreenTextInput
      controller={controller}
      enabled={enabled}
      platform="ios"
    />,
  );
  if (enabled)
    screen.getByRole("textbox", { name: "다국어 직접 입력" }).focus();
  return { send, readText, controller };
}
it("pastes on demand and disables Android actions without an input session", async () => {
  const f = fixture();
  fireEvent.keyDown(screen.getByRole("textbox", { name: "다국어 직접 입력" }), {
    key: "v",
    metaKey: true,
  });
  await waitFor(() =>
    expect(f.send).toHaveBeenCalledWith(
      { kind: "paste", text: "日本語\nالعربية 😀" },
      "A",
    ),
  );
});
it("commits a composition completed before the preview deadline once, then accepts more text", async () => {
  const f = fixture();
  const field = screen.getByRole("textbox", { name: "다국어 직접 입력" });
  fireEvent.compositionStart(field);
  fireEvent.input(field, {
    target: { value: "に" },
    isComposing: true,
    inputType: "insertCompositionText",
  });
  expect(f.send).not.toHaveBeenCalled();
  fireEvent.input(field, {
    target: { value: "日本語" },
    isComposing: true,
    inputType: "insertCompositionText",
  });
  fireEvent.compositionEnd(field, { data: "日本語" });
  fireEvent.input(field, {
    target: { value: "日本語" },
    inputType: "insertFromComposition",
  });
  await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
  expect(f.send).toHaveBeenCalledWith({ kind: "paste", text: "日本語" }, "A");
  fireEvent.input(field, { target: { value: "é😀" }, inputType: "insertText" });
  await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
  expect(field).toHaveValue("");
});
it("cancels composition on blur and prevents local paste from duplicating forwarded text", async () => {
  const f = fixture(),
    field = screen.getByRole("textbox", { name: "다국어 직접 입력" });
  fireEvent.compositionStart(field);
  fireEvent.input(field, { target: { value: "한" }, isComposing: true });
  act(() => (field as HTMLTextAreaElement).blur());
  fireEvent.compositionEnd(field, { data: "한" });
  expect(f.send).not.toHaveBeenCalled();
  act(() => (field as HTMLTextAreaElement).focus());
  fireEvent.paste(field, { clipboardData: { getData: () => "中文\nالعربية" } });
  await waitFor(() => expect(f.send).toHaveBeenCalledTimes(1));
  expect(f.readText).not.toHaveBeenCalled();
});
it("forwards editing keys but leaves composing and modified shortcuts alone", async () => {
  const f = fixture(),
    field = screen.getByRole("textbox", { name: "다국어 직접 입력" });
  fireEvent.keyDown(field, { key: "Backspace" });
  fireEvent.keyDown(field, { key: "Enter" });
  fireEvent.keyDown(field, { key: "ArrowLeft", ctrlKey: true });
  fireEvent.compositionStart(field);
  fireEvent.keyDown(field, { key: "Enter", isComposing: true });
  await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
  expect(f.send.mock.calls.map(([input]) => input)).toEqual([
    { kind: "key", key: "backspace" },
    { kind: "key", key: "enter" },
  ]);
});
it("disables controls for iPhone or stopped sessions", () => {
  fixture(false);
  expect(
    screen.queryByRole("button", { name: "폰에 붙여넣기" }),
  ).not.toBeInTheDocument();
  expect(
    screen.getByRole("textbox", { name: "다국어 직접 입력" }),
  ).toBeDisabled();
});

it("suppresses a final composition input after the event microtask checkpoint", async () => {
  const f = fixture(),
    field = screen.getByRole("textbox", { name: "다국어 직접 입력" });
  fireEvent.compositionStart(field);
  fireEvent.input(field, { target: { value: "中文" }, isComposing: true });
  fireEvent.compositionEnd(field, { data: "中文" });
  await act(async () => {
    await Promise.resolve();
    fireEvent.input(field, {
      target: { value: "中文" },
      inputType: "insertText",
    });
  });
  expect(f.send).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(field, { key: "中" });
  fireEvent.input(field, {
    target: { value: "中文" },
    inputType: "insertText",
  });
  await waitFor(() => expect(f.send).toHaveBeenCalledTimes(2));
});

it("shows Korean composition before the next key, replaces the syllable and commits without duplication", async () => {
  const f = fixture(),
    field = screen.getByRole("textbox", { name: "다국어 직접 입력" });
  fireEvent.compositionStart(field);
  fireEvent.input(field, {
    target: { value: "하" },
    isComposing: true,
    inputType: "insertCompositionText",
  });
  await waitFor(() =>
    expect(f.send).toHaveBeenCalledWith({ kind: "paste", text: "하" }, "A"),
  );
  expect(field).toHaveValue("하");
  fireEvent.input(field, {
    target: { value: "한" },
    isComposing: true,
    inputType: "insertCompositionText",
  });
  await waitFor(() =>
    expect(f.send).toHaveBeenCalledWith({ kind: "paste", text: "한" }, "A"),
  );
  fireEvent.compositionEnd(field, { data: "한" });
  fireEvent.input(field, { target: { value: "한" }, inputType: "insertText" });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(f.send.mock.calls.map(([input]) => input)).toEqual([
    { kind: "paste", text: "하" },
    { kind: "key", key: "backspace" },
    { kind: "paste", text: "한" },
  ]);
});

it("cancels a pending composition preview when focus leaves the phone", async () => {
  const f = fixture(),
    field = screen.getByRole("textbox", { name: "다국어 직접 입력" });
  fireEvent.compositionStart(field);
  fireEvent.input(field, { target: { value: "한" }, isComposing: true });
  act(() => (field as HTMLTextAreaElement).blur());
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  expect(f.send).not.toHaveBeenCalled();
});

it("forwards Android physical keys without reading or writing clipboard text, even with a Mac IME selected", async () => {
  const send = vi.fn(async (_input: unknown, _session: string) => {});
  const readText = vi.fn(async () => "explicit paste");
  const controller = new TextInputController(() => "A", send, { readText });
  render(
    <ScreenTextInput controller={controller} enabled platform="android" />,
  );
  const field = screen.getByRole("textbox", { name: "다국어 직접 입력" });
  field.focus();
  fireEvent.keyDown(field, {
    key: "Process",
    code: "KeyG",
    keyCode: 229,
    isComposing: true,
  });
  fireEvent.keyDown(field, { key: "a", code: "KeyA", shiftKey: true });
  fireEvent.compositionStart(field);
  fireEvent.input(field, { target: { value: "한" }, isComposing: true });
  fireEvent.compositionEnd(field, { data: "한" });
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls.map(([input]) => input)).toEqual([
    { kind: "keyboard", usage: 10, modifiers: 0 },
    { kind: "keyboard", usage: 4, modifiers: 2 },
  ]);
  expect(readText).not.toHaveBeenCalled();
  expect(field).toHaveAttribute("readonly");
});

it("handles native Mac source changes once and discards events after settings take focus", async () => {
  const send = vi.fn(async (_input: unknown, _session: string) => {});
  const readText = vi.fn(async () => "clipboard must remain untouched");
  const controller = new TextInputController(() => "A", send, { readText });
  let receive!: (scope: number) => void;
  const source = {
    subscribe: vi.fn(async (listener: (scope: number) => void) => {
      receive = listener;
      return { handlesShortcuts: true, dispose() {} };
    }),
    setFocus: vi.fn(async (_generation: number, _active: boolean) => {}),
  };
  render(
    <ScreenTextInput
      controller={controller}
      enabled
      platform="android"
      keyboardShortcutSource={source}
    />,
  );
  const field = screen.getByRole("textbox", { name: "다국어 직접 입력" });
  await act(async () => {
    field.focus();
  });
  const scope = source.setFocus.mock.calls.at(-1)![0]!;
  fireEvent.keyDown(field, { key: "CapsLock", code: "CapsLock" });
  fireEvent.keyDown(field, { key: " ", code: "Space", ctrlKey: true });
  expect(send).not.toHaveBeenCalled();
  await act(async () => {
    receive(scope);
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(send).toHaveBeenCalledWith(
    { kind: "keyboard", usage: 44, modifiers: 2 },
    "A",
  );
  act(() => field.blur());
  await act(async () => {
    receive(scope);
  });
  expect(send).toHaveBeenCalledTimes(1);
  await act(async () => {
    field.focus();
  });
  await act(async () => {
    receive(scope);
  });
  expect(send).toHaveBeenCalledTimes(1);
  expect(readText).not.toHaveBeenCalled();
});

it("uses native source-change callbacks once for the focused Android target and rejects stale callbacks", async () => {
  const send = vi.fn(async (_input: unknown, _session: string) => {});
  const readText = vi.fn(async () => "clipboard must stay untouched");
  const controller = new TextInputController(() => "A", send, { readText });
  let switchLanguage!: (generation: number) => void;
  const dispose = vi.fn();
  const source = {
    subscribe: vi.fn(async (listener: typeof switchLanguage) => {
      switchLanguage = listener;
      return { handlesShortcuts: true, dispose };
    }),
    setFocus: vi.fn(async (_generation: number, _active: boolean) => {}),
  };
  const rendered = render(
    <ScreenTextInput
      controller={controller}
      enabled
      platform="android"
      keyboardShortcutSource={source}
    />,
  );
  await waitFor(() => expect(source.subscribe).toHaveBeenCalledTimes(1));
  const field = screen.getByRole("textbox", { name: "다국어 직접 입력" });
  act(() => field.focus());
  await waitFor(() => expect(source.setFocus).toHaveBeenCalled());
  const generation = source.setFocus.mock.calls.at(-1)![0];
  fireEvent.keyDown(field, { key: "CapsLock", code: "CapsLock" });
  fireEvent.keyDown(field, { key: " ", code: "Space", ctrlKey: true });
  expect(send).not.toHaveBeenCalled();
  act(() => switchLanguage(generation));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
  expect(send).toHaveBeenLastCalledWith(
    { kind: "keyboard", usage: 44, modifiers: 2 },
    "A",
  );
  act(() => (field as HTMLTextAreaElement).blur());
  act(() => switchLanguage(generation));
  expect(send).toHaveBeenCalledTimes(1);
  act(() => field.focus());
  const current = source.setFocus.mock.calls.at(-1)![0];
  expect(current).toBeGreaterThan(generation);
  act(() => switchLanguage(generation));
  expect(send).toHaveBeenCalledTimes(1);
  act(() => switchLanguage(current));
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  rendered.unmount();
  act(() => switchLanguage(current));
  expect(send).toHaveBeenCalledTimes(2);
  expect(dispose).toHaveBeenCalledTimes(1);
  expect(readText).not.toHaveBeenCalled();
});

it("forwards Caps Lock and Ctrl+Space once per press without a native shortcut source", async () => {
  const send = vi.fn(async (_input: unknown, _session: string) => {});
  const readText = vi.fn(async () => "clipboard");
  render(
    <ScreenTextInput
      controller={new TextInputController(() => "A", send, { readText })}
      enabled
      platform="android"
    />,
  );
  const field = screen.getByLabelText("다국어 직접 입력");
  field.focus();
  for (const repeat of [false, true])
    fireEvent.keyDown(field, { key: "CapsLock", code: "CapsLock", repeat });
  for (const repeat of [false, true])
    fireEvent.keyDown(field, {
      key: " ",
      code: "Space",
      ctrlKey: true,
      repeat,
    });
  await waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  expect(send.mock.calls.map(([input]) => input)).toEqual(
    Array.from({ length: 2 }, () => ({
      kind: "keyboard",
      usage: 44,
      modifiers: 2,
    })),
  );
  expect(readText).not.toHaveBeenCalled();
});
