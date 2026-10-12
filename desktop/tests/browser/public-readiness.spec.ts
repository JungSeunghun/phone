import { test, expect } from "@playwright/test";
test("first connection guidance and downloaded diagnostic summary contain no device details", async ({
  page,
}) => {
  await page.goto("/tests/browser/layout.html");
  await page.getByText("처음 연결하기", { exact: true }).click();
  await expect(page.getByText(/USB 디버깅을 켜고/)).toBeVisible();
  await page.getByLabel("처음 연결할 방식").selectOption("ios-wifi");
  await expect(page.getByText(/iPhone 실기기 검증은 아직/)).toBeVisible();
  await page.getByText("연결 문제 진단", { exact: true }).click();
  await page
    .getByRole("button", { name: "연결 진단 시작", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "진단 요약 저장", exact: true })
    .click();
  const download = await downloadPromise;
  const path = await download.path();
  expect(path).not.toBeNull();
  const { readFile } = await import("node:fs/promises");
  const report = JSON.parse(await readFile(path!, "utf8"));
  expect(report.schemaVersion).toBe(1);
  expect(report.checks.length).toBeGreaterThan(0);
  expect(Object.keys(report).sort()).toEqual([
    "checks",
    "platform",
    "schemaVersion",
    "transport",
  ]);
  for (const check of report.checks)
    expect(Object.keys(check).sort()).toEqual(["code", "status"]);
});
