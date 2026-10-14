import { test, expect } from "@playwright/test";

for (const language of ["ko", "en"] as const) {
  test(`${language} short settings labels stay on one line`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto("/tests/browser/layout.html");
    await page.getByLabel("언어 / Language").selectOption(language);
    const settings = page.getByRole("region", {
      name: language === "ko" ? "화면 설정" : "Display settings",
    });
    for (const field of [
      language === "ko" ? "화질" : "Video quality",
      language === "ko" ? "프레임" : "Frame rate",
    ]) {
      const select = settings.getByRole("combobox", {
        name: field,
        exact: true,
      });
      await select.scrollIntoViewIfNeeded();
      const height = await select.evaluate((el) => {
        const text = [...el.parentElement!.childNodes].find(
          (node) =>
            node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
        );
        const range = document.createRange();
        range.selectNodeContents(text!);
        return range.getBoundingClientRect().height;
      });
      expect(height).toBeLessThanOrEqual(24);
    }
  });
  test(`${language} setup separates instructions and actions in a narrow sidebar`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 540 });
    await page.goto("/tests/browser/layout.html");
    await page.getByLabel("언어 / Language").selectOption(language);
    const guide = page.locator(".first-connection-guide");
    await guide.locator("summary").click();
    const guideBox = (await guide.boundingBox())!;
    const heading = (await page
      .locator(".sidebar-content section > h2")
      .first()
      .boundingBox())!;
    expect(heading.y - guideBox.y - guideBox.height).toBeGreaterThanOrEqual(12);
    const steps = guide.locator("li");
    const first = (await steps.nth(0).boundingBox())!;
    const second = (await steps.nth(1).boundingBox())!;
    expect(second.y - first.y - first.height).toBeGreaterThanOrEqual(8);
    expect(await guide.evaluate((el) => getComputedStyle(el).wordBreak)).toBe(
      language === "ko" ? "keep-all" : "normal",
    );
    await page
      .locator(".sidebar-content")
      .evaluate((el) => (el.scrollTop = el.scrollHeight));
    const update = page.getByRole("region", {
      name: language === "ko" ? "앱 업데이트" : "App updates",
    });
    const checkbox = (await update.locator(".checkbox").boundingBox())!;
    const check = (await update.getByRole("button").first().boundingBox())!;
    expect(check.y - checkbox.y - checkbox.height).toBeGreaterThanOrEqual(8);
    expect(
      await page
        .locator(".sidebar")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
  });

  for (const height of [540, 600]) {
    test(`${language} live controls preserve video space at 800x${height}`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 800, height });
      await page.goto("/tests/browser/layout.html");
      await page.getByLabel("언어 / Language").selectOption(language);
      await page
        .getByRole("button", {
          name: language === "ko" ? "폰 화면 보기" : "View phone screen",
          exact: true,
        })
        .click();
      await page.evaluate(() =>
        (
          window as unknown as { renderFixture: (w: number, h: number) => void }
        ).renderFixture(886, 1920),
      );
      await page
        .getByRole("button", {
          name: language === "ko" ? "설정 열기" : "Open settings",
        })
        .click();
      const header = (await page.locator(".viewer-header").boundingBox())!;
      const toolbar = (await page.locator(".viewer-toolbar").boundingBox())!;
      expect(header.height).toBeLessThanOrEqual(88);
      expect(toolbar.height).toBeLessThanOrEqual(96);
      expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(height);
      expect(
        await page
          .locator(".viewer")
          .evaluate((el) => el.scrollWidth <= el.clientWidth),
      ).toBe(true);
      await page.locator(".performance-info summary").click();
      const report = page.locator(".performance-info");
      await expect(
        report.locator("dt", {
          hasText: language === "ko" ? "수신 프레임" : "Received frames",
        }),
      ).toBeVisible();
      await expect(
        report.locator("dd").filter({ hasText: "886 × 1920" }),
      ).toBeVisible();
      const popup = (await page
        .locator(".performance-info-content")
        .boundingBox())!;
      expect(popup.y).toBeGreaterThanOrEqual(header.y + header.height);
      expect(await report.innerText()).not.toMatch(/수신0|p950|최대0/);
      await page.locator(".interaction-help summary").click();
      expect(
        (await page.locator(".viewer-toolbar").boundingBox())!.height,
      ).toBe(toolbar.height);
      const help = (await page
        .locator(".interaction-help-content")
        .boundingBox())!;
      expect(help.x).toBeGreaterThanOrEqual(0);
      expect(help.x + help.width).toBeLessThanOrEqual(800);
      await page
        .getByRole("button", {
          name: language === "ko" ? "연결 종료" : "Disconnect",
          exact: true,
        })
        .click();
      await expect(
        page.getByLabel(language === "ko" ? "폰 영상" : "Phone video"),
      ).not.toBeVisible();
    });
  }

  test(`${language} long iPhone names do not push connection actions outside the viewer`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 800, height: 600 });
    await page.goto("/tests/browser/layout.html?ios&longname");
    await page.getByLabel("언어 / Language").selectOption(language);
    await page
      .getByRole("button", {
        name: language === "ko" ? "폰 화면 보기" : "View phone screen",
        exact: true,
      })
      .click();
    await page.evaluate(() =>
      (
        window as unknown as { renderFixture: (w: number, h: number) => void }
      ).renderFixture(886, 1920),
    );
    await page
      .getByRole("button", {
        name: language === "ko" ? "설정 열기" : "Open settings",
      })
      .click();
    const device = page.locator(".connection-device");
    await expect(device).toHaveAttribute(
      "title",
      "Layout fixture with a very long device name · 줄바꿈 확인용 기기 이름",
    );
    expect(await device.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
      true,
    );
    expect(
      (await page.locator(".viewer-header").boundingBox())!.height,
    ).toBeLessThanOrEqual(88);
    expect(
      await page
        .locator(".viewer")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    const stop = page.getByRole("button", {
      name: language === "ko" ? "연결 종료" : "Disconnect",
      exact: true,
    });
    expect(
      (await stop.boundingBox())!.x + (await stop.boundingBox())!.width,
    ).toBeLessThanOrEqual(800);
    await stop.click();
  });
}
