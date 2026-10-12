import { test, expect } from "@playwright/test";
test("iPhone Wi-Fi receiver actions and app PCM playback retain readonly controls", async ({
  page,
}) => {
  await page.goto("/tests/browser/layout.html?ios=1&ioswifi=1");
  await page.getByText("iPhone Wi-Fi 수신", { exact: true }).click();
  await page.getByRole("button", { name: "iPhone 수신 시작" }).click();
  await expect(page.getByLabel("iPhone 연결 코드 1")).toHaveValue(
    `PMW1|127.0.0.1:1234|${"ab".repeat(32)}`,
  );
  await expect(
    page.getByRole("img", { name: "iPhone 연결 QR 코드 1" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "폰 화면 보기", exact: true }).click();
  await page.evaluate(() => {
    (
      window as unknown as { renderFixture: (w: number, h: number) => void }
    ).renderFixture(320, 640);
  });
  await expect(page.getByRole("button", { name: "소리 재생" })).toBeEnabled();
  await page.getByRole("button", { name: "소리 재생" }).click();
  await page.evaluate(() => {
    const p = new ArrayBuffer(4108);
    const view = new DataView(p);
    view.setBigUint64(0, 0n);
    view.setUint32(8, 4096);
    (window as unknown as { pushAudio: (p: ArrayBuffer) => void }).pushAudio(p);
  });
  await expect(page.getByText("컴퓨터에서 폰 소리 재생 중")).toBeVisible();
  await page.getByLabel("폰 영상").click();
  expect(
    await page.evaluate(
      () => (window as unknown as { controls: unknown[] }).controls.length,
    ),
  ).toBe(0);
  await page.getByRole("button", { name: "연결 종료", exact: true }).click();
  await page.getByRole("button", { name: "iPhone 수신 종료" }).click();
  await expect(page.getByLabel("iPhone 연결 코드 1")).toHaveCount(0);
});
