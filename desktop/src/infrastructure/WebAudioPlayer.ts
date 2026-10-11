import type { AudioSink, AudioPlaybackStatus } from "../domain/PhoneMirror";
export function decodePcmPacket(
  packet: ArrayBuffer,
): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  if (packet.byteLength < 16 || packet.byteLength > 4108)
    throw Error("Invalid audio size");
  const view = new DataView(packet),
    size = view.getUint32(8);
  if (
    size !== packet.byteLength - 12 ||
    size % 4 !== 0 ||
    (view.getUint8(0) & 0xe0) !== 0
  )
    throw Error("Invalid PCM packet");
  const left = new Float32Array(size / 4),
    right = new Float32Array(size / 4);
  for (let i = 0; i < left.length; i++) {
    left[i] = view.getInt16(12 + i * 4, true) / 32768;
    right[i] = view.getInt16(14 + i * 4, true) / 32768;
  }
  return [left, right];
}
export class WebAudioPlayer implements AudioSink {
  private context?: AudioContext;
  private gain?: GainNode;
  private sources = new Set<AudioBufferSourceNode>();
  private nextTime = 0;
  private muted = false;
  constructor(
    private onStatus: (message: string, status: AudioPlaybackStatus) => void,
  ) {}
  async prepare() {
    this.context ??= new AudioContext({
      sampleRate: 48000,
      latencyHint: "interactive",
    });
    if (!this.gain) {
      this.gain = this.context.createGain();
      this.gain.connect(this.context.destination);
      this.gain.gain.value = this.muted ? 0 : 1;
    }
    await this.context.resume();
    this.onStatus(
      this.context.state === "running"
        ? "컴퓨터 소리 재생 준비"
        : "소리 재생 버튼을 눌러주세요.",
      this.context.state === "running" ? "ready" : "blocked",
    );
  }
  setMuted(muted: boolean) {
    this.muted = muted;
    if (this.gain) this.gain.gain.value = muted ? 0 : 1;
  }
  write(packet: ArrayBuffer) {
    const channels = decodePcmPacket(packet),
      context = this.context;
    if (!context || context.state !== "running") return;
    if (this.nextTime - context.currentTime > 0.15) this.reset();
    const buffer = context.createBuffer(2, channels[0].length, 48000);
    buffer.copyToChannel(channels[0], 0);
    buffer.copyToChannel(channels[1], 1);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain!);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      source.disconnect();
    };
    this.nextTime = Math.max(context.currentTime + 0.025, this.nextTime);
    source.start(this.nextTime);
    this.nextTime += buffer.duration;
    this.onStatus("컴퓨터에서 폰 소리 재생 중", "playing");
  }
  reset() {
    for (const source of this.sources) {
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
    this.sources.clear();
    this.nextTime = 0;
  }
  close() {
    this.reset();
    void this.context?.close();
    this.context = undefined;
    this.gain = undefined;
  }
}
