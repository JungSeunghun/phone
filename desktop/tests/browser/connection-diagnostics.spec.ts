import { test, expect } from "@playwright/test";
test("diagnosis preserves live video and active recording", async ({
  page,
}) => {
  await page.goto("/tests/browser/layout.html");
  await page.getByRole("button", { name: "폰 화면 보기", exact: true }).click();
  await page.evaluate(() =>
    (
      window as unknown as { renderFixture: (w: number, h: number) => void }
    ).renderFixture(320, 640),
  );
  await page.getByRole("button", { name: "화면 녹화", exact: true }).click();
  await page.getByRole("button", { name: "설정 열기", exact: true }).click();
  await page.getByText("연결 문제 진단", { exact: true }).click();
  await page
    .getByRole("button", { name: "연결 진단 시작", exact: true })
    .click();
  await expect(
    page.getByText("폰에서 USB 디버깅을 허용하세요.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("녹화 중", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { qualityRequests: unknown[] }).qualityRequests
          .length,
    ),
  ).toBe(1);
  await expect(
    page.getByRole("button", { name: "연결 종료", exact: true }),
  ).toBeEnabled();
});
test("Wi-Fi address validation and iPhone guidance work at minimum window size", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 600 });
  await page.goto("/tests/browser/layout.html");
  await page.getByText("연결 문제 진단", { exact: true }).click();
  await page.getByLabel("진단 연결 방식", { exact: true }).selectOption("wifi");
  await page.getByLabel("진단 연결 주소", { exact: true }).fill("1.2.3.4:0");
  await page
    .getByRole("button", { name: "연결 진단 시작", exact: true })
    .click();
  await expect(
    page.getByText("진단 대상과 연결 IP 주소·포트를 확인하세요.", {
      exact: true,
    }),
  ).toBeVisible();
  await page.getByLabel("진단할 폰", { exact: true }).selectOption("ios");
  await page.getByRole("button", { name: "다시 진단", exact: true }).click();
  await expect(
    page.getByText("최신 QR을 송출 앱에 저장하고 화면 방송을 시작하세요.", {
      exact: true,
    }),
  ).toBeVisible();
});
