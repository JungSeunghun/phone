import { describe, it, expect, vi } from "vitest";
import { PhoneMirrorController } from "../src/application/PhoneMirrorController";
import { FakeBackend, usbDevice, wifiDevice } from "./fixtures";
describe("phone mirror user intent and asynchronous boundaries", () => {
  it("ignores a decoder failure completion after the user has started a new session", async () => {
    const backend = new FakeBackend(),
      controller = new PhoneMirrorController(backend);
    await controller.refreshDevices();
    await controller.start();
    let finish!: () => void;
    backend.stopSession.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    controller.videoFailed("old decoder failure");
    await controller.start();
    controller.frameRendered(886, 1920);
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.snapshot.phase).toBe("live");
    expect(controller.snapshot.message).not.toContain("old decoder failure");
    await controller.stop();
  });
  it("restores validated preferences without starting and falls back on corrupt settings", async () => {
    const backend = new FakeBackend(),
      save = vi.fn();
    const controller = new PhoneMirrorController(backend, {
      load: () => ({
        selectedDeviceId: "wifi:A",
        settings: {
          videoMaxDimension: 720,
          videoMaxFrameRate: 15,
          keepScreenAwake: false,
        },
        autoReconnect: false,
      }),
      save,
    });
    await controller.refreshDevices();
    expect(controller.snapshot.selectedDeviceId).toBe("wifi:A");
    expect(controller.snapshot.settings.videoMaxDimension).toBe(720);
    expect(backend.startSession).not.toHaveBeenCalled();
    const corrupt = new PhoneMirrorController(backend, {
      load: () => {
        throw new Error("corrupt");
      },
      save,
    });
    expect(corrupt.snapshot.settings.videoMaxDimension).toBe(1920);
    expect(corrupt.snapshot.autoReconnect).toBe(true);
  });
  it("lists USB and Wi-Fi separately without starting on discovery", async () => {
    const backend = new FakeBackend(),
      controller = new PhoneMirrorController(backend);
    await controller.refreshDevices();
    expect(controller.snapshot.devices.map((d) => d.id)).toEqual([
      "usb:A",
      "wifi:A",
    ]);
    expect(backend.startSession).not.toHaveBeenCalled();
  });
  it("blocks invalid/offline selection and duplicate starts; only a rendered frame means live", async () => {
    const backend = new FakeBackend(),
      controller = new PhoneMirrorController(backend);
    await controller.refreshDevices();
    controller.selectDevice("missing");
    expect(controller.snapshot.selectedDeviceId).toBe("usb:A");
    await controller.start();
    await controller.start();
    expect(backend.startSession).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.phase).toBe("connecting");
    backend.callbacks?.onStatus({
      phase: "streaming",
      message: "stream ready",
    });
    expect(controller.snapshot.phase).toBe("connecting");
    controller.frameRendered(886, 1920);
    expect(controller.snapshot.phase).toBe("live");
  });
  it("manual stop clears video and ignores late frames/errors from the old session", async () => {
    const backend = new FakeBackend(),
      controller = new PhoneMirrorController(backend);
    await controller.refreshDevices();
    await controller.start();
    const old = backend.callbacks!;
    controller.frameRendered(1, 1);
    await controller.stop();
    old.onStatus({ phase: "failed", message: "late failure" });
    old.onPacket(new ArrayBuffer(13));
    expect(controller.snapshot.phase).toBe("ready");
    expect(controller.snapshot.dimensions).toBeNull();
    expect(backend.stopSession).toHaveBeenCalledTimes(1);
  });
  it("selection preserves transport and resolves new Wi-Fi endpoints through a stable device ID", async () => {
    const backend = new FakeBackend(),
      controller = new PhoneMirrorController(backend);
    await controller.refreshDevices();
    controller.selectDevice("wifi:A");
    backend.devices = [
      usbDevice,
      {
        ...wifiDevice,
        endpoint: { ...wifiDevice.endpoint, address: "1.2.3.9:65535" },
      },
    ];
    await controller.refreshDevices();
    await controller.start();
    expect(backend.startSession.mock.calls[0][0].target).toEqual({
      identity: "A",
      transport: "wifi",
    });
    expect(controller.snapshot.selectedDeviceId).toBe("wifi:A");
  });
  it("clears the pairing secret immediately, rejects bad values and suppresses duplicate pairing", async () => {
    const backend = new FakeBackend(),
      controller = new PhoneMirrorController(backend);
    controller.setPairingAddress("1.2.3.4:65536");
    controller.setPairingCode("123456");
    expect(controller.snapshot.canPair).toBe(false);
    controller.setPairingAddress("1.2.3.4:1");
    controller.setPairingCode("１２３４５６");
    expect(controller.snapshot.canPair).toBe(false);
    controller.setPairingCode("000000");
    expect(controller.snapshot.canPair).toBe(true);
    let finish!: () => void;
    backend.pairDevice.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = controller.pair();
    expect(controller.snapshot.pairingCode).toBe("");
    await controller.pair();
    expect(backend.pairDevice).toHaveBeenCalledTimes(1);
    finish();
    await pending;
  });
});
it("prepares audio on start, drops old packets after stop and routes controls only to the live session", async () => {
  const backend = new FakeBackend();
  const send = vi.fn(async (_id: string, _input: unknown) => {});
  Object.assign(backend, { sendControl: send });
  const controller = new PhoneMirrorController(backend);
  const audio = {
    prepare: vi.fn(async () => {}),
    write: vi.fn(),
    reset: vi.fn(),
    close: vi.fn(),
    setMuted: vi.fn(),
  };
  controller.attachAudioSink(audio);
  await controller.refreshDevices();
  await controller.start();
  expect(audio.prepare).toHaveBeenCalledTimes(1);
  const callbacks = backend.callbacks!;
  callbacks.onAudio?.(new ArrayBuffer(16));
  expect(audio.write).toHaveBeenCalledTimes(1);
  await expect(controller.sendControl({ kind: "back" })).rejects.toThrow();
  controller.frameRendered(100, 200);
  await controller.sendControl({ kind: "back" });
  expect(send).toHaveBeenCalledTimes(1);
  controller.setAudioMuted(true);
  expect(audio.setMuted).toHaveBeenLastCalledWith(true);
  await controller.stop();
  callbacks.onAudio?.(new ArrayBuffer(16));
  expect(audio.write).toHaveBeenCalledTimes(1);
  await expect(controller.sendControl({ kind: "back" })).rejects.toThrow();
  expect(audio.reset).toHaveBeenCalled();
});

