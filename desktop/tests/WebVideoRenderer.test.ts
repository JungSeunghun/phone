import { afterEach, beforeEach, it, expect, vi } from "vitest";
import { WebVideoRenderer } from "../src/infrastructure/WebVideoRenderer";
const decoders: FakeDecoder[] = [];
const scheduled = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
function paint() {
  const callbacks = [...scheduled.values()];
  scheduled.clear();
  callbacks.forEach((callback) => callback(0));
}
class FakeDecoder {
  state = "unconfigured";
  decodeQueueSize = 0;
  configure = vi.fn(() => {
    this.state = "configured";
  });
  decode = vi.fn();
  close = vi.fn(() => {
    this.state = "closed";
  });
  constructor(public callbacks: VideoDecoderInit) {
    decoders.push(this);
  }
}
function packet(flags: bigint, bytes: number[]) {
  const data = new Uint8Array(12 + bytes.length);
  const view = new DataView(data.buffer);
  view.setBigUint64(0, flags);
  view.setUint32(8, bytes.length);
  data.set(bytes, 12);
  return data.buffer;
}
const configuration = packet(
  1n << 62n,
  [0, 0, 0, 1, 0x67, 0x64, 0, 0x28, 1, 0, 0, 0, 1, 0x68, 1],
);
beforeEach(() => {
  decoders.length = 0;
  scheduled.clear();
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextFrame;
    scheduled.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => scheduled.delete(id));
  vi.stubGlobal("VideoDecoder", FakeDecoder);
  vi.stubGlobal(
    "EncodedVideoChunk",
    class {
      constructor(public options: EncodedVideoChunkInit) {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
it("prepends parameter sets to key frames and reports live only after painting a decoded frame", () => {
  const canvas = document.createElement("canvas"),
    rendered = vi.fn(),
    error = vi.fn();
  const renderer = new WebVideoRenderer(canvas, rendered, error);
  renderer.write(configuration);
  renderer.write(packet(1n << 61n, [0, 0, 0, 1, 0x65, 1]));
  expect(decoders[0].configure).toHaveBeenCalledWith({
    codec: "avc1.640028",
    optimizeForLatency: true,
    hardwareAcceleration: "no-preference",
  });
  expect(rendered).not.toHaveBeenCalled();
  const frame = { displayWidth: 886, displayHeight: 1920, close: vi.fn() };
  decoders[0].callbacks.output(frame as unknown as VideoFrame);
  expect(rendered).not.toHaveBeenCalled();
  paint();
  expect(canvas.width).toBe(886);
  expect(canvas.height).toBe(1920);
  expect(rendered).toHaveBeenCalledWith(886, 1920);
  expect(frame.close).toHaveBeenCalledOnce();
  renderer.close();
  expect(decoders[0].close).toHaveBeenCalledOnce();
});
it("closes late decoded frames without displaying them after stop", () => {
  const renderer = new WebVideoRenderer(
    document.createElement("canvas"),
    vi.fn(),
    vi.fn(),
  );
  renderer.write(configuration);
  const old = decoders[0];
  renderer.reset();
  const frame = { close: vi.fn() };
  old.callbacks.output(frame as unknown as VideoFrame);
  expect(frame.close).toHaveBeenCalledOnce();
  expect(() => renderer.write(packet(1n << 61n, [1]))).toThrow();
});
it("limits decoder backlog and waits for a key frame after resetting references", () => {
  const renderer = new WebVideoRenderer(
    document.createElement("canvas"),
    vi.fn(),
    vi.fn(),
  );
  renderer.write(configuration);
  renderer.write(packet(1n << 61n, [1]));
  decoders[0].decodeQueueSize = 13;
  renderer.write(packet(1n, [1]));
  expect(decoders).toHaveLength(2);
  expect(decoders[1].decode).not.toHaveBeenCalled();
  renderer.write(packet((1n << 61n) | 2n, [1]));
  expect(decoders[1].decode).toHaveBeenCalledOnce();
  renderer.close();
});
it("shows an actionable error when the platform lacks WebCodecs", () => {
  vi.stubGlobal("VideoDecoder", undefined);
  const renderer = new WebVideoRenderer(
    document.createElement("canvas"),
    vi.fn(),
    vi.fn(),
  );
  expect(() => renderer.write(configuration)).toThrow("디코더");
});
it("rejects invalid decoded dimensions before resizing the canvas", () => {
  for (const width of [0, -1, 8193, NaN, 1.5]) {
    const canvas = document.createElement("canvas"),
      rendered = vi.fn(),
      error = vi.fn();
    canvas.width = 1;
    canvas.height = 1;
    const renderer = new WebVideoRenderer(canvas, rendered, error);
    renderer.write(configuration);
    const frame = { displayWidth: width, displayHeight: 100, close: vi.fn() };
    decoders.at(-1)!.callbacks.output(frame as unknown as VideoFrame);
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(rendered).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
    expect(frame.close).toHaveBeenCalledOnce();
    renderer.close();
  }
});

it("keeps references at the queue boundary and discards old output after overload", () => {
  const rendered = vi.fn();
  const renderer = new WebVideoRenderer(
    document.createElement("canvas"),
    rendered,
    vi.fn(),
  );
  renderer.write(configuration);
  renderer.write(packet(1n << 61n, [1]));
  const old = decoders[0];
  old.decodeQueueSize = 12;
  renderer.write(packet(1n, [1]));
  expect(decoders).toHaveLength(1);
  old.decodeQueueSize = 13;
  renderer.write(packet(2n, [1]));
  const late = { displayWidth: 100, displayHeight: 100, close: vi.fn() };
  old.callbacks.output(late as unknown as VideoFrame);
  expect(rendered).not.toHaveBeenCalled();
  expect(late.close).toHaveBeenCalledOnce();
  renderer.write(packet(3n, [1]));
  expect(decoders[1].decode).not.toHaveBeenCalled();
  renderer.write(packet((1n << 61n) | 4n, [1]));
  expect(decoders[1].decode).toHaveBeenCalledOnce();
  renderer.close();
});

it("holds only the newest decoded frame and paints once per display refresh", () => {
  const rendered = vi.fn(),
    renderer = new WebVideoRenderer(
      document.createElement("canvas"),
      rendered,
      vi.fn(),
    );
  renderer.write(configuration);
  const first = {
    timestamp: 0,
    displayWidth: 100,
    displayHeight: 200,
    close: vi.fn(),
  };
  const latest = {
    timestamp: 1,
    displayWidth: 200,
    displayHeight: 100,
    close: vi.fn(),
  };
  decoders[0].callbacks.output(first as unknown as VideoFrame);
  decoders[0].callbacks.output(latest as unknown as VideoFrame);
  expect(first.close).toHaveBeenCalledOnce();
  expect(latest.close).not.toHaveBeenCalled();
  expect(scheduled.size).toBe(1);
  expect(rendered).not.toHaveBeenCalled();
  paint();
  expect(rendered).toHaveBeenCalledExactlyOnceWith(200, 100);
  expect(latest.close).toHaveBeenCalledOnce();
  expect(renderer.getPerformance().replaced).toBe(1);
  renderer.close();
});
it("cancels pending presentation and ignores a late animation callback after reset", () => {
  const rendered = vi.fn(),
    renderer = new WebVideoRenderer(
      document.createElement("canvas"),
      rendered,
      vi.fn(),
    );
  renderer.write(configuration);
  const frame = {
    timestamp: 0,
    displayWidth: 100,
    displayHeight: 200,
    close: vi.fn(),
  };
  decoders[0].callbacks.output(frame as unknown as VideoFrame);
  const late = [...scheduled.values()][0];
  renderer.reset();
  expect(scheduled.size).toBe(0);
  expect(frame.close).toHaveBeenCalledOnce();
  renderer.write(configuration);
  late(0);
  expect(rendered).not.toHaveBeenCalled();
  renderer.close();
});
