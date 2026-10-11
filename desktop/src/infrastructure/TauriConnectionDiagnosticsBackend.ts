import { invoke } from "@tauri-apps/api/core";
import type {
  ConnectionDiagnosticsBackend,
  DiagnosticRequest,
  DiagnosticReport,
} from "../domain/ConnectionDiagnostics";
export class TauriConnectionDiagnosticsBackend implements ConnectionDiagnosticsBackend {
  run(
    diagnosticId: string,
    request: DiagnosticRequest,
  ): Promise<DiagnosticReport> {
    return invoke("run_connection_diagnostics", { diagnosticId, request });
  }
  cancel(diagnosticId: string): Promise<void> {
    return invoke("cancel_connection_diagnostics", { diagnosticId });
  }
}
