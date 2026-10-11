import { it, expect, vi } from "vitest";
import { WindowPresentationController } from "../src/application/WindowPresentationController";
const dimensions = { width: 886, height: 1920 };
it("requires a live frame, prevents duplicates and restores after disconnect during a pending transition", async () => {
  let complete!: (mode: "pip") => void;
  const backend = {
    setMode: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValue("normal"),
  };
  const controller = new WindowPresentationController(backend);
  await controller.setMode("pip");
  expect(backend.setMode).not.toHaveBeenCalled();
  controller.setLive(true, dimensions);
  const pending = controller.setMode("pip");
  void controller.setMode("fullscreen");
  expect(backend.setMode).toHaveBeenCalledTimes(1);
  controller.setLive(false);
  complete("pip");
  await pending;
  expect(backend.setMode).toHaveBeenLastCalledWith("normal", undefined);
  expect(controller.getSnapshot().mode).toBe("normal");
  expect(controller.getSnapshot().busy).toBe(false);
});
it("changes modes and reports failures without abandoning a restore retry", async () => {
  const backend = {
    setMode: vi
      .fn()
      .mockResolvedValueOnce("fullscreen")
      .mockRejectedValueOnce(new Error("window failed"))
      .mockResolvedValue("normal"),
  };
  const c = new WindowPresentationController(backend);
  c.setLive(true, dimensions);
  await c.setMode("fullscreen");
  expect(c.getSnapshot().mode).toBe("fullscreen");
  await c.setMode("normal");
  expect(c.getSnapshot().mode).toBe("fullscreen");
  expect(c.getSnapshot().message).toContain("window failed");
  await c.setMode("normal");
  expect(c.getSnapshot().mode).toBe("normal");
});
it("validates dimensions, synchronizes native close restore and disposes late transitions", async () => {
  const backend = { setMode: vi.fn().mockResolvedValue("pip") };
  const c = new WindowPresentationController(backend);
  for (const width of [0, 8193, NaN, Infinity, 1.5]) {
    c.setLive(true, { width, height: 1 });
    await c.setMode("pip");
  }
  expect(backend.setMode).not.toHaveBeenCalled();
  c.setLive(true, { width: 1, height: 8192 });
  await c.setMode("pip");
  c.nativeModeChanged("normal");
  expect(c.getSnapshot().mode).toBe("normal");
  c.dispose();
  await c.setMode("pip");
  expect(backend.setMode).toHaveBeenCalledTimes(1);
});
it("restores after disposal during a late successful native transition", async () => {
  let complete!: (mode: "fullscreen") => void;
  const backend = {
    setMode: vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            complete = resolve;
          }),
      )
      .mockResolvedValue("normal"),
  };
  const c = new WindowPresentationController(backend);
  c.setLive(true, dimensions);
  const pending = c.setMode("fullscreen");
  c.dispose();
  complete("fullscreen");
  await pending;
  expect(backend.setMode).toHaveBeenLastCalledWith("normal");
  expect(c.getSnapshot().mode).toBe("normal");
});

it("does not overwrite a native close restore with an older transition response", async () => {
  let complete!: (mode: "pip") => void;
  const backend = {
    setMode: vi.fn(
      () =>
        new Promise<"pip">((resolve) => {
          complete = resolve;
        }),
    ),
  };
  const c = new WindowPresentationController(backend);
  c.setLive(true, dimensions);
  const pending = c.setMode("pip");
  c.nativeModeChanged("pip");
  c.nativeModeChanged("normal");
  complete("pip");
  await pending;
  expect(c.getSnapshot().mode).toBe("normal");
});
