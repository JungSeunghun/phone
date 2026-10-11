import { describe, it, expect, vi } from "vitest";
import { MediaCaptureController } from "../src/application/MediaCaptureController";
function fixture() {
  const recording = {
    stop: vi.fn(async () => new Blob(["video"], { type: "video/mp4" })),
  };
  const source = {
    screenshot: vi.fn(async () => new Blob(["png"], { type: "image/png" })),
    record: vi.fn(() => recording),
  };
  const store = { save: vi.fn(async () => "/capture.png") };
  const controller = new MediaCaptureController(source, store);
  return { controller, source, store, recording };
}
describe("media capture actions", () => {
  it("rejects capture without a live frame and duplicate screenshot actions", async () => {
    const f = fixture();
    await f.controller.screenshot();
    expect(f.source.screenshot).not.toHaveBeenCalled();
    f.controller.setLive(true);
    const first = f.controller.screenshot();
    await f.controller.screenshot();
    await first;
    expect(f.source.screenshot).toHaveBeenCalledTimes(1);
    expect(f.store.save).toHaveBeenCalledTimes(1);
  });
  it("finalizes once when disconnected and does not resume recording on reconnect", async () => {
    const f = fixture();
    f.controller.setLive(true);
    f.controller.startRecording();
    f.controller.startRecording();
    f.controller.setLive(false);
    await f.controller.stopRecording();
    expect(f.source.record).toHaveBeenCalledTimes(1);
    expect(f.recording.stop).toHaveBeenCalledTimes(1);
    expect(f.store.save).toHaveBeenCalledTimes(1);
    f.controller.setLive(true);
    expect(f.controller.getSnapshot().recording).toBe(false);
  });
  it("reports cancellation and recovers after encoding or storage failure", async () => {
    const f = fixture();
    f.controller.setLive(true);
    f.store.save.mockResolvedValueOnce(null as unknown as string);
    await f.controller.screenshot();
    expect(f.controller.getSnapshot().message).toContain("취소");
    f.source.screenshot.mockRejectedValueOnce(Error("encode"));
    await f.controller.screenshot();
    expect(f.controller.getSnapshot().busy).toBe(false);
    await f.controller.screenshot();
    expect(f.store.save).toHaveBeenCalledTimes(2);
  });
  it("rejects empty output and keeps the finalization busy until save completes", async () => {
    const f = fixture();
    f.controller.setLive(true);
    f.source.screenshot.mockResolvedValueOnce(new Blob());
    await f.controller.screenshot();
    expect(f.store.save).not.toHaveBeenCalled();
    let done!: (value: string) => void;
    f.store.save.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          done = resolve;
        }),
    );
    f.controller.startRecording();
    const stop = f.controller.stopRecording();
    await Promise.resolve();
    expect(f.controller.getSnapshot().busy).toBe(true);
    f.controller.startRecording();
    expect(f.source.record).toHaveBeenCalledTimes(1);
    done("/video.mp4");
    await stop;
    expect(f.controller.getSnapshot().busy).toBe(false);
  });
});
it("shutdown waits for an outstanding screenshot save dialog", async () => {
  const f = fixture();
  f.controller.setLive(true);
  let done!: (value: string) => void;
  f.store.save.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        done = resolve;
      }),
  );
  const shot = f.controller.screenshot();
  await Promise.resolve();
  let finished = false;
  const shutdown = f.controller.finish().then(() => {
    finished = true;
  });
  await Promise.resolve();
  expect(finished).toBe(false);
  done("/saved");
  await shot;
  await shutdown;
  expect(finished).toBe(true);
  expect(f.controller.getSnapshot().live).toBe(false);
});

it("uses monotonic elapsed seconds, stops its timer once and resets only for a new recording", async () => {
  let now = 10_000,
    tick!: () => void;
  const cancel = vi.fn();
  const clock = {
    now: () => now,
    repeat: vi.fn((callback: () => void) => {
      tick = callback;
      return cancel;
    }),
  };
  const source = {
    screenshot: vi.fn(),
    record: vi.fn(() => ({ stop: async () => new Blob(["video"]) })),
  };
  const c = new MediaCaptureController(
    source,
    { save: async () => null },
    clock,
  );
  c.setLive(true);
  c.startRecording();
  c.startRecording();
  expect(clock.repeat).toHaveBeenCalledTimes(1);
  now = 10_999;
  tick();
  expect(c.getSnapshot().elapsedSeconds).toBe(0);
  now = 11_000;
  tick();
  expect(c.getSnapshot().elapsedSeconds).toBe(1);
  now = 9_000;
  tick();
  expect(c.getSnapshot().elapsedSeconds).toBe(1);
  now = NaN;
  tick();
  expect(c.getSnapshot().elapsedSeconds).toBe(1);
  now = 3_610_000;
  tick();
  expect(c.getSnapshot().elapsedSeconds).toBe(3600);
  await c.stopRecording();
  expect(cancel).toHaveBeenCalledTimes(1);
  now = 4_000_000;
  tick();
  expect(c.getSnapshot().elapsedSeconds).toBe(3600);
  c.startRecording();
  expect(c.getSnapshot().elapsedSeconds).toBe(0);
  await c.finish();
  expect(cancel).toHaveBeenCalledTimes(2);
});
it("samples final elapsed time even when the periodic callback was throttled", async () => {
  let now = 0;
  const c = new MediaCaptureController(
    {
      screenshot: vi.fn(),
      record: () => ({ stop: async () => new Blob(["video"]) }),
    },
    { save: async () => null },
    { now: () => now, repeat: () => () => {} },
  );
  c.setLive(true);
  c.startRecording();
  now = 2100;
  await c.stopRecording();
  expect(c.getSnapshot().elapsedSeconds).toBe(2);
});
it("ignores a stale size-limit callback after a new recording has started", async () => {
  const callbacks: (() => void)[] = [];
  const c = new MediaCaptureController(
    {
      screenshot: vi.fn(),
      record: (callback) => {
        callbacks.push(callback);
        return { stop: async () => new Blob(["video"]) };
      },
    },
    { save: async () => null },
  );
  c.setLive(true);
  c.startRecording();
  await c.stopRecording();
  c.startRecording();
  callbacks[0]();
  expect(c.getSnapshot().recording).toBe(true);
  await c.finish();
});
