export interface AndroidQrPairingInfo {
  sessionId: string;
  payload: string;
  expiresInSeconds: number;
}
export interface AndroidQrPairingBackend {
  start(): Promise<AndroidQrPairingInfo>;
  wait(sessionId: string): Promise<{ address: string }>;
  cancel(sessionId: string): Promise<void>;
}
export class AndroidQrPairingController {
  private snapshot: {
    phase:
      | "idle"
      | "starting"
      | "waiting"
      | "connected"
      | "error"
      | "cancelling"
      | "cancelError";
    payload?: string;
    message: string;
  } = { phase: "idle", message: "" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private sessionId?: string;
  constructor(
    private backend: AndroidQrPairingBackend,
    private onConnected: () => void | Promise<void>,
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private update(value: typeof this.snapshot) {
    this.snapshot = value;
    this.listeners.forEach((l) => l());
  }
  async start() {
    if (
      ["starting", "waiting", "cancelling", "cancelError"].includes(
        this.snapshot.phase,
      )
    )
      return;
    const generation = ++this.generation;
    this.update({
      phase: "starting",
      message: "Android QR 페어링을 준비하고 있습니다.",
    });
    let id: string | undefined;
    try {
      const info = await this.backend.start();
      id = info.sessionId;
      if (generation !== this.generation) {
        try {
          await this.backend.cancel(id);
          if (this.snapshot.phase === "cancelling")
            this.update({ phase: "idle", message: "" });
        } catch {
          this.sessionId = id;
          this.update({
            phase: "cancelError",
            message:
              "QR 페어링 취소에 실패했습니다. 취소를 다시 시도하거나 앱을 종료하세요.",
          });
        }
        return;
      }
      this.sessionId = id;
      this.update({
        phase: "waiting",
        payload: info.payload,
        message: `폰의 ‘QR 코드로 기기 페어링’에서 스캔하세요. ${info.expiresInSeconds}초 동안 기다립니다.`,
      });
      await this.backend.wait(id);
      if (generation !== this.generation) return;
      this.sessionId = undefined;
      this.update({
        phase: "connected",
        message:
          "Android Wi-Fi 페어링과 연결을 완료했습니다. 기기를 선택해 화면을 보세요.",
      });
      await this.onConnected();
    } catch {
      if (generation !== this.generation) {
        if (this.snapshot.phase === "cancelling" && !this.sessionId)
          this.update({ phase: "idle", message: "" });
        return;
      }
      if (id) {
        try {
          await this.backend.cancel(id);
        } catch {
          if (generation === this.generation) {
            this.sessionId = id;
            this.update({
              phase: "cancelError",
              message:
                "QR 페어링 취소에 실패했습니다. 취소를 다시 시도하거나 앱을 종료하세요.",
            });
          }
          return;
        }
      }
      this.sessionId = undefined;
      if (generation === this.generation)
        this.update({
          phase: "error",
          message:
            "QR 페어링을 완료하지 못했습니다. 같은 Wi-Fi·무선 디버깅·Platform Tools를 확인하고 새 QR 또는 페어링 코드를 사용하세요.",
        });
    }
  }
  async cancel() {
    const generation = ++this.generation;
    const id = this.sessionId;
    const pendingStart =
      this.snapshot.phase === "starting" ||
      (this.snapshot.phase === "cancelling" && !id);
    this.update({
      phase: id || pendingStart ? "cancelling" : "idle",
      message: id || pendingStart ? "QR 페어링을 취소하고 있습니다." : "",
    });
    if (!id) return;
    try {
      await this.backend.cancel(id);
      if (generation === this.generation) {
        this.sessionId = undefined;
        this.update({ phase: "idle", message: "" });
      }
    } catch {
      if (generation === this.generation)
        this.update({
          phase: "cancelError",
          message:
            "QR 페어링 취소에 실패했습니다. 취소를 다시 시도하거나 앱을 종료하세요.",
        });
    }
  }
  dispose() {
    void this.cancel();
    this.listeners.clear();
  }
}
