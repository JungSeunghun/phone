import { test, expect } from "@playwright/test";
test("unconfigured update settings remain usable in the app sidebar", async ({
  page,
}) => {
  await page.goto("/tests/browser/layout.html");
  const panel = page.getByRole("region", { name: "앱 업데이트" });
  // section is named but has no explicit role; use its accessible label.
  const settings = page.locator('section[aria-label="앱 업데이트"]');
  await expect(settings.getByText(/배포 주소를 등록/)).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "업데이트 확인", exact: true }),
  ).toBeDisabled();
  await settings.getByLabel("자동으로 새 버전 확인").uncheck();
  await settings.getByText("업데이트 배포 주소", { exact: true }).click();
  await settings
    .getByLabel("HTTPS 업데이트 주소")
    .fill("http://example.org/latest.json");
  await settings.getByRole("button", { name: "주소 저장" }).click();
  await expect(settings.getByText(/HTTPS 주소를 입력/)).toBeVisible();
  await page.reload();
  await expect(settings.getByLabel("자동으로 새 버전 확인")).not.toBeChecked();
});
