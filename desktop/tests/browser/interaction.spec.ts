import { test, expect } from "@playwright/test";
test("mouse letterboxing, drag, wheel, back and computer audio actions", async ({
  page,
}) => {
  await page.goto("/tests/browser/layout.html");
  await page.getByRole("button", { name: "폰 화면 보기" }).click();
  await page.evaluate(() => {
    (
      window as unknown as { renderFixture: (w: number, h: number) => void }
    ).renderFixture(100, 200);
  });
  const canvas = page.getByLabel("폰 영상");
  await expect(
    page.getByRole("button", { name: "화면 녹화", exact: true }),
  ).toBeEnabled();
  let box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: 1, y: box.height / 2 } });
  expect(
    await page.evaluate(
      () => (window as unknown as { controls: unknown[] }).controls.length,
    ),
  ).toBe(0);
  box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 10);
  await page.mouse.up();
  await expect
    .poll(async () =>
      page.evaluate(() =>
        (window as unknown as { controls: { action?: string }[] }).controls.map(
          (value) => value.action,
        ),
      ),
    )
    .toEqual(["down", "move", "up"]);
  await page.mouse.wheel(0, 100);
  await canvas.click({ button: "right" });
  await expect
    .poll(async () =>
      page.evaluate(
        () => (window as unknown as { controls: unknown[] }).controls.length,
      ),
    )
    .toBe(5);
  await page.getByRole("button", { name: "소리 재생" }).click();
  await page.evaluate(() => {
    const packet = new ArrayBuffer(4108);
    const view = new DataView(packet);
    view.setUint32(8, 4096);
    for (let i = 0; i < 1024; i++) {
      const sample = Math.sin((i * 2 * Math.PI * 440) / 48000) * 1000;
      view.setInt16(12 + i * 4, sample, true);
      view.setInt16(14 + i * 4, sample, true);
    }
    (
      window as unknown as { pushAudio: (packet: ArrayBuffer) => void }
    ).pushAudio(packet);
  });
  await expect(
    page.getByText("컴퓨터에서 폰 소리 재생 중", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("음소거").check();
  await expect(page.getByText("음소거 중", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "연결 종료" }).click();
  await expect(page.getByRole("button", { name: "소리 재생" })).toBeDisabled();
});
