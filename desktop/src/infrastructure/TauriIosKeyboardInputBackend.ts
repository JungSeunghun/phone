import { invoke } from "@tauri-apps/api/core";
import type { IosKeyboardInputBackend } from "../application/IosKeyboardInputController";
import type { ControlInput } from "../domain/PhoneInput";
export class TauriIosKeyboardInputBackend implements IosKeyboardInputBackend {
  start(targetId: string) {
    return invoke<{ receiverId: string; codes: string[] }>(
      "start_ios_keyboard_input",
      { targetId },
    );
  }
  status(receiverId: string) {
    return invoke<{ connected: boolean; generation: string }>(
      "ios_keyboard_input_status",
      { receiverId },
    );
  }
  stop(receiverId: string) {
    return invoke<void>("stop_ios_keyboard_input", { receiverId });
  }
  send(receiverId: string, input: ControlInput, generation: string) {
    return invoke<void>("send_ios_keyboard_input", {
      receiverId,
      input,
      generation,
    });
  }
}
