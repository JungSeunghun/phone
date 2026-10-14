export interface ApplicationUpdateBackend {
  configuration(): Promise<{
    version: string;
    configured: boolean;
    endpoint?: string;
  }>;
  check(endpoint?: string): Promise<{ version: string; notes: string } | null>;
  install(progress: (percent: number) => void): Promise<void>;
  cancel(): Promise<boolean | void>;
}
type Phase =
  | "idle"
  | "unconfigured"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "error";
export class ApplicationUpdateController {
  private snapshot = {
    phase: "idle" as Phase,
    version: "",
    nextVersion: "",
    notes: "",
    message: "",
    percent: 0,
    cancelBusy: false,
    automatic: true,
    endpoint: "",
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private configured = false;
  private lastCheck = 0;
  private initialized = false;
  private cancellation?: Promise<void>;
  constructor(
    private backend: ApplicationUpdateBackend,
    private storage: Pick<Storage, "getItem" | "setItem">,
    private busy: () => boolean,
    private now: () => number = () => performance.now(),
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
  private persist(key: string, value: string) {
    try {
      this.storage.setItem(key, value);
    } catch {
      this.update({
        message: "설정을 저장하지 못했습니다. 이번 실행에만 적용합니다.",
      });
    }
  }
  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
    try {
      this.update({
        automatic: this.storage.getItem("phone-mirror-auto-update") !== "false",
        endpoint: this.storage.getItem("phone-mirror-update-endpoint") ?? "",
      });
    } catch {
      /* Missing storage uses safe defaults. */
    }
    try {
      const config = await this.backend.configuration();
      this.configured = config.configured;
      this.update({
        version: config.version,
        endpoint: this.snapshot.endpoint || config.endpoint || "",
      });
      if (!config.configured && !this.snapshot.endpoint)
        this.update({
          phase: "unconfigured",
          message:
            "업데이트 배포 주소를 등록하면 앱에서 업데이트할 수 있습니다.",
        });
      else if (this.snapshot.automatic) await this.check();
    } catch (error) {
      this.update({ phase: "error", message: String(error) });
    }
  }
  setAutomatic(value: boolean) {
    this.update({ automatic: value });
    this.persist("phone-mirror-auto-update", String(value));
  }
  async setEndpoint(value: string) {
    if (
      this.snapshot.cancelBusy ||
      ["checking", "downloading", "installing"].includes(this.snapshot.phase)
    )
      return;
    try {
      const url = new URL(value.trim());
      if (url.protocol !== "https:" || url.username || url.password || url.hash)
        throw Error("invalid endpoint");
      this.update({
        endpoint: url.href,
        phase: "idle",
        nextVersion: "",
        notes: "",
        message: "업데이트 주소를 저장했습니다.",
      });
      this.persist("phone-mirror-update-endpoint", url.href);
      await this.check();
    } catch {
      this.update({
        message: "아이디·비밀번호와 #이 없는 HTTPS 주소를 입력하세요.",
      });
    }
  }
  async tick(time = this.now()) {
    if (
      this.snapshot.automatic &&
      !this.busy() &&
      Number.isFinite(time) &&
      time - this.lastCheck >= 86_400_000
    )
      await this.check(time);
  }
  async check(time = this.now()) {
    if (
      this.snapshot.cancelBusy ||
      ["checking", "downloading", "installing"].includes(this.snapshot.phase)
    )
      return;
    if (!this.configured && !this.snapshot.endpoint) {
      this.update({ phase: "unconfigured" });
      return;
    }
    const generation = ++this.generation;
    this.lastCheck = time;
    this.update({
      phase: "checking",
      message: "업데이트를 확인하고 있습니다.",
    });
    try {
      const result = await this.backend.check(
        this.snapshot.endpoint || undefined,
      );
      await this.cancellation;
      if (generation !== this.generation) return;
      this.update(
        result
          ? {
              phase: "available",
              nextVersion: result.version,
              notes: result.notes,
              message: "새 버전을 설치할 수 있습니다.",
            }
          : {
              phase: "idle",
              nextVersion: "",
              notes: "",
              message: "현재 최신 버전입니다.",
            },
      );
    } catch (error) {
      await this.cancellation;
      if (generation === this.generation)
        this.update({
          phase: "error",
          message: `업데이트 확인 실패: ${String(error)}`,
        });
    }
  }
  async install() {
    if (this.snapshot.cancelBusy || this.snapshot.phase !== "available") return;
    if (this.busy()) {
      this.update({
        message: "미러링을 중지하고 녹화·파일 저장이 끝난 뒤 설치하세요.",
      });
      return;
    }
    const generation = ++this.generation;
    this.update({
      phase: "downloading",
      percent: 0,
      message: "업데이트를 다운로드하고 서명을 확인합니다.",
    });
    try {
      await this.backend.install((percent) => {
        if (generation === this.generation && Number.isFinite(percent))
          this.update(
            percent < 0
              ? {
                  phase: "installing",
                  message: "업데이트를 설치하고 다시 시작합니다.",
                }
              : { percent: Math.max(0, Math.min(100, percent)) },
          );
      });
    } catch (error) {
      await this.cancellation;
      if (generation === this.generation)
        this.update({
          phase: "error",
          message: `업데이트 설치 실패: ${String(error)}`,
        });
    }
  }
  cancel(): Promise<void> {
    if (this.cancellation) return this.cancellation;
    if (this.snapshot.phase === "installing") return Promise.resolve();
    this.update({ cancelBusy: true });
    // Assign the shared task before calling a backend that may throw synchronously.
    this.cancellation = Promise.resolve().then(() => this.cancelOperation());
    return this.cancellation;
  }
  private async cancelOperation() {
    const generation = this.generation;
    try {
      if ((await this.backend.cancel()) === false) {
        if (generation === this.generation)
          this.update({
            phase: "installing",
            message:
              "설치가 시작되어 취소할 수 없습니다. 앱을 다시 시작합니다.",
          });
        return;
      }
      if (generation !== this.generation) return;
      ++this.generation;
      this.update({
        phase: "idle",
        nextVersion: "",
        notes: "",
        message: "업데이트 작업을 취소했습니다.",
      });
    } catch (error) {
      if (generation === this.generation)
        this.update({ message: `취소 요청 실패: ${String(error)}` });
    } finally {
      this.cancellation = undefined;
      this.update({ cancelBusy: false });
    }
  }
}
