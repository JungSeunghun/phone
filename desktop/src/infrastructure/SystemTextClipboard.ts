import { invoke, isTauri } from "@tauri-apps/api/core";
import type { TextClipboard } from "../application/TextInputController";
export class SystemTextClipboard implements TextClipboard {
  readText(): Promise<string> {
    return isTauri()
      ? invoke<string>("read_clipboard_text")
      : navigator.clipboard.readText();
  }
}