it("ignores late audio readiness and errors after a manual disconnect", async () => {
  const backend = new FakeBackend(),
    controller = new PhoneMirrorController(backend);
  await controller.refreshDevices();
  let fail!: (reason: Error) => void;
  controller.attachAudioSink({
    prepare: vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementation(
        () =>
          new Promise<void>((_resolve, reject) => {
            fail = reject;
          }),
      ),
    write: vi.fn(),
    setMuted: vi.fn(),
    reset: vi.fn(),
    close: vi.fn(),
  });
  await controller.start();
  const late = controller.enableAudio();
  await controller.stop();
  controller.setAudioMessage("컴퓨터에서 폰 소리 재생 중", "playing");
  fail(Error("late audio"));
  await late;
  expect(controller.getSnapshot().audioPlayback).toBe("idle");
  expect(controller.getSnapshot().audioMessage).toContain("종료");
});
it("shows an audio preparation failure for the newly started session", async () => {
  const backend = new FakeBackend(),
    controller = new PhoneMirrorController(backend);
  await controller.refreshDevices();
  controller.attachAudioSink({
    prepare: async () => {
      throw Error("blocked");
    },
    write: vi.fn(),
    setMuted: vi.fn(),
    reset: vi.fn(),
    close: vi.fn(),
  });
  await controller.start();
  expect(controller.getSnapshot().audioPlayback).toBe("blocked");
  await controller.stop();
});
