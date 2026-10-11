import { test, expect } from "@playwright/test";
for (const mode of ["전체 화면", "PiP"])
  test(`pause/resume remains visible and stop works while paused in ${mode}`, async ({
    page,
  }) => {
    await page.goto("/tests/browser/layout.html");
    await page
      .getByRole("button", { name: "폰 화면 보기", exact: true })
      .click();
    await page.evaluate(() =>
      (
        window as unknown as { renderFixture: (w: number, h: number) => void }
      ).renderFixture(320, 640),
    );
    await page.getByRole("button", { name: "화면 녹화", exact: true }).click();
    await page.evaluate(async () => {
      const canvas = document.querySelector("canvas")!;
      const context = canvas.getContext("2d")!;
      for (let index = 0; index < 12; index++) {
        context.fillStyle = index % 2 ? "#111" : "#fff";
        context.fillRect(0, 0, canvas.width, canvas.height);
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => resolve()),
        );
      }
    });
    await page.getByRole("button", { name: mode, exact: true }).click();
    if (mode === "PiP") await page.setViewportSize({ width: 240, height: 180 });
    const pause = page.getByRole("button", {
      name: "녹화 일시 정지",
      exact: true,
    });
    await expect(pause).toBeVisible();
    await pause.click();
    await expect(
      page.getByText("녹화 일시 정지", { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "녹화 재개", exact: true }).click();
    await expect(pause).toBeVisible();
    await pause.click();
    const stop = page.getByRole("button", { name: "녹화 종료 및 저장" });
    const box = (await stop.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    await stop.click();
    await expect(page.getByLabel("녹화 조작")).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { saved: Blob[] }).saved.length,
        ),
      )
      .toBe(1);
  });
