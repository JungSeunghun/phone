import { writeClipboardFixture } from "./clipboard";
import { test, expect } from "@playwright/test";
test("screen click supports Unicode paste, both shortcuts, direct input and settings scope", async ({
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
  const text = await writeClipboardFixture(
    page,
    "한국어 日本語 中文 العربية 👨‍👩‍👧‍👦\n café",
  );
  await expect(page.getByRole("button", { name: "폰에 붙여넣기" })).toHaveCount(
    0,
  );
  const canvas = page.getByLabel("폰 영상");
  await canvas.click();
  await page.keyboard.press("Meta+v");
  const controls = () =>
    page.evaluate(() =>
      (window as unknown as { controls: { kind: string }[] }).controls.filter(
        (input) => ["paste", "key", "keyboard"].includes(input.kind),
      ),
    );
  await expect.poll(controls).toEqual([{ kind: "paste", text }]);
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
  await canvas.focus();
  await expect(field).toBeFocused();
  await expect(field).toHaveCSS("opacity", "0");
  expect((await field.boundingBox())!.width).toBeLessThanOrEqual(1);
  await page.keyboard.type("ab1 ");
  await expect.poll(controls).toEqual([
    ...Array.from({ length: 3 }, () => ({ kind: "paste", text })),
    ...[4, 5, 30, 44].map((usage) => ({
      kind: "keyboard",
      usage,
      modifiers: 0,
    })),
  ]);
  await expect(field).toHaveValue("");
  await page.keyboard.press("CapsLock");
  await page.keyboard.press("Control+Space");
  await expect
    .poll(async () => (await controls()).slice(-2))
    .toEqual([
      { kind: "keyboard", usage: 44, modifiers: 2 },
      { kind: "keyboard", usage: 44, modifiers: 2 },
    ]);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  await page.keyboard.press("Backspace");
  await expect
    .poll(async () => (await controls()).at(-1))
    .toEqual({ kind: "keyboard", usage: 42, modifiers: 0 });
  await page.keyboard.press("Control+v");
  await expect.poll(async () => (await controls()).length).toBe(11);
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
  expect((await controls()).length).toBe(11);
});

test("letterboxing does not activate typing, and blurred or disconnected composition is discarded", async ({
  page,
}) => {
  await page.goto("/tests/browser/layout.html");
  await page.getByRole("button", { name: "폰 화면 보기", exact: true }).click();
  await page.evaluate(() =>
    (
      window as unknown as { renderFixture: (w: number, h: number) => void }
    ).renderFixture(100, 200),
  );
  const canvas = page.getByLabel("폰 영상");
  const field = page.getByLabel("다국어 직접 입력");
  const box = (await canvas.boundingBox())!;
  await canvas.click({ position: { x: 1, y: box.height / 2 } });
  await expect(field).not.toBeFocused();
  await canvas.click();
  await expect(field).toBeFocused();
  await page.keyboard.type("abc");
  await expect
    .poll(() =>
      page.evaluate(() =>
        (
          window as unknown as { controls: { kind: string; text?: string }[] }
        ).controls.filter((i) => i.kind === "keyboard"),
      ),
    )
    .toEqual(
      [4, 5, 6].map((usage) => ({ kind: "keyboard", usage, modifiers: 0 })),
    );
  await field.evaluate((el) => {
    el.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    (el as HTMLTextAreaElement).value = "한";
    el.dispatchEvent(
      new InputEvent("input", { bubbles: true, isComposing: true, data: "한" }),
    );
    // Cancel before the preview deadline, without depending on automation click latency.
    (el as HTMLTextAreaElement).blur();
  });
  await page.getByRole("button", { name: "설정 열기" }).click();
  await field.evaluate((el) =>
    el.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "한" }),
    ),
  );
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { controls: { kind: string }[] }).controls.filter(
          (i) => i.kind === "paste",
        ).length,
    ),
  ).toBe(0);
  await canvas.focus();
  await field.evaluate((el) =>
    el.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    ),
  );
  await page.getByRole("button", { name: "연결 종료", exact: true }).click();
  await field.evaluate((el) =>
    el.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "late" }),
    ),
  );
  await expect(field).toBeDisabled();
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { controls: { kind: string }[] }).controls.filter(
          (i) => i.kind === "paste",
        ).length,
    ),
  ).toBe(0);
});

test("iPhone Korean marked text reaches the phone without a next key and final commit is not duplicated", async ({
  page,
}) => {
  await page.goto("/tests/browser/layout.html?ios=1&ioskeyboard=1");
  await page.getByText("iPhone 다국어 입력 연결", { exact: true }).click();
  await page.getByRole("button", { name: "iPhone 키보드 연결 시작" }).click();
  await page.getByRole("button", { name: "폰 화면 보기", exact: true }).click();
  await page.evaluate(() =>
    (
      window as unknown as { renderFixture: (w: number, h: number) => void }
    ).renderFixture(100, 200),
  );
  const field = page.getByLabel("다국어 직접 입력");
  await expect(field).toBeEnabled();
  await page.getByLabel("폰 영상").focus();
  await expect(field).toBeFocused();
  const controls = () =>
    page.evaluate(() =>
      (
        (window as unknown as { keyboardControls: { kind: string }[] })
          .keyboardControls ?? []
      ).filter((input) => ["paste", "key"].includes(input.kind)),
    );
  await field.evaluate((el) => {
    el.dispatchEvent(
      new CompositionEvent("compositionstart", { bubbles: true }),
    );
    (el as HTMLTextAreaElement).value = "하";
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        isComposing: true,
        inputType: "insertCompositionText",
      }),
    );
  });
  await expect.poll(controls).toEqual([{ kind: "paste", text: "하" }]);
  await expect(field).toHaveValue("하");
  await field.evaluate((el) => {
    (el as HTMLTextAreaElement).value = "한";
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        isComposing: true,
        inputType: "insertCompositionText",
      }),
    );
  });
  const expected = [
    { kind: "paste", text: "하" },
    { kind: "key", key: "backspace" },
    { kind: "paste", text: "한" },
  ];
  await expect.poll(controls).toEqual(expected);
  await field.evaluate((el) => {
    el.dispatchEvent(
      new CompositionEvent("compositionend", { bubbles: true, data: "한" }),
    );
    (el as HTMLTextAreaElement).value = "한";
    el.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertFromComposition",
      }),
    );
  });
  await page.keyboard.insertText(" ");
  await expect
    .poll(controls)
    .toEqual([...expected, { kind: "paste", text: " " }]);
});
