import { test, expect } from "@playwright/test";
test("connection controls stay visible with expanded Wi-Fi settings and the panel collapses for video", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/tests/browser/layout.html");
  await page.getByText("Wi-Fi 페어링 · 연결", { exact: true }).click();
  const button = page.getByRole("button", {
    name: "폰 화면 보기",
    exact: true,
  });
  const box = (await button.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(600);
  await button.click();
  await page.evaluate(() =>
    (
      window as unknown as { renderFixture: (w: number, h: number) => void }
    ).renderFixture(886, 1920),
  );
  await expect(page.locator(".sidebar")).not.toBeVisible();
  await page.getByRole("button", { name: "설정 열기" }).click();
  await expect(page.locator(".sidebar")).toBeVisible();
  const stop = (await page
    .getByRole("button", { name: "연결 종료", exact: true })
    .boundingBox())!;
  expect(stop.y + stop.height).toBeLessThanOrEqual(600);
});
for (const mode of ["전체 화면", "PiP"]) {
  test(`recording controls remain visible and stop without restoring ${mode}`, async ({
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
    await expect(page.getByLabel("녹화 경과 시간")).toHaveText("00:00");
    await page.evaluate(async () => {
      const c = document.querySelector("canvas")!,
        ctx = c.getContext("2d")!;
      await new Promise<void>((resolve) => {
        let frames = 0;
        const draw = () => {
          ctx.fillStyle = frames % 2 ? "#2dd4bf" : "#143431";
          ctx.fillRect(0, 0, c.width, c.height);
          if (++frames === 70) resolve();
          else requestAnimationFrame(draw);
        };
        draw();
      });
    });
    await expect(page.getByLabel("녹화 경과 시간")).not.toHaveText("00:00");
    await page.getByRole("button", { name: mode, exact: true }).click();
    if (mode === "PiP") await page.setViewportSize({ width: 240, height: 180 });
    await expect(page.getByText("녹화 중", { exact: true })).toBeVisible();
    const stop = page.getByRole("button", {
      name: "녹화 종료 및 저장",
      exact: true,
    });
    await expect(stop).toBeVisible();
    const box = (await stop.boundingBox())!,
      viewport = page.viewportSize()!;
    expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    await stop.click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { saved: Blob[] }).saved.length,
        ),
      )
      .toBe(1);
    await expect(page.locator("main")).toHaveClass(
      mode === "PiP" ? /view-pip/ : /view-fullscreen/,
    );
    await page.getByRole("button", { name: "연결 종료", exact: true }).click();
    await expect(page.locator("main")).toHaveClass(/view-normal/);
  });
}

test("performance details expose separate stages without replacing the canvas", async ({
  page,
}) => {
  await page.goto("/tests/browser/layout.html");
  await page.getByRole("button", { name: "폰 화면 보기" }).click();
  await page.evaluate(() =>
    (
      window as unknown as {
        renderFixture: (width: number, height: number) => void;
      }
    ).renderFixture(886, 1920),
  );
  await page.getByText("성능 정보", { exact: true }).click();
  await expect(page.getByText(/수신 간격 p95/)).toBeVisible();
  await expect(page.getByText(/표시 FPS는 세션 평균/)).toBeVisible();
  await expect(page.getByLabel("폰 영상")).toBeVisible();
});
