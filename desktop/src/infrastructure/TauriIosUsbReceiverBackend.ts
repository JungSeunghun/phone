import { invoke } from "@tauri-apps/api/core";
import type {
  IosReceiverBackend,
  IosReceiverInfo,
} from "../application/IosReceiverController";
export class TauriIosUsbReceiverBackend implements IosReceiverBackend {
  start() {
    return invoke<IosReceiverInfo>("start_ios_usb_receiver");
  }
  stop(receiverId: string) {
    return invoke<void>("stop_ios_usb_receiver", { receiverId });
  }
}
