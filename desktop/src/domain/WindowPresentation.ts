export type WindowViewMode = "normal" | "fullscreen" | "pip";
export interface VideoDimensions {
  width: number;
  height: number;
}
export interface WindowPresentationBackend {
  setMode(
    mode: WindowViewMode,
    dimensions?: VideoDimensions,
  ): Promise<WindowViewMode>;
  subscribe?(listener: (mode: WindowViewMode) => void): Promise<() => void>;
}
