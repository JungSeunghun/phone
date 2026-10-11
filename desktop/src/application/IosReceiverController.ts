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
    phase: "idle" | "starting" | "listening" | "error";
    codes: string[];
    receiverId?: string;
    message: string;
  } = { phase: "idle", codes: [], message: "" };
  private listeners = new Set<() => void>();
  private generation = 0;
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
    if (["starting", "listening"].includes(this.snapshot.phase)) return;
    const generation = ++this.generation;
    this.update({ phase: "starting", message: "수신을 준비하고 있습니다." });
    try {
      const info = await this.backend.start();
      if (generation !== this.generation) {
        await this.backend.stop(info.receiverId);
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
    }
  }
  async stop() {
    const generation = ++this.generation;
    const id = this.snapshot.receiverId;
    this.update({
      phase: "idle",
      codes: [],
      receiverId: undefined,
      message: "",
    });
    if (id)
      try {
        await this.backend.stop(id);
      } catch {
        if (generation !== this.generation) return;
        this.update({
          phase: "error",
          message: "수신 종료에 실패했습니다. 앱을 종료한 뒤 다시 시도하세요.",
        });
      }
  }
  dispose() {
    void this.stop();
    this.listeners.clear();
  }
}
