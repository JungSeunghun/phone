import { test, expect } from "@playwright/test";

test("switches and restores English, preserves video and recording, and fits the settings panel", async ({
  page,
}) => {
  await page.goto("/tests/browser/layout.html");
  await page.getByLabel("언어 / Language").selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(
    page.getByRole("button", { name: "View phone screen" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save screenshot" }),
  ).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel("언어 / Language")).toHaveValue("en");
  await page.getByRole("button", { name: "View phone screen" }).click();
  await page.evaluate(() =>
    (
      window as unknown as { renderFixture: (w: number, h: number) => void }
    ).renderFixture(320, 640),
  );
  await page
    .getByLabel("Phone video")
    .evaluate((canvas) => canvas.setAttribute("data-original", "yes"));
  await page
    .getByRole("button", { name: "Record screen", exact: true })
    .click();
  await page.getByRole("button", { name: "Open settings" }).click();
  const sidebar = page.locator(".sidebar");
  expect(
    await sidebar.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);
  await page.getByLabel("언어 / Language").selectOption("ko");
  await expect(page.getByLabel("폰 영상")).toHaveAttribute(
    "data-original",
    "yes",
  );
  await expect(
    page.getByRole("button", { name: "녹화 종료 및 저장" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "녹화 종료 및 저장" }).click();
});

test("ignores unsupported persisted languages", async ({ page }) => {
  await page.goto("/tests/browser/layout.html");
  await page.evaluate(() =>
    localStorage.setItem("phoneMirror.applicationLanguage.v1", "ja"),
  );
  await page.reload();
  await expect(page.getByLabel("언어 / Language")).toHaveValue("ko");
  await expect(
    page.getByRole("button", { name: "폰 화면 보기" }),
  ).toBeVisible();
});
