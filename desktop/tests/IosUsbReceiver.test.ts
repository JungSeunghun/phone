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
