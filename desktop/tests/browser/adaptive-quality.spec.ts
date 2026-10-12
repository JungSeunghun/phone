import { test, expect } from "@playwright/test";
test("adaptive Wi-Fi quality defers through recording and applies without changing saved user limits", async ({
  page,
}) => {
  await page.goto("/tests/browser/layout.html?adaptive=1");
  await page.getByRole("button", { name: "폰 화면 보기", exact: true }).click();
  await page.evaluate(() =>
    (
      window as unknown as { renderFixture: (w: number, h: number) => void }
    ).renderFixture(320, 640),
  );
  await page.getByRole("button", { name: "화면 녹화", exact: true }).click();
  // Capture a frame after MediaRecorder starts, including on slower CI codecs.
  await page.evaluate(async () => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => resolve()),
    );
    (
      window as unknown as { renderFixture: (w: number, h: number) => void }
    ).renderFixture(320, 640);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  await page.evaluate(async () => {
    const mock = window as unknown as {
      simulateAdaptiveNetwork: (now: number) => Promise<void>;
    };
    for (const t of [1000, 2000, 3000]) await mock.simulateAdaptiveNetwork(t);
  });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { qualityRequests: unknown[] }).qualityRequests
          .length,
    ),
  ).toBe(1);
  await expect(page.getByText("녹화 중", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "녹화 종료 및 저장", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "화면 녹화", exact: true }),
  ).toBeEnabled({ timeout: 15000 });
  await page.evaluate(async () =>
    (
      window as unknown as {
        simulateAdaptiveNetwork: (now: number) => Promise<void>;
      }
    ).simulateAdaptiveNetwork(4000),
  );
  expect(
    await page.evaluate(
      () =>
        (
          window as unknown as {
            qualityRequests: { settings: { videoMaxDimension: number } }[];
          }
        ).qualityRequests.at(-1)!.settings.videoMaxDimension,
    ),
  ).toBe(1280);
  if (
    await page
      .getByRole("button", { name: "설정 열기", exact: true })
      .isVisible()
  )
    await page.getByRole("button", { name: "설정 열기", exact: true }).click();
  await page.getByText("Android Wi-Fi 연결", { exact: true }).click();
  await expect(page.getByText(/자동 화질: 최대 1280px/)).toBeVisible();
});
test("USB is excluded from automatic quality changes", async ({ page }) => {
  await page.goto("/tests/browser/layout.html");
  await page.getByRole("button", { name: "폰 화면 보기", exact: true }).click();
  await page.evaluate(() =>
    (
      window as unknown as { renderFixture: (w: number, h: number) => void }
    ).renderFixture(320, 640),
  );
  await page.evaluate(async () => {
    const mock = window as unknown as {
      simulateAdaptiveNetwork: (now: number) => Promise<void>;
    };
    for (const t of [1000, 2000, 3000]) await mock.simulateAdaptiveNetwork(t);
  });
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { qualityRequests: unknown[] }).qualityRequests
          .length,
    ),
  ).toBe(1);
});
