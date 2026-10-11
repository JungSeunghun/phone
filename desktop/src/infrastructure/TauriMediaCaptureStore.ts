import { invoke } from "@tauri-apps/api/core";
import type {
  CapturedMedia,
  MediaCaptureStore,
} from "../application/MediaCaptureController";
export class TauriMediaCaptureStore implements MediaCaptureStore {
  async save(blob: CapturedMedia): Promise<string | null> {
    if (!(blob instanceof Blob))
      return invoke("save_native_recording", {
        recordingId: blob.nativeRecordingId,
      });
    const format =
      blob.type === "image/png"
        ? "png"
        : blob.type.startsWith("video/mp4")
          ? "mp4"
          : blob.type.startsWith("video/webm")
            ? "webm"
            : undefined;
    if (!format) throw Error("Unsupported media");
    return invoke(
      "save_media_capture",
      new Uint8Array(await blob.arrayBuffer()),
      { headers: { "x-media-format": format } },
    );
  }
}
