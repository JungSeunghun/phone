import type {
  CapturedMedia,
  MediaCaptureSource,
  Recording,
} from "../application/MediaCaptureController";
export interface NativeRecordingBackend {
  start(context: {
    sessionId: string;
    width: number;
    height: number;
    fps: number;
    includeAudio?: boolean;
  }): Promise<string>;
  finish(
    sessionId: string,
    recordingId: string,
  ): Promise<{ nativeRecordingId: string }>;
  status(sessionId: string, recordingId: string): Promise<boolean>;
  pause?(sessionId: string, recordingId: string): Promise<void>;
  resume?(sessionId: string, recordingId: string): Promise<void>;
}
export class NativeMediaCapture implements MediaCaptureSource {
  constructor(
    private backend: NativeRecordingBackend,
    private context: () =>
      | {
          sessionId: string;
          width: number;
          height: number;
          fps: number;
          includeAudio?: boolean;
        }
      | undefined,
    private captureScreenshot: () => Promise<Blob>,
  ) {}
  screenshot() {
    return this.captureScreenshot();
  }
  record(onLimit: () => void): Recording {
    const context = this.context();
    if (!context) throw Error("No active native recording session");
    let stopped = false,
      notified = false,
      finishing: Promise<CapturedMedia> | undefined;
    const notify = () => {
      if (!stopped && !notified) {
        notified = true;
        onLimit();
      }
    };
    const ready = this.backend.start(context);
    void ready.catch(notify);
    let polling = false;
    const timer = setInterval(() => {
      if (polling || stopped) return;
      polling = true;
      void ready
        .then((id) => this.backend.status(context.sessionId, id))
        .then((running) => {
          if (!running) notify();
        }, notify)
        .finally(() => {
          polling = false;
        });
    }, 1000);
    const changePaused = async (paused: boolean) => {
      if (stopped) throw Error("Recording stopped");
      const id = await ready;
      if (stopped) throw Error("Recording stopped");
      const action = paused ? this.backend.pause : this.backend.resume;
      if (!action) throw Error("Pause unavailable");
      await action.call(this.backend, context.sessionId, id);
    };
    return {
      includesAudio: context.includeAudio === true,
      pause: () => changePaused(true),
      resume: () => changePaused(false),
      stop: () => {
        if (!finishing) {
          stopped = true;
          clearInterval(timer);
          finishing = ready.then((id) =>
            this.backend.finish(context.sessionId, id),
          );
        }
        return finishing;
      },
    };
  }
}
