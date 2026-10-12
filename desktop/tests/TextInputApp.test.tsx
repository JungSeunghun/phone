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
it("scopes Cmd/Ctrl V to the live Android viewer and keeps the panel across fullscreen/PiP", async () => {
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
    fireEvent.keyDown(canvas, { key: "v", ...modifier });
    await waitFor(() =>
      expect(clipboard.readText).toHaveBeenCalledTimes(
        modifier.metaKey ? 1 : 2,
      ),
    );
    await act(async () => {});
  }
  expect(backend.sendControl).toHaveBeenCalledTimes(2);
  fireEvent.keyDown(canvas, { key: "v", ctrlKey: true, repeat: true });
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
  expect(screen.getByRole("button", { name: "폰에 붙여넣기" })).toBeEnabled();
  await act(async () => {
    await controller.stop();
  });
  expect(screen.getByRole("button", { name: "폰에 붙여넣기" })).toBeDisabled();
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
