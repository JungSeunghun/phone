import { it, expect } from "vitest";
import { decodePcmPacket } from "../src/infrastructure/WebAudioPlayer";
it("decodes signed stereo PCM boundaries and rejects invalid headers", () => {
  const packet = new ArrayBuffer(20);
  const view = new DataView(packet);
  view.setUint32(8, 8);
  view.setInt16(12, -32768, true);
  view.setInt16(14, 32767, true);
  view.setInt16(16, 0, true);
  view.setInt16(18, -1, true);
  const channels = decodePcmPacket(packet);
  expect(channels[0][0]).toBe(-1);
  expect(channels[1][0]).toBeCloseTo(1, 4);
  expect(channels[0][1]).toBe(0);
  expect(() => decodePcmPacket(packet.slice(0, 19))).toThrow();
  view.setUint32(8, 7);
  expect(() => decodePcmPacket(packet)).toThrow();
});
it("bounds queued audio, supports mute and releases scheduled sources on disconnect", async () => {
  const { vi } = await import("vitest");
  const { WebAudioPlayer } =
    await import("../src/infrastructure/WebAudioPlayer");
  const sources: {
    stop: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    buffer?: unknown;
    onended?: () => void;
  }[] = [];
  const gain = { gain: { value: 1 }, connect: vi.fn() };
  const context = {
    currentTime: 0,
    state: "running",
    destination: {},
    resume: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
    createGain: () => gain,
    createBuffer: (_c: number, n: number, rate: number) => ({
      duration: n / rate,
      copyToChannel: vi.fn(),
    }),
    createBufferSource: () => {
      const source = {
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        disconnect: vi.fn(),
      };
      sources.push(source);
      return source;
    },
  };
  vi.stubGlobal(
    "AudioContext",
    vi.fn(function () {
      return context;
    }),
  );
  try {
    const player = new WebAudioPlayer(vi.fn());
    await player.prepare();
    player.setMuted(true);
    expect(gain.gain.value).toBe(0);
    const packet = new ArrayBuffer(4108);
    new DataView(packet).setUint32(8, 4096);
    for (let n = 0; n < 20; n++) player.write(packet);
    expect(sources.some((source) => source.stop.mock.calls.length > 0)).toBe(
      true,
    );
    player.setMuted(false);
    expect(gain.gain.value).toBe(1);
    player.reset();
    expect(sources.every((source) => source.stop.mock.calls.length === 1)).toBe(
      true,
    );
    player.close();
    expect(context.close).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
