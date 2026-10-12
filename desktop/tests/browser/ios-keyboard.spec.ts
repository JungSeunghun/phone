import { test, expect } from "@playwright/test";
for (const mode of ["normal", "fullscreen", "pip"])
  test(`iPhone keyboard Unicode paste and direct input in ${mode}`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.goto("/tests/browser/layout.html?ios=1&ioskeyboard=1");
    await expect(
      page.getByRole("button", { name: "폰에 붙여넣기" }),
    ).toBeDisabled();
    await page.getByText("iPhone 다국어 입력 연결", { exact: true }).click();
    await page.getByRole("button", { name: "iPhone 키보드 연결 시작" }).click();
    await expect(page.getByLabel("키보드 연결 코드 1")).toHaveValue(/PMK1/);
    await page
      .getByRole("button", { name: "폰 화면 보기", exact: true })
      .click();
    await page.evaluate(() =>
      (
        window as unknown as { renderFixture: (w: number, h: number) => void }
      ).renderFixture(320, 640),
    );
    await expect(
      page.getByRole("button", { name: "폰에 붙여넣기" }),
    ).toBeEnabled();
    if (mode !== "normal")
      await page
        .getByRole("button", {
          name: mode === "fullscreen" ? "전체 화면" : "PiP",
          exact: true,
        })
        .click();
    const text = "한국어 日本語 中文 العربية 😀é\n";
    await page.evaluate((value) => navigator.clipboard.writeText(value), text);
    await page.getByRole("button", { name: "폰에 붙여넣기" }).click();
    const inputs = () =>
      page.evaluate(
        () =>
          (window as unknown as { keyboardControls: unknown[] })
            .keyboardControls,
      );
    await expect.poll(inputs).toEqual([{ kind: "paste", text }]);
    const canvas = page.getByLabel("폰 영상");
    let expectedCount = 1;
    for (const key of ["Meta+v", "Control+v"]) {
      await canvas.focus();
      await page.keyboard.press(key);
      await expect
        .poll(async () => (await inputs()).length)
        .toBe(++expectedCount);
    }
    await expect.poll(async () => (await inputs()).length).toBe(3);
    const field = page.getByLabel("다국어 직접 입력");
    await field.focus();
    await page.keyboard.insertText("你好 😀");
    await expect
      .poll(async () => (await inputs()).at(-1))
      .toEqual({ kind: "paste", text: "你好 😀" });
    await page.keyboard.press("Backspace");
    await expect
      .poll(async () => (await inputs()).at(-1))
      .toEqual({ kind: "key", key: "backspace" });
    expect(
      await page.evaluate(
        () => (window as unknown as { controls: unknown[] }).controls,
      ),
    ).toEqual([]);
    await page.getByRole("button", { name: "연결 종료", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "폰에 붙여넣기" }),
    ).toBeDisabled();
  });
