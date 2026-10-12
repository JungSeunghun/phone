import { it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PhoneMirrorApp } from "../src/presentation/PhoneMirrorApp";
import { PhoneMirrorController } from "../src/application/PhoneMirrorController";
import { MediaCaptureController } from "../src/application/MediaCaptureController";
import { FakeBackend } from "./fixtures";
const native = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: string }) => void>(),
  invoke: vi.fn(async () => ({ configured: false, version: "0.2.0" })),
}));
vi.mock("@tauri-apps/api/core", async (original) => ({
  ...(await original<object>()),
  isTauri: () => true,
  invoke: native.invoke,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(
    async (event: string, listener: (event: { payload: string }) => void) => {
      native.listeners.set(event, listener);
      return () => native.listeners.delete(event);
    },
  ),
}));
it("cancels native quit after save failure and leaves the mirror stopped for retry", async () => {
  const controller = new PhoneMirrorController(new FakeBackend());
  const media = new MediaCaptureController(
    {
      screenshot: vi.fn(),
      record: () => ({ stop: async () => ({ nativeRecordingId: "retained" }) }),
    },
    {
      save: async () => {
        throw Error("disk full");
      },
    },
  );
  await controller.refreshDevices();
  render(<PhoneMirrorApp controller={controller} mediaController={media} />);
  await act(async () => {
    await controller.start();
    controller.frameRendered(320, 640);
    media.startRecording();
    native.listeners.get("media-shutdown")!({ payload: "first-shutdown" });
  });
  expect(native.invoke).toHaveBeenCalledWith("finish_media_shutdown", {
    allowExit: false,
    shutdownId: "first-shutdown",
  });
  expect(controller.getSnapshot().phase).toBe("ready");
  expect(
    screen.getByRole("button", { name: "녹화 저장 다시 시도" }),
  ).toBeEnabled();
});

it("echoes the original shutdown id even when a newer event arrives before completion", async () => {
  const controller = new PhoneMirrorController(new FakeBackend());
  let resolve!: (value: string | null) => void;
  const media = new MediaCaptureController(
    {
      screenshot: vi.fn(),
      record: () => ({ stop: async () => ({ nativeRecordingId: "video" }) }),
    },
    { save: () => new Promise((r) => (resolve = r)) },
  );
  await controller.refreshDevices();
  render(<PhoneMirrorApp controller={controller} mediaController={media} />);
  await act(async () => {
    await controller.start();
    controller.frameRendered(320, 640);
    media.startRecording();
    native.listeners.get("media-shutdown")!({ payload: "old" });
    await Promise.resolve();
    native.listeners.get("media-shutdown")!({ payload: "new" });
  });
  await act(async () => {
    resolve("/saved.mp4");
  });
  expect(native.invoke).toHaveBeenCalledWith("finish_media_shutdown", {
    shutdownId: "old",
    allowExit: true,
  });
  expect(native.invoke).toHaveBeenCalledWith("finish_media_shutdown", {
    shutdownId: "new",
    allowExit: true,
  });
});
