import { test, expect } from "@playwright/test";
test("real canvas PNG and MediaRecorder playback work through capture buttons", async ({
  page,
}) => {
  await page.goto("/tests/browser/layout.html");
  await page.getByRole("button", { name: "폰 화면 보기" }).click();
  await page.evaluate(() => {
    (
      window as unknown as { renderFixture: (w: number, h: number) => void }
    ).renderFixture(320, 640);
  });
  await page.getByRole("button", { name: "스크린샷 저장" }).click();
  await expect(page.getByText("저장했습니다: /fixture")).toBeVisible();
  const size = await page.evaluate(async () => {
    const blob = (window as unknown as { saved: Blob[] }).saved[0];
    const image = await createImageBitmap(blob);
    return [blob.type, image.width, image.height];
  });
  expect(size).toEqual(["image/png", 320, 640]);
  await page.getByRole("button", { name: "화면 녹화" }).click();
  await page.evaluate(() => {
    let count = 0;
    const canvas = document.querySelector("canvas")!;
    const ctx = canvas.getContext("2d")!;
    const timer = setInterval(() => {
      ctx.fillStyle = count % 2 ? "red" : "blue";
      ctx.fillRect(0, 0, 320, 640);
      if (++count === 30) clearInterval(timer);
    }, 50);
  });
  await page.waitForTimeout(1700);
  await page.getByRole("button", { name: "녹화 종료 및 저장" }).click();
  await expect(page.getByText("저장했습니다: /fixture")).toBeVisible();
  const result = await page.evaluate(async () => {
    const blob = (window as unknown as { saved: Blob[] }).saved[1];
    const video = document.createElement("video");
    video.muted = true;
    video.src = URL.createObjectURL(blob);
    await new Promise<void>((resolve, reject) => {
      video.onloadeddata = () => resolve();
      video.onerror = () => reject(Error("Invalid video"));
    });
    return [blob.size, video.videoWidth, video.videoHeight];
  });
  expect(result[0]).toBeGreaterThan(100);
  expect(result.slice(1)).toEqual([320, 640]);
});
