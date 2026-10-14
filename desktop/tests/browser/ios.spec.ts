import { test, expect } from "@playwright/test";
test("native synthetic iPhone packets display and share capture, recording and view behavior", async ({
  page,
}) => {
  test.skip(
    await page.evaluate(() => !navigator.userAgent.includes("Macintosh")),
    "Mac USB capture fixture requires macOS VideoToolbox",
  );
  await page.goto("/tests/browser/layout.html?ios=1&native=1");
  await expect(page.getByText(/이 컴퓨터를 신뢰/)).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: "연결 중 폰 화면 켜 두기" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "폰 화면 보기", exact: true }).click();
  await expect(page.getByText("화면 수신 중", { exact: true })).toBeVisible();
  await expect(page.getByText("iPhone · 보기 전용")).toBeVisible();
  const canvas = page.getByLabel("폰 영상");
  await expect(canvas).toHaveAttribute("width", "320");
  await expect(canvas).toHaveAttribute("height", "640");
  await expect(page.getByRole("button", { name: "소리 재생" })).toBeDisabled();
  await canvas.click();
  expect(
    await page.evaluate(
      () => (window as unknown as { controls: unknown[] }).controls.length,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "스크린샷 저장" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { saved: Blob[] }).saved.length,
      ),
    )
    .toBe(1);
  await page.getByRole("button", { name: "화면 녹화", exact: true }).click();
  await page.getByRole("button", { name: "전체 화면", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "녹화 종료 및 저장" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "기본 보기", exact: true }).click();
  await page.getByRole("button", { name: "PiP", exact: true }).click();
  await page.setViewportSize({ width: 240, height: 180 });
  await expect(
    page.getByRole("button", { name: "녹화 종료 및 저장" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "녹화 종료 및 저장" }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { nativeSaved: string[] }).nativeSaved.length,
      ),
    )
    .toBe(1);
  await expect(canvas).toHaveAttribute("width", "320");
  await page.getByRole("button", { name: "연결 종료", exact: true }).click();
  await expect(page.locator("main")).toHaveClass(/view-normal/);
});

test("USB iPhone audio playback and native audio recording remain available through pause and PiP", async ({
  page,
}) => {
  test.skip(
    await page.evaluate(() => !navigator.userAgent.includes("Macintosh")),
    "Mac USB fixture",
  );
  await page.goto("/tests/browser/layout.html?ios=1&native=1&iosaudio=1");
  await page.getByRole("button", { name: "폰 화면 보기", exact: true }).click();
  await expect(page.getByText("화면 수신 중", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "소리 재생" })).toBeEnabled();
  await page.getByRole("button", { name: "소리 재생" }).click();
  await page.evaluate(() => {
    const packet = new ArrayBuffer(4108);
    const view = new DataView(packet);
    view.setBigUint64(0, 100000n);
    view.setUint32(8, 4096);
    (
      window as unknown as { pushAudio: (packet: ArrayBuffer) => void }
    ).pushAudio(packet);
  });
  await expect(page.getByText("컴퓨터에서 폰 소리 재생 중")).toBeVisible();
  await page.getByRole("button", { name: "화면 녹화", exact: true }).click();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { nativeStarts: { includeAudio: boolean }[] })
          .nativeStarts[0].includeAudio,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "녹화 일시 정지" }).click();
  await expect(page.getByRole("button", { name: "녹화 재개" })).toBeEnabled();
  await page.getByRole("button", { name: "PiP", exact: true }).click();
  await page.getByRole("button", { name: "녹화 재개" }).click();
  await page.getByRole("button", { name: "녹화 종료 및 저장" }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { nativeSaved: string[] }).nativeSaved.length,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "연결 종료", exact: true }).click();
});
