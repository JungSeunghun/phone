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
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { saved: Blob[] }).saved.length,
      ),
    )
    .toBe(2);
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

for (const mode of ["normal", "fullscreen", "pip"]) {
  test(`captures the clicked frame during active and paused recording in ${mode}`, async ({
    page,
  }) => {
    await page.goto("/tests/browser/layout.html");
    await page.getByRole("button", { name: "폰 화면 보기" }).click();
    await page.evaluate(() =>
      (
        window as unknown as { renderFixture: (w: number, h: number) => void }
      ).renderFixture(320, 640),
    );
    await page.getByRole("button", { name: "화면 녹화" }).click();
    if (mode !== "normal")
      await page
        .getByRole("button", { name: mode === "pip" ? "PiP" : "전체 화면" })
        .click();
    const capture = async (color: string) => {
      await page.evaluate((color) => {
        const ctx = document.querySelector("canvas")!.getContext("2d")!;
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 320, 640);
      }, color);
      if (mode !== "normal") await page.getByLabel("캡처 및 녹화").click();
      await page.getByRole("button", { name: "스크린샷 저장" }).click();
      // Changing the live canvas while the encoder finishes must not change the clicked frame.
      await page.evaluate(() => {
        const ctx = document.querySelector("canvas")!.getContext("2d")!;
        ctx.fillStyle = "green";
        ctx.fillRect(0, 0, 320, 640);
      });
      await expect(
        page.getByText("저장했습니다: /fixture", { exact: true }),
      ).toBeVisible();
    };
    await capture("red");
    await expect(
      page.getByRole("button", { name: "녹화 종료 및 저장" }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "녹화 일시 정지" }).click();
    await capture("blue");
    await expect(page.getByRole("button", { name: "녹화 재개" })).toBeEnabled();
    const images = await page.evaluate(async () => {
      const blobs = (window as unknown as { saved: Blob[] }).saved;
      return Promise.all(
        blobs.map(async (blob) => {
          const img = await createImageBitmap(blob);
          const canvas = new OffscreenCanvas(img.width, img.height);
          const ctx = canvas.getContext("2d")!;
          ctx.drawImage(img, 0, 0);
          return {
            type: blob.type,
            size: [img.width, img.height],
            pixel: Array.from(ctx.getImageData(10, 10, 1, 1).data),
          };
        }),
      );
    });
    expect(images).toEqual([
      { type: "image/png", size: [320, 640], pixel: [255, 0, 0, 255] },
      { type: "image/png", size: [320, 640], pixel: [0, 0, 255, 255] },
    ]);
    await page.getByRole("button", { name: "녹화 재개" }).click();
    await page.evaluate(() => {
      const ctx = document.querySelector("canvas")!.getContext("2d")!;
      ctx.fillStyle = "yellow";
      ctx.fillRect(0, 0, 320, 640);
    });
    await page.getByRole("button", { name: "녹화 종료 및 저장" }).click();
    await expect
      .poll(() =>
        page.evaluate(
          () => (window as unknown as { saved: Blob[] }).saved.length,
        ),
      )
      .toBe(3);
    const video = await page.evaluate(async () => {
      const blob = (window as unknown as { saved: Blob[] }).saved[2];
      const video = document.createElement("video");
      video.src = URL.createObjectURL(blob);
      video.muted = true;
      await new Promise<void>((r, j) => {
        video.onloadeddata = () => r();
        video.onerror = () => j(Error("Invalid recording"));
      });
      return {
        size: blob.size,
        width: video.videoWidth,
        height: video.videoHeight,
      };
    });
    expect(video.size).toBeGreaterThan(100);
    expect([video.width, video.height]).toEqual([320, 640]);
  });
}
