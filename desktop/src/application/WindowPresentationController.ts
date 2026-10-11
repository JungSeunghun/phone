import type {
  WindowPresentationBackend,
  WindowViewMode,
  VideoDimensions,
} from "../domain/WindowPresentation";
export class WindowPresentationController {
  private state = {
    mode: "normal" as WindowViewMode,
    busy: false,
    live: false,
    message: "",
  };
  private dimensions?: VideoDimensions;
  private listeners = new Set<() => void>();
  private disposed = false;
  private nativeRevision = 0;
  private restoreRequested = false;
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  constructor(private backend: WindowPresentationBackend) {}
  private update(patch: Partial<typeof this.state>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  setLive(live: boolean, dimensions?: VideoDimensions) {
    const valid =
      dimensions &&
      [dimensions.width, dimensions.height].every(
        (v) => Number.isInteger(v) && v >= 1 && v <= 8192,
      );
    this.dimensions = valid ? dimensions : undefined;
    live = live && Boolean(valid);
    if (this.state.live !== live) this.update({ live });
    if (!live && (this.state.busy || this.state.mode !== "normal"))
      void this.setMode("normal");
  }
  nativeError(message: string) {
    if (!this.disposed) this.update({ message });
  }
  nativeModeChanged(mode: WindowViewMode) {
    if (!this.disposed) {
      this.nativeRevision++;
      this.update({ mode });
      if (!this.state.live && mode !== "normal") void this.setMode("normal");
    }
  }
  async setMode(mode: WindowViewMode): Promise<void> {
    if (this.disposed || (mode !== "normal" && !this.state.live)) return;
    if (this.state.busy) {
      if (mode === "normal") this.restoreRequested = true;
      return;
    }
    if (mode === this.state.mode) return;
    const revision = this.nativeRevision;
    this.update({ busy: true, message: "" });
    try {
      const actual = await this.backend.setMode(
        mode,
        mode === "pip" ? this.dimensions : undefined,
      );
      if (!this.disposed && revision === this.nativeRevision)
        this.update({ mode: actual });
    } catch (error) {
      if (!this.disposed)
        this.update({
          message: error instanceof Error ? error.message : String(error),
        });
    } finally {
      if (!this.disposed) this.update({ busy: false });
      if (this.restoreRequested || this.disposed) {
        this.restoreRequested = false;
        if (this.disposed) {
          if (mode !== "normal")
            await this.backend.setMode("normal").catch(() => {});
        } else await this.setMode("normal");
      }
    }
  }
  dispose() {
    if (this.disposed) return;
    void this.setMode("normal");
    this.disposed = true;
    this.listeners.clear();
  }
}
