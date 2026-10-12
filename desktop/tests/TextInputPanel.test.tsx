import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
} from "@testing-library/react";
import { it, expect, vi } from "vitest";
import { TextInputPanel } from "../src/presentation/TextInputPanel";
import { TextInputController } from "../src/application/TextInputController";
function fixture(enabled = true) {
  const send = vi.fn(async (_input: unknown, _session: string) => {}),
    readText = vi.fn(async () => "日本語\nالعربية 😀");
  const controller = new TextInputController(
    () => (enabled ? "A" : undefined),
    send,
    { readText },
  );
  render(<TextInputPanel controller={controller} enabled={enabled} />);
  return { send, readText, controller };
}
it("pastes on demand and disables Android actions without an input session", async () => {
  const f = fixture();
  fireEvent.click(screen.getByRole("button", { name: "폰에 붙여넣기" }));
  await waitFor(() =>
    expect(f.send).toHaveBeenCalledWith(
      { kind: "paste", text: "日本語\nالعربية 😀" },
      "A",
    ),
  );
});
it("only commits finished compositions, suppresses the trailing native input, then accepts more text", async () => {
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
  fireEvent.blur(field);
  fireEvent.compositionEnd(field, { data: "한" });
  expect(f.send).not.toHaveBeenCalled();
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
  expect(screen.getByRole("button", { name: "폰에 붙여넣기" })).toBeDisabled();
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
