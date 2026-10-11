export type VideoPacket =
  | { kind: "configuration"; data: Uint8Array }
  | { kind: "frame"; data: Uint8Array; timestamp: number; keyFrame: boolean };
export function parseVideoPacket(buffer: ArrayBuffer): VideoPacket {
  if (buffer.byteLength < 12) throw new Error("영상 헤더가 잘렸습니다.");
  const view = new DataView(buffer),
    flags = view.getBigUint64(0),
    size = view.getUint32(8);
  const timestamp = flags & ((1n << 61n) - 1n);
  if (
    flags & (1n << 63n) ||
    !size ||
    size > 16 * 1024 * 1024 ||
    buffer.byteLength !== 12 + size ||
    timestamp > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new Error("잘못된 영상 패킷입니다.");
  const data = new Uint8Array(buffer, 12);
  if (flags & (1n << 62n)) return { kind: "configuration", data };
  return {
    kind: "frame",
    data,
    timestamp: Number(timestamp),
    keyFrame: Boolean(flags & (1n << 61n)),
  };
}
export function codecFromConfiguration(bytes: Uint8Array): string {
  for (let i = 0; i + 6 < bytes.length; i++) {
    if (bytes[i] !== 0 || bytes[i + 1] !== 0) continue;
    const start =
      bytes[i + 2] === 1
        ? i + 3
        : bytes[i + 2] === 0 && bytes[i + 3] === 1
          ? i + 4
          : -1;
    if (start >= 0 && start + 3 < bytes.length && (bytes[start] & 0x1f) === 7) {
      return (
        "avc1." +
        Array.from(bytes.subarray(start + 1, start + 4), (byte) =>
          byte.toString(16).padStart(2, "0"),
        ).join("")
      );
    }
  }
  throw new Error("H.264 영상 설정에 SPS가 없습니다.");
}
