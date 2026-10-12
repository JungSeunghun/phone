import { test, expect } from "@playwright/test";
test("Unicode paste button, both shortcuts, direct input and viewer scope", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/tests/browser/layout.html");
  await page.getByRole("button", { name: "폰 화면 보기" }).click();
  await page.evaluate(() =>
    (
      window as unknown as { renderFixture: (w: number, h: number) => void }
    ).renderFixture(100, 200),
  );
  const text = "한국어 日本語 中文 العربية 👨‍👩‍👧‍👦\n café";
  await page.evaluate((value) => navigator.clipboard.writeText(value), text);
  await page.getByRole("button", { name: "폰에 붙여넣기" }).click();
  const controls = () =>
    page.evaluate(
      () => (window as unknown as { controls: unknown[] }).controls,
    );
  await expect.poll(controls).toEqual([{ kind: "paste", text }]);
  const canvas = page.getByLabel("폰 영상");
  let expectedPastes = 1;
  for (const key of ["Control+v", "Meta+v"]) {
    await canvas.focus();
    await page.keyboard.press(key);
    await expect
      .poll(async () => (await controls()).length)
      .toBe(++expectedPastes);
  }
  await expect
    .poll(controls)
    .toEqual(Array.from({ length: 3 }, () => ({ kind: "paste", text })));
  const field = page.getByRole("textbox", { name: "다국어 직접 입력" });
  await field.focus();
  await page.keyboard.insertText("你好 😀");
  await expect
    .poll(controls)
    .toEqual([
      ...Array.from({ length: 3 }, () => ({ kind: "paste", text })),
      { kind: "paste", text: "你好 😀" },
    ]);
  await expect(field).toHaveValue("");
  await page.keyboard.press("Backspace");
  await expect
    .poll(async () => (await controls()).at(-1))
    .toEqual({ kind: "key", key: "backspace" });
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await controls()).length).toBe(6);
  await expect
    .poll(async () => (await controls()).at(-1))
    .toEqual({ kind: "paste", text });
  await page.getByRole("button", { name: "설정 열기" }).click();
  await page.getByText("Android Wi-Fi 연결", { exact: true }).click();
  await page.getByText("코드·주소로 연결", { exact: true }).click();
  const address = page.getByLabel("페어링 주소");
  await address.focus();
  await page.keyboard.press(
    process.platform === "darwin" ? "Meta+v" : "Control+v",
  );
  await expect(address).not.toHaveValue("");
  expect((await controls()).length).toBe(6);
});
