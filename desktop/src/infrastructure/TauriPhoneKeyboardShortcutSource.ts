import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { PhoneKeyboardShortcutSource } from "../application/PhoneKeyboardShortcutSource";

export class TauriPhoneKeyboardShortcutSource implements PhoneKeyboardShortcutSource {
  private available = false;
  async subscribe(listener: (generation: number) => void) {
    if (!isTauri()) return { handlesShortcuts: false, dispose() {} };
    this.available = await invoke<boolean>(
      "phone_keyboard_shortcuts_available",
    );
    if (!this.available) return { handlesShortcuts: false, dispose() {} };
    const dispose = await listen<{ generation: number }>(
      "phone-keyboard-language-switch",
      (event) => listener(event.payload.generation),
    );
    return { handlesShortcuts: true, dispose };
  }
  async setFocus(generation: number, active: boolean) {
    if (this.available)
      await invoke("set_phone_keyboard_shortcut_focus", { generation, active });
  }
}
