import { it, expect, vi } from "vitest";
import { IosReceiverController } from "../src/application/IosReceiverController";
it("USB start is idempotent, explains wired sender setup, clears secrets and stops a late start", async () => {
  let resolve!: (value: {
    receiverId: string;
    port: number;
    codes: string[];
  }) => void;
  const backend = {
    start: vi.fn(
      () =>
        new Promise<{ receiverId: string; port: number; codes: string[] }>(
          (r) => (resolve = r),
        ),
    ),
    stop: vi.fn(async () => {}),
  };
  const controller = new IosReceiverController(backend, "usb");
  const start = controller.start();
  await controller.start();
  expect(backend.start).toHaveBeenCalledTimes(1);
  await controller.stop();
  resolve({ receiverId: "late", port: 27483, codes: ["PMU1|27483|key"] });
  await start;
  expect(backend.stop).toHaveBeenCalledWith("late");
  expect(controller.getSnapshot().codes).toEqual([]);
  backend.start.mockImplementation(async () => ({
    receiverId: "live",
    port: 27483,
    codes: ["PMU1|27483|key"],
  }));
  await controller.start();
  expect(controller.getSnapshot().message).toContain("USB");
  await controller.stop();
  expect(controller.getSnapshot().codes).toEqual([]);
});

it.each(["wifi", "usb"] as const)(
  "%s retains cleanup failures and blocks starts until retry succeeds",
  async (transport) => {
    const backend = {
      start: vi.fn(async () => ({
        receiverId: "retained",
        port: 1234,
        codes: ["secret"],
      })),
      stop: vi
        .fn()
        .mockRejectedValueOnce(Error("cleanup"))
        .mockResolvedValue(undefined),
    };
    const controller = new IosReceiverController(backend, transport);
    await controller.start();
    await controller.stop();
    expect(controller.getSnapshot()).toMatchObject({
      phase: "stopError",
      receiverId: "retained",
      codes: [],
    });
    await controller.start();
    expect(backend.start).toHaveBeenCalledTimes(1);
    await controller.stop();
    expect(backend.stop).toHaveBeenLastCalledWith("retained");
    expect(controller.getSnapshot()).toMatchObject({
      phase: "idle",
      receiverId: undefined,
    });
  },
);

it("retains a late receiver when cancellation cleanup fails", async () => {
  let resolve!: (value: {
    receiverId: string;
    port: number;
    codes: string[];
  }) => void;
  const backend = {
    start: vi.fn(
      () =>
        new Promise<{ receiverId: string; port: number; codes: string[] }>(
          (r) => (resolve = r),
        ),
    ),
    stop: vi
      .fn()
      .mockRejectedValueOnce(Error("cleanup"))
      .mockResolvedValue(undefined),
  };
  const controller = new IosReceiverController(backend);
  const starting = controller.start();
  await controller.stop();
  void controller.start();
  expect(backend.start).toHaveBeenCalledTimes(1);
  resolve({ receiverId: "late", port: 1234, codes: ["secret"] });
  await starting;
  expect(controller.getSnapshot()).toMatchObject({
    phase: "stopError",
    receiverId: "late",
    codes: [],
  });
  await controller.stop();
  expect(controller.getSnapshot().phase).toBe("idle");
});

it("coalesces repeated stops and blocks start while cleanup is pending", async () => {
  let resolve!: () => void;
  const backend = {
    start: vi.fn(async () => ({
      receiverId: "active",
      port: 1234,
      codes: ["secret"],
    })),
    stop: vi.fn(() => new Promise<void>((r) => (resolve = r))),
  };
  const controller = new IosReceiverController(backend);
  await controller.start();
  const stopping = controller.stop();
  await controller.stop();
  await controller.start();
  expect(backend.stop).toHaveBeenCalledTimes(1);
  expect(backend.start).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot()).toMatchObject({
    phase: "stopping",
    codes: [],
  });
  resolve();
  await stopping;
  expect(controller.getSnapshot().phase).toBe("idle");
});
