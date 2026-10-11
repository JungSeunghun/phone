import { test, expect } from "@playwright/test";
for (const transport of ["usb", "wifi"] as const) {
  test(`${transport} renders a locally decodable QR and removes it on stop`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 780 });
    await page.goto(`/tests/browser/qr.html?transport=${transport}`);
    await page
      .getByText(
        transport === "usb" ? "iPhone Windows USB 송출" : "iPhone Wi-Fi 송출",
        { exact: true },
      )
      .click();
    await page
      .getByRole("button", {
        name: transport === "usb" ? "iPhone USB 수신 시작" : "iPhone 수신 시작",
        exact: true,
      })
      .click();
    const image = page.getByRole("img", { name: "iPhone 연결 QR 코드 1" });
    await expect(image).toBeVisible();
    const box = await image.boundingBox();
    expect(box!.width).toBeLessThanOrEqual(320);
    const decoded = await page.evaluate(() =>
      (
        window as unknown as {
          decodeConnectionQr: () => Promise<string | undefined>;
        }
      ).decodeConnectionQr(),
    );
    expect(decoded).toBe(
      `${transport === "usb" ? "PMU1|27483" : "PMW1|192.168.0.44:43315"}|${"ab".repeat(32)}`,
    );
    await page
      .getByRole("button", {
        name: transport === "usb" ? "iPhone USB 수신 종료" : "iPhone 수신 종료",
        exact: true,
      })
      .click();
    await expect(image).toHaveCount(0);
  });
}
