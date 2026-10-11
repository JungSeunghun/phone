import { invoke } from "@tauri-apps/api/core";
import type { NativeRecordingBackend } from "./NativeMediaCapture";
export class TauriNativeRecordingBackend implements NativeRecordingBackend {
  start(
    context: Parameters<NativeRecordingBackend["start"]>[0],
  ): Promise<string> {
    return invoke("start_native_recording", context);
  }
  finish(
    sessionId: string,
    recordingId: string,
  ): Promise<{ nativeRecordingId: string }> {
    return invoke<string>("finish_native_recording", {
      sessionId,
      recordingId,
    }).then((nativeRecordingId) => ({ nativeRecordingId }));
  }
  pause(sessionId: string, recordingId: string): Promise<void> {
    return invoke("set_native_recording_paused", {
      sessionId,
      recordingId,
      paused: true,
    });
  }
  resume(sessionId: string, recordingId: string): Promise<void> {
    return invoke("set_native_recording_paused", {
      sessionId,
      recordingId,
      paused: false,
    });
  }
  status(sessionId: string, recordingId: string): Promise<boolean> {
    return invoke("native_recording_running", { sessionId, recordingId });
  }
}
