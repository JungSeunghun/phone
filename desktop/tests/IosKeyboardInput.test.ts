import { it, expect, vi } from "vitest";
import { IosKeyboardInputController } from "../src/application/IosKeyboardInputController";
it("pairs explicitly, scopes input to the selected iPhone and clears late status", async () => {
  let tick = () => {};
  const backend = {
    start: vi.fn(async () => ({
      receiverId: "keyboard-1",
      codes: ["PMK1|127.0.0.1:1234|key"],
    })),
    stop: vi.fn(async () => {}),
    status: vi.fn(async () => ({ connected: true, generation: "1" })),
    send: vi.fn(async () => {}),
  };
  const controller = new IosKeyboardInputController(backend, (fn) => {
    tick = fn;
    return () => {
      tick = () => {};
    };
  });
  await controller.start("iphone-1");
  await tick();
  expect(controller.session("iphone-1")).toBe("keyboard-1:1");
  expect(controller.session("iphone-2")).toBeUndefined();
  await controller.send({ kind: "paste", text: "한日中ع😀" }, "keyboard-1:1");
  expect(backend.send).toHaveBeenCalledTimes(1);
  await controller.stop();
  expect(controller.session("iphone-1")).toBeUndefined();
  await expect(
    controller.send({ kind: "paste", text: "x" }, "keyboard-1:1"),
  ).rejects.toThrow();
});
it("cancels a late start and never reuses a stopped keyboard", async () => {
  let finish!: (value: { receiverId: string; codes: string[] }) => void;
  const backend = {
    start: vi.fn(
      () =>
        new Promise<{ receiverId: string; codes: string[] }>((r) => {
          finish = r;
        }),
    ),
    stop: vi.fn(async () => {}),
    status: vi.fn(async () => ({ connected: true, generation: "1" })),
    send: vi.fn(async () => {}),
  };
  const controller = new IosKeyboardInputController(backend);
  const start = controller.start("iphone-1");
  await controller.stop();
  void controller.start("iphone-2");
  expect(backend.start).toHaveBeenCalledTimes(1);
  finish({ receiverId: "late", codes: [] });
  await start;
  expect(backend.stop).toHaveBeenCalledWith("late");
  expect(controller.getSnapshot().receiverId).toBeUndefined();
});
it("discards a late connected status after stop and retains failed stop for retry", async () => {
  let tick: () => Promise<void> = async () => {};
  let finish!: (value: { connected: boolean; generation: string }) => void;
  const backend = {
    start: vi.fn(async () => ({ receiverId: "one", codes: [] })),
    status: vi.fn(
      () =>
        new Promise<{ connected: boolean; generation: string }>((r) => {
          finish = r;
        }),
    ),
    stop: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
  };
  const controller = new IosKeyboardInputController(backend, (fn) => {
    tick = fn;
    return () => {};
  });
  await controller.start("iphone");
  const poll = tick();
  await controller.stop();
  finish({ connected: true, generation: "1" });
  await poll;
  expect(controller.session("iphone")).toBeUndefined();
  await controller.start("iphone");
  backend.stop.mockRejectedValueOnce(Error("stop"));
  await controller.stop();
  expect(controller.getSnapshot().receiverId).toBe("one");
  expect(controller.session("iphone")).toBeUndefined();
  await controller.stop();
  expect(controller.getSnapshot().receiverId).toBeUndefined();
});
it("changes the input session on keyboard reconnection even if a poll misses the disconnected state", async () => {
  let tick: () => Promise<void> = async () => {};
  let generation = "1";
  const backend = {
    start: vi.fn(async () => ({ receiverId: "receiver", codes: [] })),
    status: vi.fn(async () => ({ connected: true, generation })),
    stop: vi.fn(async () => {}),
    send: vi.fn(async () => {}),
  };
  const controller = new IosKeyboardInputController(backend, (fn) => {
    tick = fn;
    return () => {};
  });
  await controller.start("iphone");
  await tick();
  const session = controller.session("iphone")!;
  generation = "2";
  await tick();
  expect(controller.session("iphone")).not.toBe(session);
  await expect(
    controller.send({ kind: "paste", text: "stale" }, session),
  ).rejects.toThrow();
  await controller.stop();
});
