import { expect, it, vi } from "vitest";
import { NativeMediaCapture } from "../src/infrastructure/NativeMediaCapture";
import { MediaCaptureController } from "../src/application/MediaCaptureController";
it("uses the native encoded stream, stops once, and never makes a canvas recorder", async () => {
  const start = vi.fn(async () => "recording"),
    finish = vi.fn(async () => ({ nativeRecordingId: "file" })),
    status = vi.fn(async () => true);
  const capture = new NativeMediaCapture(
    { start, finish, status },
    () => ({ sessionId: "session", width: 320, height: 180, fps: 60 }),
    async () => new Blob(["png"]),
  );
  const limit = vi.fn(),
    recording = capture.record(limit);
  const a = recording.stop(),
    b = recording.stop();
  expect(a).toBe(b);
  expect(await a).toEqual({ nativeRecordingId: "file" });
  expect(start).toHaveBeenCalledOnce();
  expect(finish).toHaveBeenCalledExactlyOnceWith("session", "recording");
  expect(limit).not.toHaveBeenCalled();
});
it("finalizes a pending native start after disconnect and saves an opaque file handle", async () => {
  let ready!: (value: string) => void;
  const source = new NativeMediaCapture(
    {
      start: () =>
        new Promise((resolve) => {
          ready = resolve;
        }),
      finish: async () => ({ nativeRecordingId: "file" }),
      status: async () => true,
    },
    () => ({ sessionId: "session", width: 320, height: 180, fps: 60 }),
    async () => new Blob(),
  );
  const save = vi.fn(async () => "file.mp4"),
    controller = new MediaCaptureController(source, { save });
  controller.setLive(true);
  controller.startRecording();
  controller.setLive(false);
  ready("recording");
  await controller.finish();
  expect(save).toHaveBeenCalledExactlyOnceWith({ nativeRecordingId: "file" });
  expect(controller.getSnapshot().busy).toBe(false);
});
it("reports start failure and rejects recording without an active session", async () => {
  const callback = vi.fn();
  const source = new NativeMediaCapture(
    {
      start: async () => {
        throw Error("start");
      },
      finish: vi.fn(),
      status: async () => true,
    },
    () => ({ sessionId: "s", width: 1, height: 1, fps: 60 }),
    async () => new Blob(),
  );
  const recording = source.record(callback);
  await Promise.resolve();
  await expect(recording.stop()).rejects.toThrow("start");
  expect(callback).toHaveBeenCalledOnce();
  const invalid = new NativeMediaCapture(
    { start: vi.fn(), finish: vi.fn(), status: vi.fn() },
    () => undefined,
    async () => new Blob(),
  );
  expect(() => invalid.record(callback)).toThrow();
});

it("polls native limits once and ignores a late response after stop", async () => {
  vi.useFakeTimers();
  try {
    let respond!: (value: boolean) => void;
    const callback = vi.fn(),
      backend = {
        start: async () => "id",
        finish: async () => ({ nativeRecordingId: "file" }),
        status: vi.fn(
          () =>
            new Promise<boolean>((resolve) => {
              respond = resolve;
            }),
        ),
      };
    const source = new NativeMediaCapture(
      backend,
      () => ({ sessionId: "s", width: 1, height: 1, fps: 60 }),
      async () => new Blob(),
    );
    const recording = source.record(callback);
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(backend.status).toHaveBeenCalledOnce();
    await recording.stop();
    respond(false);
    await Promise.resolve();
    expect(callback).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});
