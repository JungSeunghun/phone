import { afterEach, it, expect, vi } from "vitest";
import {
  CanvasMediaCapture,
  recordingMimeType,
  recordingByteLimit,
} from "../src/infrastructure/CanvasMediaCapture";
class Recorder {
  static last: Recorder;
  static isTypeSupported = (type: string) => type === "video/webm";
  state = "inactive";
  mimeType = "video/webm";
  ondataavailable?: (e: { data: Blob }) => void;
  onstop?: () => void;
  onerror?: () => void;
  constructor() {
    Recorder.last = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["end"]) });
    this.onstop?.();
  }
}
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  vi.stubGlobal("MediaRecorder", Recorder);
  const track = { stop: vi.fn() };
  const canvas = {
    captureStream: vi.fn(() => ({ getTracks: () => [track] })),
  } as unknown as HTMLCanvasElement;
  return { canvas, track };
}
it("negotiates format and rejects unsupported codecs", () => {
  expect(recordingMimeType((type) => type === "video/webm")).toBe("video/webm");
  expect(() => recordingMimeType(() => false)).toThrow();
});
it("includes final chunk, finalizes idempotently and closes all tracks", async () => {
  const f = fixture();
  const recording = new CanvasMediaCapture(f.canvas).record(vi.fn());
  Recorder.last.ondataavailable?.({ data: new Blob(["first"]) });
  const first = recording.stop(),
    second = recording.stop();
  expect(first).toBe(second);
  const blob = await first;
  expect(blob.size).toBe(8);
  expect(blob.type).toBe("video/webm");
  expect(f.track.stop).toHaveBeenCalledTimes(1);
});
it("stops at the safety margin and fails rather than saving truncated over-limit data", async () => {
  const f = fixture(),
    limit = vi.fn();
  const recording = new CanvasMediaCapture(f.canvas).record(limit);
  Recorder.last.ondataavailable?.({
    data: { size: recordingByteLimit + 1 } as Blob,
  });
  await expect(recording.stop()).rejects.toThrow();
  expect(limit).toHaveBeenCalledTimes(1);
  expect(f.track.stop).toHaveBeenCalledTimes(1);
});
it("cleans up tracks when recorder construction or start fails", () => {
  const f = fixture();
  class Bad extends Recorder {
    start() {
      throw Error("start");
    }
  }
  vi.stubGlobal("MediaRecorder", Bad);
  expect(() => new CanvasMediaCapture(f.canvas).record(vi.fn())).toThrow();
  expect(f.track.stop).toHaveBeenCalledTimes(1);
});
it("rejects a null PNG result", async () => {
  const canvas = {
    toBlob: (callback: (value: null) => void) => callback(null),
  } as unknown as HTMLCanvasElement;
  await expect(new CanvasMediaCapture(canvas).screenshot()).rejects.toThrow();
});
it("PNG encoding times out exactly at the deadline", async () => {
  vi.useFakeTimers();
  try {
    const canvas = { toBlob: () => {} } as unknown as HTMLCanvasElement;
    const result = new CanvasMediaCapture(canvas).screenshot();
    const check = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(9999);
    let settled = false;
    void result.catch(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await check;
  } finally {
    vi.useRealTimers();
  }
});
it("cleans up a recorder that never completes Stop at 10 seconds", async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    class Stalled extends Recorder {
      stop() {
        this.state = "inactive";
      }
    }
    vi.stubGlobal("MediaRecorder", Stalled);
    const recording = new CanvasMediaCapture(f.canvas).record(vi.fn());
    const result = recording.stop();
    const check = expect(result).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(9999);
    expect(f.track.stop).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await check;
    expect(f.track.stop).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});
