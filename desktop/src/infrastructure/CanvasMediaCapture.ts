import type { MediaCaptureSource } from "../application/MediaCaptureController";
export const recordingByteLimit = 256 * 1024 * 1024;
export function recordingMimeType(
  supported: (type: string) => boolean,
): string {
  const type = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4",
    "video/webm;codecs=vp8",
    "video/webm",
  ].find(supported);
  if (!type) throw Error("No supported recorder");
  return type;
}
export class CanvasMediaCapture implements MediaCaptureSource {
  constructor(private canvas: HTMLCanvasElement) {}
  screenshot(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("PNG encoding timed out")),
        10000,
      );
      try {
        this.canvas.toBlob((blob) => {
          clearTimeout(timer);
          blob ? resolve(blob) : reject(Error("PNG encoding failed"));
        }, "image/png");
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  record(onLimit: () => void) {
    const mimeType = recordingMimeType((type) =>
      MediaRecorder.isTypeSupported(type),
    );
    const stream = this.canvas.captureStream(30);
    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: 8_000_000,
      });
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    const chunks: Blob[] = [];
    let size = 0,
      failed = false,
      stopped = false,
      limitReached = false;
    let resolve!: (value: Blob) => void, reject!: (reason: Error) => void;
    const result = new Promise<Blob>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // Attach a handler immediately, including before the user requests Stop.
    void result.catch(() => {});
    let stopTimer: ReturnType<typeof setTimeout> | undefined;
    let tracksClosed = false;
    const closeTracks = () => {
      if (!tracksClosed) {
        tracksClosed = true;
        stream.getTracks().forEach((track) => track.stop());
      }
    };
    const stop = () => {
      if (!stopped) {
        stopped = true;
        stopTimer = setTimeout(() => {
          failed = true;
          closeTracks();
          reject(Error("Recording finalization timed out"));
        }, 10000);
        if (recorder.state !== "inactive") recorder.stop();
      }
      return result;
    };
    recorder.ondataavailable = (event) => {
      if (size + event.data.size > recordingByteLimit) {
        failed = true;
        void stop();
        onLimit();
        return;
      }
      if (event.data.size) {
        chunks.push(event.data);
        size += event.data.size;
      }
      if (size >= recordingByteLimit - 8 * 1024 * 1024 && !limitReached) {
        limitReached = true;
        void stop();
        onLimit();
      }
    };
    recorder.onerror = () => {
      failed = true;
      void stop();
      onLimit();
    };
    recorder.onstop = () => {
      stopped = true;
      clearTimeout(stopTimer);
      closeTracks();
      if (failed || !size) reject(Error("Recording failed or exceeded limit"));
      else resolve(new Blob(chunks, { type: recorder.mimeType }));
    };
    try {
      recorder.start(1000);
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    return {
      stop,
      pause: async () => {
        if (stopped) throw Error("Recording stopped");
        if (recorder.state === "recording") recorder.pause();
      },
      resume: async () => {
        if (stopped) throw Error("Recording stopped");
        if (recorder.state === "paused") recorder.resume();
      },
    };
  }
}
