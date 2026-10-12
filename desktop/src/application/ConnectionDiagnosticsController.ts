import {
  validDiagnosticRequest,
  type DiagnosticRequest,
  type DiagnosticReport,
  type ConnectionDiagnosticsBackend,
} from "../domain/ConnectionDiagnostics";
export class ConnectionDiagnosticsController {
  private snapshot: {
    phase: "idle" | "running" | "done" | "error";
    message: string;
    report?: DiagnosticReport;
    reportTarget?: Pick<DiagnosticRequest, "platform" | "transport">;
    cancelBusy: boolean;
  } = {
    phase: "idle",
    message: "현재 연결을 유지하며 문제를 점검합니다.",
    cancelBusy: false,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private diagnosticId?: string;
  private disposed = false;
  constructor(
    private backend: ConnectionDiagnosticsBackend,
    private createIdentifier: () => string = () => crypto.randomUUID(),
  ) {}
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  getSnapshot = () => this.snapshot;
  private update(change: Partial<typeof this.snapshot>) {
    if (this.disposed) return;
    this.snapshot = { ...this.snapshot, ...change };
    this.listeners.forEach((listener) => listener());
  }
  async run(request: DiagnosticRequest) {
    if (this.disposed || this.snapshot.phase === "running") return;
    if (!validDiagnosticRequest(request)) {
      this.update({
        phase: "error",
        report: undefined,
        message: "진단 대상과 연결 IP 주소·포트를 확인하세요.",
      });
      return;
    }
    const target = { platform: request.platform, transport: request.transport };
    const generation = ++this.generation;
    const id = this.createIdentifier();
    this.diagnosticId = id;
    this.update({
      phase: "running",
      report: undefined,
      cancelBusy: false,
      message: "연결 문제를 점검하고 있습니다.",
    });
    try {
      const report = await this.backend.run(id, { ...request });
      if (generation === this.generation)
        this.update({
          phase: "done",
          report,
          reportTarget: target,
          message: "진단 완료 · 해결 안내를 확인하세요.",
          cancelBusy: false,
        });
    } catch {
      if (generation === this.generation)
        this.update({
          phase: "error",
          report: undefined,
          cancelBusy: false,
          message: "진단을 완료할 수 없습니다. 잠시 후 다시 시도하세요.",
        });
    } finally {
      if (generation === this.generation) this.diagnosticId = undefined;
    }
  }
  async cancel() {
    if (!this.diagnosticId || this.snapshot.cancelBusy || this.disposed) return;
    const generation = this.generation,
      id = this.diagnosticId;
    this.update({ cancelBusy: true });
    try {
      await this.backend.cancel(id);
      if (generation === this.generation) {
        this.generation++;
        this.diagnosticId = undefined;
        this.update({
          phase: "idle",
          report: undefined,
          cancelBusy: false,
          message: "연결 진단을 취소했습니다.",
        });
      }
    } catch {
      if (generation === this.generation)
        this.update({
          cancelBusy: false,
          message:
            "진단 취소를 확인할 수 없습니다. 완료를 기다리거나 취소를 다시 시도하세요.",
        });
    }
  }
  dispose() {
    this.disposed = true;
    this.generation++;
    if (this.diagnosticId)
      void this.backend.cancel(this.diagnosticId).catch(() => {});
    this.listeners.clear();
  }
}
