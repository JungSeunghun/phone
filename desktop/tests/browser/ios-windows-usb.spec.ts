import { test, expect } from "@playwright/test";
test("Windows USB presentation drives wired receiver, app sound, AV recording and PiP pause", async ({
  page,
}) => {
  test.skip(
    await page.evaluate(() => !navigator.userAgent.includes("Macintosh")),
    "Native synthetic packet fixture requires macOS; Windows UI is simulated here",
  );
  await page.goto("/tests/browser/layout.html?ios=1&native=1&iosusb=1");
  await page.getByText("iPhone Windows USB 수신", { exact: true }).click();
  await page
    .getByRole("button", { name: "iPhone USB 수신 시작", exact: true })
    .click();
  await expect(page.getByLabel("iPhone USB 연결 코드 1")).toHaveValue(
    `PMU1|27483|${"ab".repeat(32)}`,
  );
  await expect(
    page.getByRole("img", { name: "iPhone 연결 QR 코드 1" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "폰 화면 보기", exact: true }).click();
  await expect(page.getByText("화면 수신 중", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "소리 재생", exact: true }).click();
  await page.evaluate(() => {
    const packet = new ArrayBuffer(4108);
    new DataView(packet).setUint32(8, 4096);
    (window as unknown as { pushAudio: (p: ArrayBuffer) => void }).pushAudio(
      packet,
    );
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
  await page.getByRole("button", { name: "PiP", exact: true }).click();
  await page
    .getByRole("button", { name: "녹화 일시 정지", exact: true })
    .click();
  await page.getByRole("button", { name: "녹화 재개", exact: true }).click();
  await page
    .getByRole("button", { name: "녹화 종료 및 저장", exact: true })
    .click();
  expect(
    await page.evaluate(
      () => (window as unknown as { nativeSaved: string[] }).nativeSaved.length,
    ),
  ).toBe(1);
  await page.getByRole("button", { name: "연결 종료", exact: true }).click();
  if (
    !(await page
      .getByRole("button", { name: "iPhone USB 수신 종료", exact: true })
      .isVisible())
  )
    await page.getByText("iPhone Windows USB 수신", { exact: true }).click();
  await page
    .getByRole("button", { name: "iPhone USB 수신 종료", exact: true })
    .click();
  await expect(page.getByLabel("iPhone USB 연결 코드 1")).toHaveCount(0);
});
