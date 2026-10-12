import type {
  DiagnosticReport,
  DiagnosticRequest,
} from "./ConnectionDiagnostics";
export const diagnosticCodes = [
  "adb",
  "android-device",
  "video-server",
  "wireless-discovery",
  "connection-port",
  "ios-native-usb",
  "apple-usb-devices",
  "ios-usb-receiver",
  "ios-wifi-receiver",
  "local-network",
] as const;
export interface DiagnosticSummary {
  schemaVersion: 1;
  platform: DiagnosticRequest["platform"];
  transport: DiagnosticRequest["transport"];
  checks: {
    code: (typeof diagnosticCodes)[number];
    status: "passed" | "warning" | "failed";
  }[];
}
export interface DiagnosticSummaryStore {
  save(summary: DiagnosticSummary): Promise<boolean>;
}
export function diagnosticSummary(
  report: DiagnosticReport,
  target: Pick<DiagnosticRequest, "platform" | "transport">,
): DiagnosticSummary {
  if (
    !["android", "ios"].includes(target.platform) ||
    !["usb", "wifi"].includes(target.transport) ||
    !Array.isArray(report.checks) ||
    report.checks.length > diagnosticCodes.length
  )
    throw Error("Invalid diagnostic summary");
  const checks: DiagnosticSummary["checks"] = [],
    seen = new Set<string>();
  for (const check of report.checks) {
    if (
      !diagnosticCodes.includes(check.code as (typeof diagnosticCodes)[number])
    )
      continue;
    if (
      seen.has(check.code) ||
      !["passed", "warning", "failed"].includes(check.status)
    )
      throw Error("Invalid diagnostic outcome");
    seen.add(check.code);
    checks.push({
      code: check.code as (typeof diagnosticCodes)[number],
      status: check.status,
    });
  }
  return {
    schemaVersion: 1,
    platform: target.platform,
    transport: target.transport,
    checks,
  };
}
