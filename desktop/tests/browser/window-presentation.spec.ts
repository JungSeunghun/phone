import { test, expect } from "@playwright/test";
for (const dimensions of [
  { width: 886, height: 1920 },
  { width: 1920, height: 886 },
]) {
  test(`PiP fits minimum window, preserves canvas and mouse input ${dimensions.width}`, async ({
    page,
  }) => {
    await page.goto("/tests/browser/layout.html");
    await page.getByRole("button", { name: "폰 화면 보기" }).click();
    await page.evaluate(
      (d) =>
        (
          window as unknown as { renderFixture: (w: number, h: number) => void }
        ).renderFixture(d.width, d.height),
      dimensions,
    );
    await page
      .getByLabel("폰 영상")
      .evaluate((canvas) => canvas.setAttribute("data-original", "yes"));
    await page.getByRole("button", { name: "PiP", exact: true }).click();
    await expect(page.locator("main")).toHaveClass(/view-pip/);
    await page.setViewportSize({ width: 240, height: 180 });
    await expect(page.getByRole("button", { name: "기본 보기" })).toBeVisible();
    const box = (await page.getByLabel("폰 영상").boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(240);
    expect(box.y + box.height).toBeLessThanOrEqual(180);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { controls: unknown[] }).controls.length,
        ),
      )
      .toBe(2);
    await expect(page.getByLabel("폰 영상")).toHaveAttribute(
      "data-original",
      "yes",
    );
    await page.keyboard.press("Escape");
    await expect(page.locator("main")).toHaveClass(/view-normal/);
  });
}
test("fullscreen keeps recording active across view changes and restores on disconnect", async ({
  page,
}) => {
  await page.goto("/tests/browser/layout.html");
  await page.getByRole("button", { name: "폰 화면 보기" }).click();
  await page.evaluate(() =>
    (
      window as unknown as { renderFixture: (w: number, h: number) => void }
    ).renderFixture(320, 640),
  );
  await page.getByRole("button", { name: "화면 녹화", exact: true }).click();
  await page.evaluate(async () => {
    const canvas = document.querySelector("canvas")!;
    const context = canvas.getContext("2d")!;
    await new Promise<void>((resolve) => {
      let frame = 0;
      const animate = () => {
        context.fillStyle = frame % 2 ? "#2dd4bf" : "#143431";
        context.fillRect(0, 0, canvas.width, canvas.height);
        if (++frame >= 30) resolve();
        else requestAnimationFrame(animate);
      };
      requestAnimationFrame(animate);
    });
  });
  await page.getByRole("button", { name: "전체 화면", exact: true }).click();
  await expect(page.locator("main")).toHaveClass(/view-fullscreen/);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "녹화 종료 및 저장" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "PiP", exact: true }).click();
  await page.evaluate(() =>
    (
      window as unknown as { disconnectFixture: () => void }
    ).disconnectFixture(),
  );
  await expect(page.locator("main")).toHaveClass(/view-normal/);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { saved: Blob[] }).saved.length,
      ),
    )
    .toBe(1);
});
