import { describe, it, expect, vi } from "vitest";
import { PhoneMirrorController } from "../src/application/PhoneMirrorController";
import { deviceCapabilities } from "../src/domain/PhoneMirror";
import { FakeBackend, usbDevice } from "./fixtures";
const iosDevice = {
  ...usbDevice,
  id: "usb:ios:phone",
  identity: "ios:phone",
  name: "iPhone",
  platform: "ios" as const,
  capabilities: { control: false, audio: false, keepScreenAwake: false },
};
describe("iPhone USB session capabilities", () => {
  it("keeps legacy Android controls and disables iPhone input and unsupported audio", async () => {
    expect(deviceCapabilities(usbDevice).control).toBe(true);
    const backend = new FakeBackend(),
      sendControl = vi.fn(async () => {});
    const controller = new PhoneMirrorController(
      Object.assign(backend, { sendControl }),
    );
    backend.devices = [iosDevice];
    await controller.refreshDevices();
    await controller.start();
    expect(controller.snapshot.inputMessage).toContain("보기 전용");
    expect(controller.snapshot.audioPlayback).toBe("unavailable");
    controller.frameRendered(1170, 2532);
    await expect(controller.sendControl({ kind: "back" })).rejects.toThrow();
    expect(sendControl).not.toHaveBeenCalled();
    expect(controller.getActiveSessionId()).toBeDefined();
    await controller.stop();
  });
  it("restores iPhone selection, reconnects the same USB identity and ignores late callbacks", async () => {
    vi.useFakeTimers();
    const backend = new FakeBackend();
    backend.devices = [iosDevice];
    const controller = new PhoneMirrorController(backend, {
      load: () => ({ selectedDeviceId: iosDevice.id, autoReconnect: true }),
      save: vi.fn(),
    });
    await controller.refreshDevices();
    await controller.start();
    const old = backend.callbacks!;
    controller.frameRendered(1, 8192);
    expect(controller.snapshot.phase).toBe("live");
    old.onStatus({ phase: "failed", message: "unplug simulated" });
    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.startSession).toHaveBeenCalledTimes(2);
    expect(backend.startSession.mock.calls[1][0].target).toEqual({
      identity: "ios:phone",
      transport: "usb",
    });
    old.onStatus({ phase: "failed", message: "late" });
    expect(controller.snapshot.phase).toBe("connecting");
    await controller.stop();
    vi.useRealTimers();
  });
});
it("keeps the active iPhone capabilities when discovery temporarily loses the device", async () => {
  const backend = new FakeBackend(),
    sendControl = vi.fn(async () => {});
  backend.devices = [iosDevice];
  const controller = new PhoneMirrorController(
    Object.assign(backend, { sendControl }),
  );
  await controller.refreshDevices();
  await controller.start();
  controller.frameRendered(320, 640);
  backend.devices = [];
  await controller.refreshDevices();
  expect(controller.getCapabilities().control).toBe(false);
  await expect(controller.sendControl({ kind: "back" })).rejects.toThrow();
  expect(sendControl).not.toHaveBeenCalled();
  await controller.stop();
});

it("enables USB audio while keeping iPhone control disabled and explicit missing audio unavailable", () => {
  const supported = {
    ...iosDevice,
    capabilities: { ...iosDevice.capabilities, audio: true },
  };
  expect(deviceCapabilities(supported)).toEqual({
    control: false,
    audio: true,
    keepScreenAwake: false,
  });
  expect(deviceCapabilities(iosDevice).audio).toBe(false);
});
