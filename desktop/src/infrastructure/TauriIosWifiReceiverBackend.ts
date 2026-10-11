import { invoke } from "@tauri-apps/api/core";
import type {
  IosWifiReceiverBackend,
  IosWifiReceiverInfo,
} from "../application/IosWifiReceiverController";
export class TauriIosWifiReceiverBackend implements IosWifiReceiverBackend {
  start() {
    return invoke<IosWifiReceiverInfo>("start_ios_wifi_receiver");
  }
  stop(receiverId: string) {
    return invoke<void>("stop_ios_wifi_receiver", { receiverId });
  }
}
