import { it, expect, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { PhoneMirrorApp } from "../src/presentation/PhoneMirrorApp";
import { PhoneMirrorController } from "../src/application/PhoneMirrorController";
import { IosKeyboardInputController } from "../src/application/IosKeyboardInputController";
import { FakeBackend } from "./fixtures";
it("pairs an iPhone keyboard and sends button, Cmd/Ctrl V and committed Unicode without enabling mouse control", async () => {
  const backend = new FakeBackend();
  backend.devices = [{ ...backend.devices[0], platform: "ios" }];
  const mirror = new PhoneMirrorController(backend);
  await mirror.refreshDevices();
  let tick: () => Promise<void> = async () => {};
  const inputBackend = {
    start: vi.fn(async () => ({
      receiverId: "keyboard",
      codes: ["PMK1|127.0.0.1:1234|secret"],
    })),
    status: vi.fn(async () => ({ connected: true, generation: "1" })),
    stop: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
  };
  const keyboard = new IosKeyboardInputController(inputBackend, (fn) => {
    tick = fn;
    return () => {};
  });
  const clipboard = { readText: vi.fn(async () => "한日中ع😀") };
  render(
    <PhoneMirrorApp
      controller={mirror}
      iosKeyboardInputController={keyboard}
      textClipboard={clipboard}
    />,
  );
  expect(screen.getByRole("button", { name: "폰에 붙여넣기" })).toBeDisabled();
  fireEvent.click(screen.getByText("iPhone 다국어 입력 연결"));
  fireEvent.click(
    screen.getByRole("button", { name: "iPhone 키보드 연결 시작" }),
  );
  await waitFor(() => expect(inputBackend.start).toHaveBeenCalledTimes(1));
  await act(async () => {
    await tick();
    await mirror.start();
    mirror.frameRendered(100, 200);
  });
  expect(mirror.getCapabilities().control).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "폰에 붙여넣기" }));
  await waitFor(() => expect(inputBackend.send).toHaveBeenCalledTimes(1));
  for (const modifier of [{ metaKey: true }, { ctrlKey: true }]) {
    fireEvent.keyDown(screen.getByLabelText("폰 영상"), {
      key: "v",
      ...modifier,
    });
    await act(async () => {});
  }
  const field = screen.getByLabelText("다국어 직접 입력");
  fireEvent.compositionStart(field);
  fireEvent.input(field, { target: { value: "日本語" }, isComposing: true });
  expect(inputBackend.send).toHaveBeenCalledTimes(3);
  fireEvent.compositionEnd(field, { data: "日本語" });
  await act(async () => {});
  expect(inputBackend.send).toHaveBeenLastCalledWith(
    "keyboard",
    { kind: "paste", text: "日本語" },
    "1",
  );
  await act(async () => {
    await mirror.stop();
  });
  expect(screen.getByRole("button", { name: "폰에 붙여넣기" })).toBeDisabled();
});
