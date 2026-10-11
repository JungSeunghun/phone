import { validWirelessAddress } from "./PhoneMirror";
export interface DiagnosticRequest {
  platform: "android" | "ios";
  transport: "usb" | "wifi";
  identifier?: string;
  address?: string;
}
export interface DiagnosticCheck {
  code: string;
  title: string;
  status: "passed" | "warning" | "failed";
  message: string;
  action: string;
}
export interface DiagnosticReport {
  checks: DiagnosticCheck[];
  elapsedMilliseconds: number;
}
export interface ConnectionDiagnosticsBackend {
  run(
    diagnosticId: string,
    request: DiagnosticRequest,
  ): Promise<DiagnosticReport>;
  cancel(diagnosticId: string): Promise<void>;
}
export function validDiagnosticRequest(request: DiagnosticRequest): boolean {
  return (
    ["android", "ios"].includes(request.platform) &&
    ["usb", "wifi"].includes(request.transport) &&
    (request.identifier === undefined ||
      (typeof request.identifier === "string" &&
        request.identifier.length > 0 &&
        Array.from(request.identifier).length <= 256 &&
        request.identifier.trim() === request.identifier &&
        !/[\x00-\x1f\x7f-\x9f]/.test(request.identifier))) &&
    (request.address === undefined ||
      (typeof request.address === "string" &&
        request.platform === "android" &&
        request.transport === "wifi" &&
        request.address.trim() === request.address &&
        validWirelessAddress(request.address)))
  );
}
