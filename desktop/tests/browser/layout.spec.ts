import { test, expect } from "@playwright/test";
for (const viewport of [
  { width: 800, height: 600 },
  { width: 1120, height: 780 },
  { width: 1440, height: 900 },
]) {
  for (const dimensions of [
    { width: 886, height: 1920 },
    { width: 1920, height: 886 },
  ]) {
    test(
      "full phone canvas stays inside the viewer and toolbar at " +
        JSON.stringify({ viewport, dimensions }),
      async ({ page }) => {
        await page.setViewportSize(viewport);
        await page.goto("/tests/browser/layout.html");
        await page.getByRole("button", { name: "폰 화면 보기" }).click();
        await page.evaluate(
          (dimensions) =>
            (
              window as unknown as {
                renderFixture: (width: number, height: number) => void;
              }
            ).renderFixture(dimensions.width, dimensions.height),
          dimensions,
        );
        await expect(
          page.getByText("화면 수신 중", { exact: true }),
        ).toBeVisible();
        const canvas = await page.getByLabel("폰 영상").boundingBox();
        const footer = await page.locator(".viewer-toolbar").boundingBox();
        expect(canvas).not.toBeNull();
        expect(footer).not.toBeNull();
        const header = (await page.locator(".viewer-header").boundingBox())!;
        expect(canvas!.y).toBeGreaterThanOrEqual(header.y + header.height);
        expect(canvas!.y + canvas!.height).toBeLessThanOrEqual(footer!.y + 1);
        expect(footer!.y + footer!.height).toBeLessThanOrEqual(
          viewport.height + 1,
        );
        await page.getByRole("button", { name: "연결 종료" }).click();
        await expect(page.getByLabel("폰 영상")).not.toBeVisible();
      },
    );
  }
}

for (const height of [540, 600]) {
  test(`device selection stays fixed while sidebar scrolls at 800x${height}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height });
    await page.goto("/tests/browser/layout.html");
    const device = page.getByLabel("연결된 기기", { exact: true });
    const before = (await device.boundingBox())!;
    await page.getByText("Android Wi-Fi 연결", { exact: true }).click();
    await page.getByText("코드·주소로 연결", { exact: true }).click();
    await page.locator(".sidebar-content").evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const after = (await device.boundingBox())!;
    expect(after.y).toBe(before.y);
    await expect(device).toBeVisible();
    await expect(page.getByRole("button", { name: "새로 고침" })).toBeVisible();
    await expect(page.getByLabel("연결 주소", { exact: true })).toBeVisible();
    expect(
      await page
        .locator(".sidebar")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
  });
}
