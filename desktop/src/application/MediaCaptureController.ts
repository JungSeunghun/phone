import type { RecordingClock } from "../domain/RecordingTime";
import { MonotonicRecordingClock } from "../infrastructure/MonotonicRecordingClock";
export type CapturedMedia = Blob | { nativeRecordingId: string };
export interface Recording {
  stop(): Promise<CapturedMedia>;
  pause?(): Promise<void>;
  resume?(): Promise<void>;
  includesAudio?: boolean;
}
export interface MediaCaptureSource {
  screenshot(): Promise<Blob>;
  record(onLimit: () => void): Recording;
}
export interface MediaCaptureStore {
  save(blob: CapturedMedia): Promise<string | null>;
}
export class MediaCaptureController {
  private snapshot = {
    live: false,
    recording: false,
    paused: false,
    pauseBusy: false,
    elapsedSeconds: 0,
    busy: false,
    message: "",
  };
  private listeners = new Set<() => void>();
  private recording?: Recording;
  private finalizing?: Promise<void>;
  private screenshotTask?: Promise<void>;
  private cancelRecordingClock?: () => void;
  private refreshRecordingTime?: () => void;
  private recordingGeneration = 0;
  private pausedAt?: number;
  private pausedMilliseconds = 0;
  constructor(
    private source: MediaCaptureSource,
    private store: MediaCaptureStore,
    private clock: RecordingClock = new MonotonicRecordingClock(),
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private update(change: Partial<typeof this.snapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((listener) => listener());
  }
  setLive(live: boolean) {
    this.update({ live });
    if (!live) void this.stopRecording();
  }
  screenshot(): Promise<void> {
    if (!this.snapshot.live || this.snapshot.busy || this.recording)
      return Promise.resolve();
    this.update({ busy: true, message: "스크린샷을 저장하고 있습니다." });
    this.screenshotTask = (async () => {
      try {
        await this.save(await this.source.screenshot());
      } catch {
        this.update({ message: "스크린샷 저장에 실패했습니다." });
      } finally {
        this.screenshotTask = undefined;
        this.update({ busy: false });
      }
    })();
    return this.screenshotTask;
  }
  async finish(): Promise<void> {
    this.setLive(false);
    await Promise.all([this.screenshotTask, this.stopRecording()]);
  }
  startRecording() {
    if (!this.snapshot.live || this.snapshot.busy || this.recording) return;
    try {
      const startedAt = this.clock.now();
      if (!Number.isFinite(startedAt)) throw Error("Invalid recording clock");
      const generation = ++this.recordingGeneration;
      this.pausedAt = undefined;
      this.pausedMilliseconds = 0;
      this.recording = this.source.record(() => {
        if (generation === this.recordingGeneration) void this.stopRecording();
      });
      this.update({
        recording: true,
        elapsedSeconds: 0,
        paused: false,
        pauseBusy: false,
        message: this.recording.includesAudio
          ? "녹화 중 · 수신된 앱 소리도 저장합니다."
          : "녹화 중 · 영상만 저장합니다.",
      });
      this.refreshRecordingTime = () => {
        if (!this.recording || generation !== this.recordingGeneration) return;
        const elapsed = Math.floor(
          ((this.pausedAt ?? this.clock.now()) -
            startedAt -
            this.pausedMilliseconds) /
            1000,
        );
        if (Number.isFinite(elapsed) && elapsed > this.snapshot.elapsedSeconds)
          this.update({ elapsedSeconds: Math.min(elapsed, 359999) });
      };
      this.cancelRecordingClock = this.clock.repeat(
        this.refreshRecordingTime,
        1000,
      );
    } catch {
      this.update({ message: "이 환경에서 화면 녹화를 시작할 수 없습니다." });
    }
  }
  pauseRecording(): Promise<void> {
    return this.changePaused(true);
  }
  resumeRecording(): Promise<void> {
    return this.changePaused(false);
  }
  private async changePaused(paused: boolean): Promise<void> {
    const recording = this.recording,
      generation = this.recordingGeneration;
    if (
      !recording ||
      this.snapshot.pauseBusy ||
      this.snapshot.paused === paused
    )
      return;
    const action = paused ? recording.pause : recording.resume;
    if (!action) {
      this.update({ message: "이 녹화 방식은 일시 정지를 지원하지 않습니다." });
      return;
    }
    this.update({ pauseBusy: true });
    try {
      await action.call(recording);
      if (
        generation !== this.recordingGeneration ||
        this.recording !== recording
      )
        return;
      const now = this.clock.now();
      if (!Number.isFinite(now)) throw Error("Invalid recording clock");
      if (paused) {
        this.pausedAt = now;
        this.refreshRecordingTime?.();
      } else {
        this.pausedMilliseconds += Math.max(0, now - (this.pausedAt ?? now));
        this.pausedAt = undefined;
      }
      this.update({
        paused,
        message: paused
          ? "녹화 일시 정지 · 화면과 소리 보기는 계속됩니다."
          : "녹화를 재개했습니다.",
      });
    } catch {
      if (generation === this.recordingGeneration)
        this.update({
          message: paused
            ? "녹화를 일시 정지할 수 없습니다."
            : "녹화를 재개할 수 없습니다.",
        });
    } finally {
      if (generation === this.recordingGeneration)
        this.update({ pauseBusy: false });
    }
  }
  stopRecording(): Promise<void> {
    if (this.finalizing) return this.finalizing;
    const recording = this.recording;
    if (!recording) return Promise.resolve();
    this.refreshRecordingTime?.();
    this.refreshRecordingTime = undefined;
    this.recording = undefined;
    this.recordingGeneration++;
    this.cancelRecordingClock?.();
    this.cancelRecordingClock = undefined;
    this.update({
      recording: false,
      paused: false,
      pauseBusy: false,
      busy: true,
      message: "녹화를 마무리하고 있습니다.",
    });
    this.finalizing = (async () => {
      try {
        await this.save(await recording.stop());
      } catch {
        this.update({ message: "녹화 저장에 실패했습니다." });
      } finally {
        this.finalizing = undefined;
        this.update({ busy: false });
      }
    })();
    return this.finalizing;
  }
  private async save(blob: CapturedMedia) {
    if (
      blob instanceof Blob &&
      (blob.size === 0 || blob.size > 256 * 1024 * 1024)
    )
      throw Error("Invalid media size");
    const path = await this.store.save(blob);
    this.update({
      message: path ? `저장했습니다: ${path}` : "저장을 취소했습니다.",
    });
  }
}
