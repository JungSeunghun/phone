import { describe, it, expect } from "vitest";
import {
  parseVideoPacket,
  codecFromConfiguration,
} from "../src/domain/VideoPacket";

function packet(flags: bigint, data: number[]) {
  const result = new Uint8Array(12 + data.length);
  const view = new DataView(result.buffer);
  view.setBigUint64(0, flags);
  view.setUint32(8, data.length);
  result.set(data, 12);
  return result.buffer;
}
describe("compressed video packet boundaries", () => {
  it("preserves timestamps and key/config flags without converting frames to images", () => {
    expect(parseVideoPacket(packet((1n << 62n) | 123n, [1]))).toMatchObject({
      kind: "configuration",
    });
    expect(parseVideoPacket(packet((1n << 61n) | 123n, [1]))).toMatchObject({
      kind: "frame",
      keyFrame: true,
      timestamp: 123,
    });
    expect(parseVideoPacket(packet(456n, [1]))).toMatchObject({
      kind: "frame",
      keyFrame: false,
      timestamp: 456,
    });
  });
  it("rejects truncated, empty, oversized, mismatched packets and unsafe timestamps", () => {
    for (const data of [
      new ArrayBuffer(0),
      new ArrayBuffer(11),
      packet(1n, []),
      packet(1n << 60n, [1]),
    ]) {
      expect(() => parseVideoPacket(data)).toThrow();
    }
    const oversized = packet(0n, [1]);
    new DataView(oversized).setUint32(8, 16 * 1024 * 1024 + 1);
    expect(() => parseVideoPacket(oversized)).toThrow();
    const mismatch = packet(0n, [1]);
    new DataView(mismatch).setUint32(8, 2);
    expect(() => parseVideoPacket(mismatch)).toThrow();
  });
  it("extracts AVC codec from three/four-byte Annex B SPS and rejects missing SPS", () => {
    expect(
      codecFromConfiguration(
        new Uint8Array([0, 0, 0, 1, 0x67, 0x64, 0, 0x28, 1]),
      ),
    ).toBe("avc1.640028");
    expect(
      codecFromConfiguration(
        new Uint8Array([0, 0, 1, 0x67, 0x42, 0x80, 0x1f, 1]),
      ),
    ).toBe("avc1.42801f");
    expect(() =>
      codecFromConfiguration(new Uint8Array([0, 0, 1, 0x68, 1])),
    ).toThrow();
  });
});
