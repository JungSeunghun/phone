import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  DiagnosticSummary,
  DiagnosticSummaryStore,
} from "../domain/DiagnosticSummary";
export class TauriDiagnosticSummaryStore implements DiagnosticSummaryStore {
  async save(summary: DiagnosticSummary): Promise<boolean> {
    if (isTauri())
      return invoke<boolean>("save_diagnostic_summary", { summary });
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(summary, null, 2) + "\n"], {
        type: "application/json",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "phone-mirror-diagnostic-summary.json";
    try {
      document.body.append(link);
      link.click();
      return true;
    } finally {
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  }
}
