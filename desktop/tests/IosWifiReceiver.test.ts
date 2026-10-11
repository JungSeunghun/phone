import { it, expect, vi } from "vitest";
import { IosWifiReceiverController } from "../src/application/IosWifiReceiverController";
it("rejects duplicate starts and cleans up a receiver arriving after stop", async () => {
  let resolve!: (v: {
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
  const controller = new IosWifiReceiverController(backend);
  const start = controller.start();
  void controller.start();
  expect(backend.start).toHaveBeenCalledTimes(1);
  await controller.stop();
  resolve({ receiverId: "late", port: 1, codes: ["secret"] });
  await start;
  expect(backend.stop).toHaveBeenCalledWith("late");
  expect(controller.snapshot.codes).toEqual([]);
});
it("clears connection codes on stop, reports failures and permits retry", async () => {
  const backend = {
    start: vi
      .fn()
      .mockRejectedValueOnce(Error("failed"))
      .mockResolvedValue({ receiverId: "id", port: 65535, codes: ["code"] }),
    stop: vi.fn(async () => {}),
  };
  const controller = new IosWifiReceiverController(backend);
  await controller.start();
  expect(controller.snapshot.phase).toBe("error");
  await controller.start();
  expect(controller.snapshot.phase).toBe("listening");
  await controller.stop();
  expect(controller.snapshot.codes).toEqual([]);
});
it("ignores a late stop failure after a new receiver starts", async () => {
  let reject!: (error: Error) => void;
  const backend = {
    start: vi.fn(async () => ({
      receiverId: crypto.randomUUID(),
      port: 12,
      codes: ["code"],
    })),
    stop: vi.fn(() => new Promise<void>((_, r) => (reject = r))),
  };
  const controller = new IosWifiReceiverController(backend);
  await controller.start();
  const stopping = controller.stop();
  await controller.start();
  reject(Error("late"));
  await stopping;
  expect(controller.snapshot.phase).toBe("listening");
});
