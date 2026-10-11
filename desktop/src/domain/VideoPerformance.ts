const limit = 256;
function append(values: number[], value: number) {
  values.push(value);
  if (values.length > limit) values.shift();
}
function percentile(values: number[]) {
  return (
    [...values].sort((a, b) => a - b)[
      Math.max(0, Math.ceil(values.length * 0.95) - 1)
    ] ?? 0
  );
}
export class VideoPerformance {
  private windowJitter: number[] = [];
  private windowDecode: number[] = [];
  private lastSourceTimestamp?: number;
  private pending = new Map<number, number>();
  private receivedCount = 0;
  private presentedCount = 0;
  private replacedCount = 0;
  private first?: number;
  private lastReceived?: number;
  private lastPresented?: number;
  private maxQueue = 0;
  private receiveGaps: number[] = [];
  private displayGaps: number[] = [];
  private decodeTimes: number[] = [];
  private paintTimes: number[] = [];
  received(timestamp: number, now: number, queue: number) {
    if (
      !Number.isFinite(timestamp) ||
      !Number.isFinite(now) ||
      !Number.isInteger(queue) ||
      queue < 0 ||
      now < (this.lastReceived ?? now)
    )
      return;
    if (
      this.lastReceived !== undefined &&
      this.lastSourceTimestamp !== undefined &&
      timestamp >= this.lastSourceTimestamp
    )
      append(
        this.windowJitter,
        Math.max(
          0,
          now -
            this.lastReceived -
            (timestamp - this.lastSourceTimestamp) / 1000,
        ),
      );
    this.lastSourceTimestamp = timestamp;
    if (this.first === undefined) this.first = now;
    if (this.lastReceived !== undefined)
      append(this.receiveGaps, now - this.lastReceived);
    this.lastReceived = now;
    this.receivedCount++;
    this.maxQueue = Math.max(this.maxQueue, queue);
    this.pending.set(timestamp, now);
    if (this.pending.size > 64)
      this.pending.delete(this.pending.keys().next().value!);
  }
  submitted(timestamp: number, now: number) {
    if (!Number.isFinite(timestamp) || !Number.isFinite(now)) return;
    this.pending.set(timestamp, now);
    if (this.pending.size > 64)
      this.pending.delete(this.pending.keys().next().value!);
  }
  decoded(timestamp: number, now: number) {
    const start = this.pending.get(timestamp);
    if (start === undefined || !Number.isFinite(now) || now < start) return;
    this.pending.delete(timestamp);
    append(this.decodeTimes, now - start);
    append(this.windowDecode, now - start);
  }
  presented(start: number, end: number) {
    if (
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      end < start ||
      start < (this.lastPresented ?? start)
    )
      return;
    if (this.lastPresented !== undefined)
      append(this.displayGaps, start - this.lastPresented);
    this.lastPresented = start;
    this.presentedCount++;
    append(this.paintTimes, end - start);
  }
  replaced() {
    this.replacedCount++;
  }
  resetDecoder() {
    this.pending.clear();
  }
  reset() {
    this.pending.clear();
    this.windowJitter = [];
    this.windowDecode = [];
    this.lastSourceTimestamp = undefined;
    this.receivedCount = 0;
    this.presentedCount = 0;
    this.replacedCount = 0;
    this.first = undefined;
    this.lastReceived = undefined;
    this.lastPresented = undefined;
    this.maxQueue = 0;
    this.receiveGaps = [];
    this.displayGaps = [];
    this.decodeTimes = [];
    this.paintTimes = [];
  }
  takeAdaptiveSample() {
    const sample = {
      samples: this.windowJitter.length,
      receiveJitterP95Ms: percentile(this.windowJitter),
      decodeP95Ms: percentile(this.windowDecode),
    };
    this.windowJitter = [];
    this.windowDecode = [];
    return sample;
  }
  snapshot(now: number) {
    const seconds =
      this.first === undefined || !Number.isFinite(now)
        ? 0
        : Math.max(0, (now - this.first) / 1000);
    return {
      received: this.receivedCount,
      presented: this.presentedCount,
      replaced: this.replacedCount,
      fps: seconds > 0 ? this.presentedCount / seconds : 0,
      receiveGapP95Ms: percentile(this.receiveGaps),
      displayGapP95Ms: percentile(this.displayGaps),
      displayGapMaxMs: Math.max(0, ...this.displayGaps),
      decodeP95Ms: percentile(this.decodeTimes),
      paintP95Ms: percentile(this.paintTimes),
      maxDecodeQueue: this.maxQueue,
      sampleCount: this.paintTimes.length,
    };
  }
}
export type VideoPerformanceSnapshot = ReturnType<VideoPerformance["snapshot"]>;
