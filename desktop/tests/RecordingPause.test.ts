import { it, expect, vi } from "vitest";
import { MediaCaptureController } from "../src/application/MediaCaptureController";
import { NativeMediaCapture } from "../src/infrastructure/NativeMediaCapture";
it("pauses once, freezes elapsed time, resumes without counting paused duration and stops once", async () => {
  let now = 0,
    tick = () => {};
  const recording = {
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    stop: vi.fn(async () => new Blob(["av"])),
  };
  const store = { save: vi.fn(async () => "/av.mp4") };
  const controller = new MediaCaptureController(
    { screenshot: async () => new Blob(), record: () => recording },
    store,
    {
      now: () => now,
      repeat: (fn) => {
        tick = fn;
        return () => {
          tick = () => {};
        };
      },
    },
  );
  controller.setLive(true);
  controller.startRecording();
  now = 2500;
  tick();
  await controller.pauseRecording();
  await controller.pauseRecording();
  expect(recording.pause).toHaveBeenCalledTimes(1);
  now = 9500;
  tick();
  expect(controller.getSnapshot().elapsedSeconds).toBe(2);
  await controller.resumeRecording();
  await controller.resumeRecording();
  now = 10_500;
  tick();
  expect(controller.getSnapshot().elapsedSeconds).toBe(3);
  await controller.stopRecording();
  expect(recording.stop).toHaveBeenCalledOnce();
  expect(store.save).toHaveBeenCalledOnce();
});
it("ignores pause completion after disconnect and does not resurrect a stopped recording", async () => {
  let finish!: () => void;
  const recording = {
    pause: () => new Promise<void>((r) => (finish = r)),
    resume: vi.fn(async () => {}),
    stop: async () => new Blob(["video"]),
  };
  const controller = new MediaCaptureController(
    { screenshot: async () => new Blob(), record: () => recording },
    { save: async () => "/saved" },
  );
  controller.setLive(true);
  controller.startRecording();
  const pause = controller.pauseRecording();
  controller.setLive(false);
  finish();
  await pause;
  await controller.finish();
  expect(controller.getSnapshot().recording).toBe(false);
  expect(controller.getSnapshot().paused).toBe(false);
});
it("serializes native pause with startup and forbids late pause after stop", async () => {
  const backend = {
    start: vi.fn(async () => "id"),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    status: async () => true,
    finish: async () => ({ nativeRecordingId: "file" }),
  };
  const capture = new NativeMediaCapture(
    backend,
    () => ({
      sessionId: "s",
      width: 320,
      height: 180,
      fps: 30,
      includeAudio: true,
    }),
    async () => new Blob(),
  );
  const r = capture.record(() => {});
  await r.pause!();
  await r.resume!();
  await r.stop();
  await expect(r.pause!()).rejects.toThrow();
  expect(backend.pause).toHaveBeenCalledWith("s", "id");
  expect(backend.resume).toHaveBeenCalledWith("s", "id");
});
it("keeps recording active after pause/resume failure and permits retry", async () => {
  const pause = vi
    .fn()
    .mockRejectedValueOnce(Error("pause"))
    .mockResolvedValue(undefined);
  const resume = vi
    .fn()
    .mockRejectedValueOnce(Error("resume"))
    .mockResolvedValue(undefined);
  const controller = new MediaCaptureController(
    {
      screenshot: async () => new Blob(),
      record: () => ({ pause, resume, stop: async () => new Blob(["video"]) }),
    },
    { save: async () => "/saved" },
  );
  controller.setLive(true);
  controller.startRecording();
  await controller.pauseRecording();
  expect(controller.getSnapshot().paused).toBe(false);
  expect(controller.getSnapshot().pauseBusy).toBe(false);
  await controller.pauseRecording();
  expect(controller.getSnapshot().paused).toBe(true);
  await controller.resumeRecording();
  expect(controller.getSnapshot().paused).toBe(true);
  await controller.resumeRecording();
  expect(controller.getSnapshot().paused).toBe(false);
  await controller.finish();
});
it("prevents a pending native pause from running after stop wins startup", async () => {
  let resolve!: (id: string) => void;
  const backend = {
    start: () => new Promise<string>((r) => (resolve = r)),
    pause: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    status: async () => true,
    finish: vi.fn(async () => ({ nativeRecordingId: "file" })),
  };
  const source = new NativeMediaCapture(
    backend,
    () => ({ sessionId: "s", width: 1, height: 1, fps: 60 }),
    async () => new Blob(),
  );
  const recording = source.record(() => {});
  const paused = recording.pause!();
  const stopped = recording.stop();
  resolve("id");
  await expect(paused).rejects.toThrow();
  await stopped;
  expect(backend.pause).not.toHaveBeenCalled();
  expect(backend.finish).toHaveBeenCalledOnce();
});
