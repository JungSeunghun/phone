import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import type { ApplicationUpdateBackend } from "../application/ApplicationUpdateController";
export class TauriApplicationUpdateBackend implements ApplicationUpdateBackend {
  private operationId = "";
  async configuration() {
    return isTauri()
      ? invoke<{ version: string; configured: boolean }>(
          "application_update_configuration",
        )
      : { version: "개발 미리보기", configured: false };
  }
  check(endpoint?: string) {
    this.operationId = crypto.randomUUID();
    return invoke<{ version: string; notes: string } | null>(
      "check_application_update",
      { endpoint, operationId: this.operationId },
    );
  }
  async install(progress: (percent: number) => void) {
    this.operationId = crypto.randomUUID();
    const onProgress = new Channel<number>();
    onProgress.onmessage = progress;
    await invoke("install_application_update", {
      onProgress,
      operationId: this.operationId,
    });
  }
  async cancel() {
    if (isTauri() && this.operationId)
      return invoke<boolean>("cancel_application_update", {
        operationId: this.operationId,
      });
    return true;
  }
}
