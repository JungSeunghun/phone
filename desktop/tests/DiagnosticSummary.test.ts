import { it, expect } from "vitest";
import { diagnosticSummary } from "../src/domain/DiagnosticSummary";
it("exports only known codes and outcomes, excluding all free text and identifiers", () => {
  const report = {
    elapsedMilliseconds: 3,
    checks: [
      {
        code: "adb",
        status: "failed" as const,
        title: "/Users/private",
        message: "192.168.1.10:5555 secret",
        action: "PMK1|private",
      },
      {
        code: "device-secret",
        status: "passed" as const,
        title: "",
        message: "",
        action: "",
      },
    ],
  };
  const summary = diagnosticSummary(report, {
    platform: "android",
    transport: "usb",
  });
  expect(summary).toEqual({
    schemaVersion: 1,
    platform: "android",
    transport: "usb",
    checks: [{ code: "adb", status: "failed" }],
  });
  expect(JSON.stringify(summary)).not.toMatch(
    /private|192\.168|PMK1|device-secret/,
  );
});
it("rejects invalid targets, duplicate codes, excessive checks and invalid outcomes", () => {
  const check = {
    code: "adb",
    status: "passed" as const,
    title: "",
    message: "",
    action: "",
  };
  expect(() =>
    diagnosticSummary(
      { elapsedMilliseconds: 0, checks: [check, check] },
      { platform: "ios", transport: "wifi" },
    ),
  ).toThrow();
  expect(() =>
    diagnosticSummary(
      { elapsedMilliseconds: 0, checks: Array(11).fill(check) },
      { platform: "ios", transport: "wifi" },
    ),
  ).toThrow();
  expect(() =>
    diagnosticSummary(
      { elapsedMilliseconds: 0, checks: [] },
      { platform: "bad" as "ios", transport: "wifi" },
    ),
  ).toThrow();
  expect(() =>
    diagnosticSummary(
      {
        elapsedMilliseconds: 0,
        checks: [{ ...check, status: "secret" as "passed" }],
      },
      { platform: "ios", transport: "wifi" },
    ),
  ).toThrow();
});
