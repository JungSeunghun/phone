import { it, expect, vi } from "vitest";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { PhoneMirrorApp } from "../src/presentation/PhoneMirrorApp";
import { PhoneMirrorController } from "../src/application/PhoneMirrorController";
import { WindowPresentationController } from "../src/application/WindowPresentationController";
import { FakeBackend } from "./fixtures";
it("focuses a physical Android keyboard target, ignores Mac text composition and cancels when settings take focus", async () => {
  const backend = Object.assign(new FakeBackend(), {
    sendControl: vi.fn(async () => {}),
  });
  const controller = new PhoneMirrorController(backend);
  const clipboard = { readText: vi.fn(async () => "English 한글") };
  await controller.refreshDevices();
  render(<PhoneMirrorApp controller={controller} textClipboard={clipboard} />);
  expect(
    screen.queryByRole("button", { name: "폰에 붙여넣기" }),
  ).not.toBeInTheDocument();
  await act(async () => {
    await controller.start();
    controller.frameRendered(100, 200);
  });
  const canvas = screen.getByLabelText("폰 영상");
  const field = screen.getByLabelText("다국어 직접 입력");
  act(() => canvas.focus());
  expect(field).toHaveFocus();
  expect(clipboard.readText).not.toHaveBeenCalled();
  fireEvent.compositionStart(field);
  fireEvent.input(field, { target: { value: "한" }, isComposing: true });
  expect(backend.sendControl).not.toHaveBeenCalled();
  fireEvent.compositionEnd(field, { data: "한글", target: { value: "한글" } });
  fireEvent.input(field, {
    target: { value: "한글" },
    inputType: "insertFromComposition",
  });
  expect(backend.sendControl).not.toHaveBeenCalled();
  fireEvent.keyDown(field, { key: "g", code: "KeyG" });
  await waitFor(() => expect(backend.sendControl).toHaveBeenCalledTimes(1));
  await act(async () => {});
  expect(backend.sendControl).toHaveBeenLastCalledWith(expect.any(String), {
    kind: "keyboard",
    usage: 10,
    modifiers: 0,
  });
  act(() => screen.getByRole("button", { name: "설정 열기" }).focus());
  fireEvent.input(field, {
    target: { value: "late" },
    inputType: "insertText",
  });
  fireEvent.keyDown(field, { key: "v", metaKey: true });
  expect(backend.sendControl).toHaveBeenCalledTimes(1);
  expect(clipboard.readText).not.toHaveBeenCalled();
});
it("scopes Cmd/Ctrl V to the focused live Android screen across fullscreen/PiP", async () => {
  const backend = Object.assign(new FakeBackend(), {
    sendControl: vi.fn(async () => {}),
  });
  const controller = new PhoneMirrorController(backend);
  const clipboard = { readText: vi.fn(async () => "中文 😀") };
  await controller.refreshDevices();
  render(
    <PhoneMirrorApp
      controller={controller}
      textClipboard={clipboard}
      windowPresentationController={
        new WindowPresentationController({ setMode: async (mode) => mode })
      }
    />,
  );
  const canvas = screen.getByLabelText("폰 영상");
  fireEvent.keyDown(canvas, { key: "v", ctrlKey: true });
  expect(clipboard.readText).not.toHaveBeenCalled();
  await act(async () => {
    await controller.start();
    controller.frameRendered(100, 200);
  });
  for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
    act(() => canvas.focus());
    fireEvent.keyDown(screen.getByLabelText("다국어 직접 입력"), {
      key: "v",
      ...modifier,
    });
    await waitFor(() =>
      expect(clipboard.readText).toHaveBeenCalledTimes(
        modifier.metaKey ? 1 : 2,
      ),
    );
    await act(async () => {});
  }
  expect(backend.sendControl).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(screen.getByLabelText("다국어 직접 입력"), {
    key: "v",
    ctrlKey: true,
    repeat: true,
  });
  expect(clipboard.readText).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(screen.getByLabelText("연결된 기기"), {
    key: "v",
    ctrlKey: true,
  });
  expect(clipboard.readText).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "전체 화면" }));
  await waitFor(() =>
    expect(document.querySelector("main")).toHaveClass("view-fullscreen"),
  );
  expect(screen.getByLabelText("다국어 직접 입력")).toBeEnabled();
  await act(async () => {
    await controller.stop();
  });
  expect(screen.getByLabelText("다국어 직접 입력")).toBeDisabled();
});
it("keeps iPhone text input disabled until its keyboard is paired", async () => {
  const backend = new FakeBackend();
  backend.devices = [{ ...backend.devices[0], platform: "ios" }];
  const controller = new PhoneMirrorController(backend);
  await controller.refreshDevices();
  render(<PhoneMirrorApp controller={controller} />);
  expect(
    screen.getByRole("textbox", { name: "다국어 직접 입력" }),
  ).toBeDisabled();
});

it("discards a clipboard read completed after the screen loses focus", async () => {
  const backend = Object.assign(new FakeBackend(), {
    sendControl: vi.fn(async () => {}),
  });
  const controller = new PhoneMirrorController(backend);
  let complete!: (text: string) => void;
  const clipboard = {
    readText: vi.fn(
      () =>
        new Promise<string>((resolve) => {
          complete = resolve;
        }),
    ),
  };
  await controller.refreshDevices();
  render(<PhoneMirrorApp controller={controller} textClipboard={clipboard} />);
  await act(async () => {
    await controller.start();
    controller.frameRendered(100, 200);
  });
  act(() => screen.getByLabelText("폰 영상").focus());
  fireEvent.keyDown(screen.getByLabelText("다국어 직접 입력"), {
    key: "v",
    metaKey: true,
  });
  expect(clipboard.readText).toHaveBeenCalledTimes(1);
  act(() => screen.getByRole("button", { name: "설정 열기" }).focus());
  await act(async () => {
    complete("late clipboard");
  });
  expect(backend.sendControl).not.toHaveBeenCalled();
});
