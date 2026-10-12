export interface IosReceiverInfo {
  receiverId: string;
  port: number;
  codes: string[];
}
export interface IosReceiverBackend {
  start(): Promise<IosReceiverInfo>;
  stop(receiverId: string): Promise<void>;
}
export class IosReceiverController {
  snapshot: {
    phase:
      "idle" | "starting" | "listening" | "stopping" | "stopError" | "error";
    codes: string[];
    receiverId?: string;
    message: string;
  } = { phase: "idle", codes: [], message: "" };
  private listeners = new Set<() => void>();
  private generation = 0;
  private starting = false;
  constructor(
    private backend: IosReceiverBackend,
    private transport: "wifi" | "usb" = "wifi",
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private update(change: Partial<typeof this.snapshot>) {
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((listener) => listener());
  }
  async start() {
    if (
      this.starting ||
      this.snapshot.receiverId ||
      this.snapshot.phase === "stopping"
    )
      return;
    this.starting = true;
    const generation = ++this.generation;
    this.update({ phase: "starting", message: "수신을 준비하고 있습니다." });
    try {
      const info = await this.backend.start();
      if (generation !== this.generation) {
        this.update({ receiverId: info.receiverId, codes: [] });
        await this.cleanup(info.receiverId);
        return;
      }
      this.update({
        phase: "listening",
        ...info,
        message:
          this.transport === "usb"
            ? "USB로 연결한 iPhone 송출 앱에 코드를 입력하고 화면 방송을 시작하세요."
            : "같은 Wi-Fi의 iPhone 송출 앱에 연결 코드를 입력하세요.",
      });
    } catch {
      if (generation === this.generation)
        this.update({
          phase: "error",
          message:
            this.transport === "usb"
              ? "USB 수신을 준비할 수 없습니다. Apple 기기 드라이버와 한 대의 iPhone USB 신뢰 상태를 확인하세요."
              : "수신 포트를 열 수 없습니다. 다시 시도하세요.",
        });
    } finally {
      this.starting = false;
      if (this.getSnapshot().phase === "stopping" && !this.snapshot.receiverId)
        this.update({ phase: "idle", message: "" });
    }
  }
  async stop() {
    if (this.snapshot.phase === "stopping") return;
    ++this.generation;
    const id = this.snapshot.receiverId;
    this.update({
      phase: id || this.starting ? "stopping" : "idle",
      codes: [],
      message: id || this.starting ? "수신을 종료하고 있습니다." : "",
    });
    if (id) await this.cleanup(id);
  }
  private async cleanup(id: string) {
    this.update({
      phase: "stopping",
      codes: [],
      message: "수신을 종료하고 있습니다.",
    });
    try {
      await this.backend.stop(id);
      this.update({ phase: "idle", receiverId: undefined, message: "" });
    } catch {
      this.update({
        phase: "stopError",
        receiverId: id,
        codes: [],
        message: "수신 종료에 실패했습니다. 종료를 다시 시도하세요.",
      });
    }
  }
  dispose() {
    void this.stop();
    this.listeners.clear();
  }
}
