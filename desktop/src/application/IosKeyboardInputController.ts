import type { ControlInput } from "../domain/PhoneInput";
export interface IosKeyboardInputBackend {
  start(targetId: string): Promise<{ receiverId: string; codes: string[] }>;
  status(
    receiverId: string,
  ): Promise<{ connected: boolean; generation: string }>;
  stop(receiverId: string): Promise<void>;
  send(
    receiverId: string,
    input: ControlInput,
    generation: string,
  ): Promise<void>;
}
export class IosKeyboardInputController {
  private snapshot = {
    receiverId: undefined as string | undefined,
    targetId: "",
    codes: [] as string[],
    connected: false,
    generation: "0",
    busy: false,
    message: "",
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private cancelPolling?: () => void;
  private polling = false;
  private starting = false;
  private stopping = false;
  constructor(
    private backend: IosKeyboardInputBackend,
    private repeat: (fn: () => Promise<void>) => () => void = (fn) => {
      const timer = setInterval(() => void fn(), 1000);
      return () => clearInterval(timer);
    },
  ) {}
  getSnapshot = () => this.snapshot;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  private update(patch: Partial<typeof this.snapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    this.listeners.forEach((fn) => fn());
  }
  session(targetId: string) {
    return this.snapshot.connected && this.snapshot.targetId === targetId
      ? `${this.snapshot.receiverId}:${this.snapshot.generation}`
      : undefined;
  }
  async start(targetId: string) {
    if (
      !targetId ||
      this.starting ||
      this.snapshot.busy ||
      this.snapshot.receiverId
    )
      return;
    this.starting = true;
    const token = ++this.generation;
    this.update({
      busy: true,
      targetId,
      message: "키보드 연결을 준비하고 있습니다.",
    });
    try {
      const info = await this.backend.start(targetId);
      if (token !== this.generation) {
        try {
          await this.backend.stop(info.receiverId);
        } catch {
          this.update({
            receiverId: info.receiverId,
            targetId: "",
            codes: [],
            connected: false,
            message: "키보드 연결 종료를 다시 시도하세요.",
          });
        }
        return;
      }
      this.update({
        ...info,
        targetId,
        connected: false,
        message:
          "iPhone 송출 앱에서 코드를 저장하고 Phone Mirror 키보드를 선택하세요.",
      });
      this.cancelPolling = this.repeat(async () => {
        if (token !== this.generation || this.polling) return;
        this.polling = true;
        try {
          const status = await this.backend.status(info.receiverId);
          if (token === this.generation)
            this.update({
              connected: status.connected,
              generation: status.generation,
              message: status.connected
                ? "iPhone 키보드 연결됨"
                : "iPhone에서 Phone Mirror 키보드를 선택하거나 다시 연결하세요.",
            });
        } catch {
          if (token === this.generation)
            this.update({
              connected: false,
              message: "키보드 연결 상태를 확인할 수 없습니다.",
            });
        } finally {
          if (token === this.generation) this.polling = false;
        }
      });
    } catch {
      if (token === this.generation)
        this.update({ message: "키보드 연결을 시작할 수 없습니다." });
    } finally {
      this.starting = false;
      if (!this.stopping) this.update({ busy: false });
    }
  }
  async send(input: ControlInput, receiverId: string) {
    if (
      !this.snapshot.connected ||
      receiverId !== this.session(this.snapshot.targetId)
    )
      throw Error("Keyboard unavailable");
    try {
      await this.backend.send(
        this.snapshot.receiverId!,
        input,
        this.snapshot.generation,
      );
    } catch (error) {
      if (receiverId === this.session(this.snapshot.targetId))
        this.update({
          connected: false,
          message: "iPhone 키보드 연결을 확인하고 다시 연결하세요.",
        });
      throw error;
    }
  }
  async stop() {
    if (this.stopping) return;
    const token = ++this.generation;
    this.cancelPolling?.();
    this.cancelPolling = undefined;
    this.polling = false;
    const id = this.snapshot.receiverId;
    this.stopping = !!id;
    this.update({
      targetId: "",
      codes: [],
      connected: false,
      busy: this.starting || !!id,
      message: "",
    });
    if (id) {
      try {
        await this.backend.stop(id);
        if (token === this.generation) this.update({ receiverId: undefined });
      } catch {
        if (token === this.generation)
          this.update({
            message: "키보드 연결 종료를 확인할 수 없습니다. 다시 종료하세요.",
          });
      }
    }
    this.stopping = false;
    if (token === this.generation) this.update({ busy: this.starting });
  }
}
