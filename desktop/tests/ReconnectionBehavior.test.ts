import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { PhoneMirrorController } from "../src/application/PhoneMirrorController";
import { FakeBackend, usbDevice, wifiDevice } from "./fixtures";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
it("reconnects only at the delay boundary and retains Wi-Fi even when USB remains", async () => {
  const backend = new FakeBackend(),
    controller = new PhoneMirrorController(backend);
  await controller.refreshDevices();
  controller.selectDevice("wifi:A");
  await controller.start();
  backend.callbacks!.onStatus({ phase: "failed", message: "disconnected" });
  backend.devices = [usbDevice];
  await vi.advanceTimersByTimeAsync(1000);
  expect(backend.startSession).toHaveBeenCalledTimes(1);
  backend.devices = [
    usbDevice,
    {
      ...wifiDevice,
      endpoint: { ...wifiDevice.endpoint, address: "1.2.3.5:2" },
    },
  ];
  await vi.advanceTimersByTimeAsync(1999);
  expect(backend.startSession).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(backend.startSession).toHaveBeenCalledTimes(2);
  expect(backend.startSession.mock.calls[1][0].target.transport).toBe("wifi");
  await controller.stop();
});
it("manual stop cancels pending retry and a late start completion", async () => {
  const backend = new FakeBackend(),
    controller = new PhoneMirrorController(backend);
  await controller.refreshDevices();
  await controller.start();
  backend.callbacks!.onStatus({ phase: "failed", message: "disconnected" });
  await controller.stop();
  await vi.advanceTimersByTimeAsync(20000);
  expect(backend.startSession).toHaveBeenCalledTimes(1);
  let resolve!: () => void;
  backend.startSession.mockImplementation(async (_, callbacks) => {
    backend.callbacks = callbacks;
    await new Promise<void>((done) => {
      resolve = done;
    });
  });
  const start = controller.start();
  const old = backend.callbacks!;
  await controller.stop();
  resolve();
  await start;
  old.onStatus({ phase: "failed", message: "late" });
  expect(controller.snapshot.phase).toBe("ready");
});
it("stops after five failed retries and never treats a channel connection as a rendered frame", async () => {
  const backend = new FakeBackend(),
    controller = new PhoneMirrorController(backend);
  await controller.refreshDevices();
  await controller.start();
  for (const delay of [1000, 2000, 4000, 8000, 16000]) {
    backend.callbacks!.onStatus({ phase: "failed", message: "lost" });
    await vi.advanceTimersByTimeAsync(delay);
  }
  backend.callbacks!.onStatus({ phase: "failed", message: "lost" });
  expect(controller.snapshot.phase).toBe("error");
  await vi.advanceTimersByTimeAsync(60000);
  expect(backend.startSession).toHaveBeenCalledTimes(6);
  await controller.stop();
});
it("rejects invalid rendered sizes and times out exactly at fifteen seconds", async () => {
  const backend = new FakeBackend(),
    controller = new PhoneMirrorController(backend);
  await controller.refreshDevices();
  await controller.start();
  for (const size of [0, -1, 8193, 1.5, NaN, Infinity])
    controller.frameRendered(size, 100);
  expect(controller.snapshot.phase).toBe("connecting");
  await vi.advanceTimersByTimeAsync(14999);
  expect(controller.snapshot.phase).toBe("connecting");
  await vi.advanceTimersByTimeAsync(1);
  expect(controller.snapshot.phase).toBe("reconnecting");
  await controller.stop();
});
