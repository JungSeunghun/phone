import { test, expect } from "@playwright/test";
test("Android QR scans to exact ADB payload, keeps USB available and restores manual actions after connection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/tests/browser/layout.html?androidqr=1");
  await page.getByText("Wi-Fi 페어링 · 연결", { exact: true }).click();
  await page
    .getByRole("button", { name: "Android QR 페어링 시작", exact: true })
    .click();
  const image = page.getByRole("img", { name: "Android Wi-Fi 페어링 QR 코드" });
  await expect(image).toBeVisible();
  expect(
    await page.evaluate(() =>
      (
        window as unknown as {
          decodeAndroidQr: () => Promise<string | undefined>;
        }
      ).decodeAndroidQr(),
    ),
  ).toBe(`WIFI:T:ADB;S:studio-${"ab".repeat(16)};P:${"cd".repeat(16)};;`);
  await expect(
    page.getByRole("button", { name: "무선 기기 검색", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "폰 화면 보기", exact: true }),
  ).toBeEnabled();
  const connect = (await page
    .getByRole("button", { name: "폰 화면 보기", exact: true })
    .boundingBox())!;
  expect(connect.y + connect.height).toBeLessThanOrEqual(600);
  await page.evaluate(() =>
    (
      window as unknown as { completeAndroidQr: () => void }
    ).completeAndroidQr(),
  );
  await expect(image).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "무선 기기 검색", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText(/Android Wi-Fi 페어링과 연결을 완료/),
  ).toBeVisible();
});
test("Android QR cancellation removes credentials even if an old connection callback arrives", async ({
  page,
}) => {
  await page.goto("/tests/browser/layout.html?androidqr=1");
  await page.getByText("Wi-Fi 페어링 · 연결", { exact: true }).click();
  await page
    .getByRole("button", { name: "Android QR 페어링 시작", exact: true })
    .click();
  await expect(
    page.getByRole("img", { name: "Android Wi-Fi 페어링 QR 코드" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Android QR 페어링 취소", exact: true })
    .click();
  await page.evaluate(() =>
    (
      window as unknown as { completeAndroidQr: () => void }
    ).completeAndroidQr(),
  );
  await expect(
    page.getByRole("img", { name: "Android Wi-Fi 페어링 QR 코드" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Android QR 페어링 시작", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText(/Android Wi-Fi 페어링과 연결을 완료/),
  ).toHaveCount(0);
});
