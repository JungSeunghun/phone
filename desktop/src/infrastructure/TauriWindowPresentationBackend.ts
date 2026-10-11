import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  WindowPresentationBackend,
  WindowViewMode,
  VideoDimensions,
} from "../domain/WindowPresentation";
export class TauriWindowPresentationBackend implements WindowPresentationBackend {
  setMode(mode: WindowViewMode, dimensions?: VideoDimensions) {
    return invoke<WindowViewMode>("set_window_view_mode", {
      mode,
      dimensions: dimensions ? [dimensions.width, dimensions.height] : null,
    });
  }
  subscribe(listener: (mode: WindowViewMode) => void) {
    return listen<WindowViewMode>("window-view-mode", (event) =>
      listener(event.payload),
    );
  }
}
