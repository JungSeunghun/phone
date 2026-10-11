import { invoke } from "@tauri-apps/api/core";
import type {
  AndroidQrPairingBackend,
  AndroidQrPairingInfo,
} from "../application/AndroidQrPairingController";
export class TauriAndroidQrPairingBackend implements AndroidQrPairingBackend {
  start(): Promise<AndroidQrPairingInfo> {
    return invoke("start_android_qr_pairing");
  }
  wait(sessionId: string): Promise<{ address: string }> {
    return invoke("wait_android_qr_pairing", { sessionId });
  }
  cancel(sessionId: string): Promise<void> {
    return invoke("cancel_android_qr_pairing", { sessionId });
  }
}
