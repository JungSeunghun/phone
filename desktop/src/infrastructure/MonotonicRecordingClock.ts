import type { RecordingClock } from "../domain/RecordingTime";
export class MonotonicRecordingClock implements RecordingClock {
  now() {
    return performance.now();
  }
  repeat(callback: () => void, milliseconds: number) {
    const timer = setInterval(callback, milliseconds);
    return () => clearInterval(timer);
  }
}
